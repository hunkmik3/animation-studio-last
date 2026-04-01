'use client'
import { logError as _ulogError } from '@/lib/logging/core'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { DragEvent } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { ART_STYLES } from '@/lib/constants'
import { shouldShowError } from '@/lib/error-utils'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import {
    useAiCreateProjectLocation,
    useAiDesignLocation,
    useCreateAssetHubLocation,
    useCreateProjectLocation,
    useUploadAssetHubTempMedia,
} from '@/lib/query/hooks'

export interface LocationCreationModalProps {
    mode: 'asset-hub' | 'project'
    // Asset Hub 模式使用
    folderId?: string | null
    // 项目模式使用
    projectId?: string
    onClose: () => void
    onSuccess: () => void
}

// 内联 SVG 图标
const XMarkIcon = ({ className }: { className?: string }) => (
    <AppIcon name="close" className={className} />
)

const SparklesIcon = ({ className }: { className?: string }) => (
    <AppIcon name="sparklesAlt" className={className} />
)

export function LocationCreationModal({
    mode,
    folderId,
    projectId,
    onClose,
    onSuccess
}: LocationCreationModalProps) {
    const t = useTranslations('assetModal')
    const aiDesignAssetHubLocation = useAiDesignLocation()
    const createAssetHubLocation = useCreateAssetHubLocation()
    const aiCreateProjectLocation = useAiCreateProjectLocation(projectId || '')
    const createProjectLocation = useCreateProjectLocation(projectId || '')
    const uploadAssetHubTempMedia = useUploadAssetHubTempMedia()

    // 表单字段
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [aiInstruction, setAiInstruction] = useState('')
    const [artStyle, setArtStyle] = useState('american-comic')
    const [referenceImagesBase64, setReferenceImagesBase64] = useState<string[]>([])
    const fileInputRef = useRef<HTMLInputElement>(null)

    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isAiDesigning, setIsAiDesigning] = useState(false)
    const aiDesigningState = isAiDesigning
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'generate',
            resource: 'image',
            hasOutput: false,
        })
        : null
    const submittingState = isSubmitting
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'generate',
            resource: 'image',
            hasOutput: false,
        })
        : null

    const getErrorMessage = (error: unknown, fallback: string) => {
        if (error instanceof Error && error.message) {
            return error.message
        }
        return fallback
    }

    const getErrorStatus = (error: unknown): number | null => {
        if (typeof error === 'object' && error !== null) {
            const status = (error as { status?: unknown }).status
            if (typeof status === 'number') return status
        }
        return null
    }

    const handleFileSelect = useCallback(async (files: FileList | File[]) => {
        const fileArray = Array.from(files).filter((file) => file.type.startsWith('image/'))
        if (fileArray.length === 0) return

        const remaining = 5 - referenceImagesBase64.length
        const toAdd = fileArray.slice(0, remaining)

        for (const file of toAdd) {
            const reader = new FileReader()
            reader.onload = (event) => {
                const base64 = event.target?.result
                if (typeof base64 !== 'string') return
                setReferenceImagesBase64((previous) => {
                    if (previous.length >= 5) return previous
                    if (previous.includes(base64)) return previous
                    return [...previous, base64]
                })
            }
            reader.readAsDataURL(file)
        }
    }, [referenceImagesBase64.length])

    const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer.files.length > 0) {
            void handleFileSelect(event.dataTransfer.files)
        }
    }, [handleFileSelect])

    const handleClearReference = useCallback((index?: number) => {
        if (typeof index === 'number') {
            setReferenceImagesBase64((previous) => previous.filter((_, currentIndex) => currentIndex !== index))
            return
        }
        setReferenceImagesBase64([])
    }, [])

    // ESC 键关闭
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !isSubmitting && !isAiDesigning) {
                onClose()
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [onClose, isSubmitting, isAiDesigning])

    useEffect(() => {
        const handleGlobalPaste = (event: ClipboardEvent) => {
            if (mode !== 'asset-hub') return

            const target = event.target as HTMLElement
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

            const items = event.clipboardData?.items
            if (!items) return

            for (let index = 0; index < items.length; index += 1) {
                if (!items[index]?.type.startsWith('image/')) continue
                const file = items[index]?.getAsFile()
                if (!file) continue
                event.preventDefault()
                void handleFileSelect([file])
                break
            }
        }

        document.addEventListener('paste', handleGlobalPaste)
        return () => document.removeEventListener('paste', handleGlobalPaste)
    }, [handleFileSelect, mode])

    // AI 设计描述
    const handleAiDesign = async () => {
        if (!aiInstruction.trim()) return

        try {
            setIsAiDesigning(true)
            const data = mode === 'asset-hub'
                ? await aiDesignAssetHubLocation.mutateAsync(aiInstruction)
                : await aiCreateProjectLocation.mutateAsync({ userInstruction: aiInstruction })
            setDescription(data.prompt || '')
            setAiInstruction('')
        } catch (error: unknown) {
            if (getErrorStatus(error) === 402) {
                alert(getErrorMessage(error, t('errors.insufficientBalance')))
            } else {
                _ulogError('AI设计失败:', error)
                if (shouldShowError(error)) {
                    alert(getErrorMessage(error, t('errors.aiDesignFailed')))
                }
            }
        } finally {
            setIsAiDesigning(false)
        }
    }

    // 提交创建
    const handleSubmit = async () => {
        if (!name.trim() || !description.trim()) return

        try {
            setIsSubmitting(true)

            const body: {
                name: string
                description: string
                artStyle: string
                folderId?: string | null
            } = {
                name: name.trim(),
                description: description.trim(),
                artStyle
            }

            if (mode === 'asset-hub') {
                body.folderId = folderId
            }

            if (mode === 'asset-hub') {
                const referenceImageUrls = await Promise.all(
                    referenceImagesBase64.map(async (imageBase64) => {
                        const response = await uploadAssetHubTempMedia.mutateAsync({ imageBase64 })
                        if (!response.key) {
                            throw new Error(t('errors.uploadFailed'))
                        }
                        return response.key
                    }),
                )

                await createAssetHubLocation.mutateAsync({
                    name: body.name,
                    summary: body.description,
                    artStyle: body.artStyle,
                    folderId: body.folderId ?? null,
                    referenceImageUrls,
                })
            } else {
                await createProjectLocation.mutateAsync({
                    name: body.name,
                    description: body.description,
                    artStyle: body.artStyle,
                })
            }

            onSuccess()
            onClose()
        } catch (error: unknown) {
            if (getErrorStatus(error) === 402) {
                alert(getErrorMessage(error, t('errors.insufficientBalance')))
            } else if (shouldShowError(error)) {
                alert(getErrorMessage(error, t('errors.createFailed')))
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    // 处理点击遮罩层关闭
    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget && !isSubmitting && !isAiDesigning) {
            onClose()
        }
    }

    return (
        <div
            className="fixed inset-0 glass-overlay flex items-center justify-center z-50 p-4"
            onClick={handleBackdropClick}
        >
            <div className="glass-surface-modal max-w-2xl w-full max-h-[85vh] flex flex-col">
                <div className="p-6 overflow-y-auto flex-1">
                    {/* 标题 */}
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-semibold text-[var(--glass-text-primary)]">
                            {t('location.title')}
                        </h3>
                        <button
                            onClick={onClose}
                            className="glass-btn-base glass-btn-soft w-8 h-8 rounded-full flex items-center justify-center text-[var(--glass-text-tertiary)]"
                        >
                            <XMarkIcon className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="space-y-5">
                        {/* 场景名称 */}
                        <div className="space-y-2">
                            <label className="glass-field-label block">
                                {t('location.name')} <span className="text-[var(--glass-tone-danger-fg)]">*</span>
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t('location.namePlaceholder')}
                                className="glass-input-base w-full px-3 py-2 text-sm"
                            />
                        </div>

                        {/* 风格选择 */}
                        <div className="space-y-2">
                            <label className="glass-field-label block">
                                {t('artStyle.title')}
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                {ART_STYLES.map((style) => (
                                    <button
                                        key={style.value}
                                        type="button"
                                        onClick={() => setArtStyle(style.value)}
                                        className={`glass-btn-base px-3 py-2 rounded-lg text-sm border transition-all justify-start ${artStyle === style.value
                                            ? 'glass-btn-tone-info border-[var(--glass-stroke-focus)]'
                                            : 'glass-btn-soft border-[var(--glass-stroke-base)] text-[var(--glass-text-secondary)]'
                                            }`}
                                    >
                                        <span>{style.preview}</span>
                                        <span>{style.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {mode === 'asset-hub' && (
                            <div className="glass-surface-soft rounded-xl p-4 space-y-3 border border-[var(--glass-stroke-base)]">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-sm font-medium text-[var(--glass-tone-info-fg)]">
                                        <AppIcon name="image" className="w-4 h-4" />
                                        <span>{t('location.uploadReference')} {t('common.optional')}</span>
                                    </div>
                                    <span className="text-xs text-[var(--glass-text-tertiary)]">{t('character.pasteHint')}</span>
                                </div>
                                <div
                                    className="border-2 border-dashed border-[var(--glass-stroke-base)] rounded-lg p-4 flex flex-col items-center justify-center cursor-pointer hover:border-[var(--glass-stroke-focus)] hover:bg-[var(--glass-tone-info-bg)] transition-all relative min-h-[120px]"
                                    onDrop={handleDrop}
                                    onDragOver={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                    }}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        className="hidden"
                                        onChange={(event) => {
                                            if (event.target.files) {
                                                void handleFileSelect(event.target.files)
                                            }
                                        }}
                                    />

                                    {referenceImagesBase64.length > 0 ? (
                                        <div className="w-full">
                                            <div className="grid grid-cols-3 gap-2 mb-2">
                                                {referenceImagesBase64.map((base64, index) => (
                                                    <div key={`${base64}-${index}`} className="relative aspect-square">
                                                        <MediaImageWithLoading
                                                            src={base64}
                                                            alt={`${name || t('location.title')} ${index + 1}`}
                                                            containerClassName="w-full h-full rounded"
                                                            className="w-full h-full object-cover rounded"
                                                        />
                                                        <button
                                                            onClick={(event) => {
                                                                event.stopPropagation()
                                                                handleClearReference(index)
                                                            }}
                                                            className="glass-btn-base glass-btn-tone-danger absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs"
                                                        >
                                                            ×
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                            <p className="text-xs text-center text-[var(--glass-text-secondary)]">
                                                {t('location.selectedCount', { count: referenceImagesBase64.length })}
                                            </p>
                                        </div>
                                    ) : (
                                        <>
                                            <AppIcon name="globe2" className="w-10 h-10 text-[var(--glass-text-tertiary)] mb-2" />
                                            <p className="text-sm text-[var(--glass-text-secondary)]">{t('location.dropOrClick')}</p>
                                            <p className="text-xs text-[var(--glass-text-tertiary)] mt-1">{t('location.maxReferenceImages')}</p>
                                        </>
                                    )}
                                </div>
                                <p className="glass-field-hint">
                                    {t('location.referenceTip')}
                                </p>
                            </div>
                        )}

                        {/* AI 设计区域 */}
                        <div className="glass-surface-soft rounded-xl p-4 space-y-3 border border-[var(--glass-stroke-base)]">
                            <div className="flex items-center gap-2 text-sm font-medium text-[var(--glass-tone-info-fg)]">
                                <SparklesIcon className="w-4 h-4" />
                                <span>{t('aiDesign.title')} {t('common.optional')}</span>
                            </div>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={aiInstruction}
                                    onChange={(e) => setAiInstruction(e.target.value)}
                                    placeholder={t('aiDesign.placeholderLocation')}
                                    className="glass-input-base flex-1 px-3 py-2 text-sm"
                                    disabled={isAiDesigning}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault()
                                            handleAiDesign()
                                        }
                                    }}
                                />
                                <button
                                    onClick={handleAiDesign}
                                    disabled={isAiDesigning || !aiInstruction.trim()}
                                    className="glass-btn-base glass-btn-tone-info px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm whitespace-nowrap"
                                >
                                    {isAiDesigning ? (
                                        <TaskStatusInline state={aiDesigningState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                                    ) : (
                                        <>
                                            <SparklesIcon className="w-4 h-4" />
                                            <span>{t('aiDesign.generate')}</span>
                                        </>
                                    )}
                                </button>
                            </div>
                            <p className="glass-field-hint">
                                {t('aiDesign.tip')}
                            </p>
                        </div>

                        {/* 场景描述 */}
                        <div className="space-y-2">
                            <label className="glass-field-label block">
                                {t('location.description')} <span className="text-[var(--glass-tone-danger-fg)]">*</span>
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={t('location.descPlaceholder')}
                                className="glass-textarea-base w-full h-36 px-3 py-2 text-sm resize-none"
                                disabled={isAiDesigning}
                            />
                        </div>
                    </div>
                </div>

                {/* 固定底部按钮区 */}
                <div className="flex gap-3 justify-end p-4 border-t border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] rounded-b-xl flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="glass-btn-base glass-btn-secondary px-4 py-2 rounded-lg text-sm"
                        disabled={isSubmitting}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !name.trim() || !description.trim()}
                        className="glass-btn-base glass-btn-primary px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center gap-2"
                    >
                        {isSubmitting ? (
                            <TaskStatusInline state={submittingState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                        ) : (
                            <span>{t('common.add')}</span>
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}
