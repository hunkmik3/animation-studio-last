/* eslint-disable */
// @ts-nocheck
// =============================================
// Node Detail Panel — Rich right sidebar
// Adapts display based on node type:
//   - Image nodes → Image gallery + preview
//   - Video nodes → Video player + frame selector
//   - Text nodes → Full text editor
//   - AI nodes → Prompt editor + structured output
// =============================================
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { NODE_TYPE_REGISTRY } from '@/lib/workflow-engine/registry'
import { useWorkflowStore } from '../useWorkflowStore'
import { fetchWorkflowWorkspaceContext } from '@/features/workflow-editor/api'
import { resolvePanelIdFromNode } from '@/features/workflow-editor/execution-contract'
import {
    getWorkflowBoundaryDescriptor,
    getWorkspaceContextActionHint,
    resolveWorkflowNodeContextIssue,
} from '@/features/workflow-editor/workspace-boundary'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import {
    X, Settings2, Video, ImageIcon, Play, ChevronDown, ChevronRight,
    Eye, Pencil, Loader2, CheckCircle2, FileText, Mic, Film,
    ZoomIn, LayoutGrid, Users, MapPin, Bot, Wand2, RefreshCw, Link2
} from 'lucide-react'

interface WorkspaceBindingContextData {
    episodes: Array<{ id: string; label: string; episodeNumber: number }>
    panels: Array<{
        id: string
        episodeId: string
        episodeNumber: number
        episodeName: string | null
        panelIndex: number
        panelNumber: number | null
        description: string | null
        imageUrl: string | null
        videoUrl: string | null
    }>
    voiceLinesByEpisode: Record<string, Array<{
        id: string
        lineIndex: number
        speaker: string
        content: string
        audioUrl: string | null
    }>>
}

// ── URL helper ──
function resolveMediaUrl(raw: unknown): string {
    if (!raw) return ''
    const url = String(raw)
    if (!url || url.startsWith('[')) return '' // skip placeholder strings
    return toDisplayImageUrl(url) || url
}

function resolveOutputMediaValue(data: Record<string, unknown> | undefined, key: 'image' | 'video' | 'audio'): unknown {
    if (!data) return undefined
    const direct = data[key]
    if (direct !== undefined && direct !== null) return direct
    const legacy = data[`${key}Url`]
    return legacy
}

// ── Section Header (collapsible) ──
function SectionHeader({ title, icon: Icon, defaultOpen = true, children }: {
    title: string
    icon: React.ElementType
    defaultOpen?: boolean
    children: React.ReactNode
}) {
    const [open, setOpen] = useState(defaultOpen)
    return (
        <div className="border-t border-slate-800">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 w-full px-4 py-2.5 text-left hover:bg-slate-800/40 transition-colors"
            >
                {open ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
                <Icon className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{title}</span>
            </button>
            {open && <div className="px-4 pb-4">{children}</div>}
        </div>
    )
}

// ── Generative Asset Gallery (Characters / Locations with inline generate) ──
function GenerativeAssetGallery({
    items,
    type,
    projectId,
    title,
    nodeId,
    updateNodeData: updateData,
}: {
    items: { id: string; name: string; imageUrl?: string; appearanceId?: string }[]
    type: 'character' | 'location'
    projectId: string | null
    title: string
    nodeId: string | null
    updateNodeData: (id: string, data: Record<string, unknown>) => void
}) {
    const [itemStates, setItemStates] = useState<Record<string, 'idle' | 'submitting' | 'generating' | 'done' | 'error'>>({})
    const [itemImages, setItemImages] = useState<Record<string, string>>(() => {
        const init: Record<string, string> = {}
        items.forEach(i => { if (i.imageUrl) init[i.id] = i.imageUrl })
        return init
    })
    const [errors, setErrors] = useState<Record<string, string>>({})

    if (!items || items.length === 0) return null

    const pollForImage = async (itemId: string) => {
        if (!projectId || !nodeId) return
        for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise(r => setTimeout(r, 7000))
            try {
                const res = await fetch(`/api/workflows/sync-project?projectId=${projectId}`)
                if (!res.ok) continue
                const data = await res.json()
                const nodes = data?.graphData?.nodes || []
                const targetNode = nodes.find((n: any) =>
                    type === 'character' ? n.data?.isCharacterSummary : n.data?.isLocationSummary
                )
                if (!targetNode) continue
                const freshList: { id: string; imageUrl?: string }[] =
                    type === 'character'
                        ? (targetNode.data?.initialOutput?.characters || [])
                        : (targetNode.data?.initialOutput?.scenes || [])
                const freshItem = freshList.find(i => i.id === itemId)
                if (freshItem?.imageUrl) {
                    setItemImages(prev => ({ ...prev, [itemId]: freshItem.imageUrl! }))
                    setItemStates(prev => ({ ...prev, [itemId]: 'done' }))
                    // Sync updated images back into node data
                    const allImages = freshList
                        .filter(i => i.imageUrl)
                        .map(i => ({ name: items.find(x => x.id === i.id)?.name || '', imageUrl: i.imageUrl! }))
                    const dataKey = type === 'character' ? 'characterImages' : 'locationImages'
                    updateData(nodeId, { [dataKey]: allImages })
                    return
                }
            } catch { /**/ }
        }
        // Polling timed out — reset so user can retry
        setItemStates(prev => ({ ...prev, [itemId]: 'idle' }))
    }

    const generateOne = async (itemId: string) => {
        if (!projectId) return
        setItemStates(prev => ({ ...prev, [itemId]: 'submitting' }))
        setErrors(prev => { const next = { ...prev }; delete next[itemId]; return next })
        try {
            const url = `/api/novel-promotion/${projectId}/generate-image`
            const item = items.find(i => i.id === itemId)
            const body = type === 'character'
                ? { type: 'character', id: itemId, appearanceId: item?.appearanceId || itemId }
                : { type: 'location', id: itemId, imageIndex: 0 }

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            const result = await res.json()
            if (!res.ok) {
                console.error('[GenerateImage] API error:', result)
                throw new Error(result.message || result.error?.message || result.error || 'Generation failed')
            }
            setItemStates(prev => ({ ...prev, [itemId]: 'generating' }))
            pollForImage(itemId)
        } catch (err) {
            setItemStates(prev => ({ ...prev, [itemId]: 'error' }))
            setErrors(prev => ({ ...prev, [itemId]: err instanceof Error ? err.message : String(err) }))
        }
    }

    const missingCount = items.filter(i => !itemImages[i.id]).length

    return (
        <SectionHeader title={title} icon={Eye} defaultOpen={true}>
            {/* Generate All Missing button */}
            {projectId && missingCount > 0 && (
                <div className="flex justify-end mb-2">
                    <button
                        onClick={() => items.filter(i => !itemImages[i.id]).forEach(i => generateOne(i.id))}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium rounded-lg bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 transition-colors"
                    >
                        <Wand2 className="w-3 h-3" />
                        Generate All ({missingCount})
                    </button>
                </div>
            )}
            <div className="grid grid-cols-2 gap-2">
                {items.map((item) => {
                    const imageUrl = itemImages[item.id]
                    const state = itemStates[item.id] || 'idle'
                    const isGenerating = state === 'submitting' || state === 'generating'
                    const hasError = state === 'error'

                    return (
                        <div key={item.id} className="relative group rounded-lg overflow-hidden bg-slate-900 border border-slate-700">
                            {imageUrl ? (
                                <MediaImageWithLoading src={imageUrl} alt={item.name} containerClassName="w-full h-28" className="w-full h-28 object-cover" />
                            ) : (
                                <div className="w-full h-28 flex flex-col items-center justify-center bg-slate-800/60 gap-1.5">
                                    {isGenerating ? (
                                        <>
                                            <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
                                            <span className="text-[9px] text-slate-400">
                                                {state === 'submitting' ? 'Submitting...' : 'Generating...'}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <ImageIcon className="w-6 h-6 text-slate-700" />
                                            <span className="text-[9px] text-slate-600">No image</span>
                                        </>
                                    )}
                                </div>
                            )}
                            {/* Name label */}
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1">
                                <span className="text-[10px] text-white font-medium truncate block">{item.name}</span>
                            </div>
                            {/* Generate / Regenerate button (shown on hover) */}
                            {!isGenerating && projectId && (
                                <button
                                    onClick={() => generateOne(item.id)}
                                    title={imageUrl ? 'Regenerate' : 'Generate image'}
                                    className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/50 hover:bg-violet-600/80 text-white opacity-0 group-hover:opacity-100 transition-all"
                                >
                                    {imageUrl ? <RefreshCw className="w-3 h-3" /> : <Wand2 className="w-3 h-3" />}
                                </button>
                            )}
                            {/* Error badge */}
                            {hasError && (
                                <div className="absolute top-1.5 left-1.5 max-w-[90%]" title={errors[item.id]}>
                                    <span className="text-[9px] bg-red-500/80 text-white px-1.5 py-0.5 rounded truncate block">
                                        ❌ {errors[item.id]?.slice(0, 40) || 'Error'}
                                    </span>
                                </div>
                            )}
                            {/* Done badge */}
                            {state === 'done' && (
                                <div className="absolute top-1.5 left-1.5">
                                    <span className="text-[9px] bg-emerald-500/80 text-white px-1.5 py-0.5 rounded flex items-center gap-1">
                                        <CheckCircle2 className="w-2.5 h-2.5" /> Done
                                    </span>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </SectionHeader>
    )
}

// ── Image Preview Section ──
function ImagePreviewSection({ outputs, initialOutput }: { outputs?: Record<string, unknown>; initialOutput?: Record<string, unknown> }) {
    const data = outputs || initialOutput
    const image = resolveOutputMediaValue(data, 'image')
    if (!image) return null

    const url = resolveMediaUrl(image)
    if (!url) return null

    return (
        <SectionHeader title="Preview" icon={Eye} defaultOpen={true}>
            <div className="space-y-3">
                <div className="w-full relative rounded-lg overflow-hidden bg-slate-900 border border-slate-700 shadow-lg group cursor-pointer hover:border-slate-500 transition-colors">
                    <MediaImageWithLoading
                        src={url}
                        alt="Generated output"
                        containerClassName="w-full"
                        className="w-full h-auto object-contain"
                        style={{ maxHeight: '300px' }}
                    />
                    {/* Overlay controls */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="flex justify-between items-center">
                            <span className="text-[9px] text-slate-300 truncate max-w-[180px]">
                                {String(image).split('/').pop()?.slice(0, 30)}
                            </span>
                            <div className="flex gap-1">
                                <button className="p-1 rounded bg-white/10 hover:bg-white/20 transition-colors" title="Full size">
                                    <ZoomIn className="w-3 h-3 text-white" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Image status */}
                <div className="flex items-center gap-2 text-[10px]">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">Image ready</span>
                </div>
            </div>
        </SectionHeader>
    )
}

// ── Video Preview Section ──
function VideoPreviewSection({ outputs, initialOutput }: { outputs?: Record<string, unknown>; initialOutput?: Record<string, unknown> }) {
    const data = outputs || initialOutput
    const video = resolveOutputMediaValue(data, 'video')
    if (!video) return null

    const url = resolveMediaUrl(video)
    if (!url) return null

    return (
        <SectionHeader title="Video Preview" icon={Film} defaultOpen={true}>
            <div className="space-y-3">
                <div className="w-full relative rounded-lg overflow-hidden bg-slate-900 border border-slate-700 shadow-lg">
                    <video
                        src={url}
                        controls
                        className="w-full"
                        style={{ maxHeight: '250px' }}
                        preload="metadata"
                    />
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">Video ready</span>
                    <span className="text-slate-500 ml-auto">{String(video).split('/').pop()?.slice(0, 25)}</span>
                </div>
            </div>
        </SectionHeader>
    )
}

// ── Audio Preview Section ──
function AudioPreviewSection({ outputs, initialOutput }: { outputs?: Record<string, unknown>; initialOutput?: Record<string, unknown> }) {
    const data = outputs || initialOutput
    const audio = resolveOutputMediaValue(data, 'audio')
    if (!audio) return null

    const url = resolveMediaUrl(audio)
    if (!url) return null

    return (
        <SectionHeader title="Audio Preview" icon={Mic} defaultOpen={true}>
            <div className="space-y-3">
                <div className="w-full rounded-lg overflow-hidden bg-slate-900 border border-slate-700 shadow-lg p-3">
                    <audio
                        src={url}
                        controls
                        className="w-full"
                        preload="metadata"
                    />
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">Audio ready</span>
                    <span className="text-slate-500 ml-auto">{String(audio).split('/').pop()?.slice(0, 25)}</span>
                </div>
            </div>
        </SectionHeader>
    )
}

// ── Text Output Section ──
function TextOutputSection({ outputs, initialOutput }: { outputs?: Record<string, unknown>; initialOutput?: Record<string, unknown> }) {
    // Prefer live execution outputs; fall back to initialOutput (pre-loaded data like characters/scenes)
    const display = outputs || initialOutput
    if (!display) return null

    const textKeys = Object.entries(display).filter(([, v]) => typeof v === 'string' && !String(v).startsWith('['))
    const jsonKeys = Object.entries(display).filter(([, v]) => typeof v === 'object' && v !== null)

    if (textKeys.length === 0 && jsonKeys.length === 0) return null

    return (
        <SectionHeader title="Output" icon={FileText} defaultOpen={true}>
            <div className="space-y-3">
                {textKeys.map(([key, value]) => (
                    <div key={key}>
                        <label className="text-[10px] text-slate-500 uppercase mb-1 block">{key}</label>
                        <div className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-300 font-mono overflow-auto max-h-48 whitespace-pre-wrap">
                            {String(value)}
                        </div>
                    </div>
                ))}
                {jsonKeys.map(([key, value]) => (
                    <div key={key}>
                        <label className="text-[10px] text-slate-500 uppercase mb-1 block">{key}</label>
                        <pre className="w-full px-3 py-2 text-[10px] rounded-lg bg-slate-900 border border-slate-700 text-slate-300 font-mono overflow-auto max-h-48">
                            {JSON.stringify(value, null, 2)}
                        </pre>
                    </div>
                ))}
            </div>
        </SectionHeader>
    )
}

// ── Execution Status Badge ──
function ExecutionStatusBar({ executionState, onRun }: {
    executionState?: { status: string; progress: number; message?: string; error?: string }
    onRun: () => void
}) {
    const status = executionState?.status || 'idle'

    return (
        <div className="px-4 py-2.5 border-t border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-2">
                <button
                    onClick={onRun}
                    disabled={status === 'running'}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${status === 'running'
                        ? 'bg-amber-500/20 text-amber-400 cursor-not-allowed'
                        : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                        }`}
                >
                    {status === 'running' ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Running...</>
                    ) : (
                        <><Play className="w-3 h-3" /> Run Node</>
                    )}
                </button>

                {status === 'completed' && (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" /> Done
                    </span>
                )}
                {status === 'failed' && (
                    <span className="text-[10px] text-red-400 truncate max-w-[150px]"
                        title={executionState?.error}>
                        ❌ {executionState?.error?.slice(0, 30) || 'Failed'}
                    </span>
                )}
            </div>

            {/* Progress bar */}
            {status === 'running' && (
                <div className="mt-2">
                    <div className="w-full bg-slate-800 rounded-full h-1.5">
                        <div
                            className="bg-amber-500 h-1.5 rounded-full transition-all duration-500"
                            style={{ width: `${executionState?.progress || 0}%` }}
                        />
                    </div>
                    {executionState?.message && (
                        <p className="text-[9px] text-slate-500 mt-1">{executionState.message}</p>
                    )}
                </div>
            )}
        </div>
    )
}

function RuntimeContextSection({
    nodeId,
    nodeType,
    nodeData,
}: {
    nodeId: string
    nodeType: string
    nodeData: Record<string, unknown>
}) {
    const boundary = getWorkflowBoundaryDescriptor(nodeType)
    const issue = resolveWorkflowNodeContextIssue({
        nodeId,
        nodeType,
        nodeData,
        label: typeof nodeData.label === 'string' ? nodeData.label : nodeId,
    })

    return (
        <SectionHeader title="Runtime Context" icon={Settings2} defaultOpen={true}>
            <div className="space-y-2">
                <div className={`text-[10px] px-2 py-1 rounded ${boundary.kind === 'workspace-linked'
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-emerald-500/15 text-emerald-300'
                    }`}>
                    {boundary.kind === 'workspace-linked'
                        ? 'Workspace-linked node'
                        : 'Workflow-native node'}
                </div>
                <p className="text-[10px] text-slate-400">{boundary.summary}</p>
                {issue ? (
                    <div className="text-[10px] px-2 py-1 rounded bg-red-500/15 text-red-300">
                        {issue.message}
                        <div className="mt-1 text-red-200">{getWorkspaceContextActionHint(nodeType)}</div>
                    </div>
                ) : (
                    <div className="text-[10px] px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">
                        Context ready for execution.
                    </div>
                )}
            </div>
        </SectionHeader>
    )
}

function WorkspaceBindingSection({
    nodeId,
    nodeType,
    nodeData,
    projectId,
    workspaceContext,
    loading,
    loadError,
    onBindPanel,
    onBindVoiceEpisode,
    onBindVoiceLine,
    onPullFromWorkspace,
    onRefreshContext,
}: {
    nodeId: string
    nodeType: string
    nodeData: Record<string, unknown>
    projectId: string | null
    workspaceContext: {
        episodes: Array<{ id: string; label: string }>
        panels: Array<{
            id: string
            episodeId: string
            episodeNumber: number
            episodeName: string | null
            panelIndex: number
            panelNumber: number | null
            description: string | null
            imageUrl: string | null
            videoUrl: string | null
        }>
        voiceLinesByEpisode: Record<string, Array<{
            id: string
            lineIndex: number
            speaker: string
            content: string
            audioUrl: string | null
        }>>
    } | null
    loading: boolean
    loadError: string | null
    onBindPanel: (panelId: string) => void
    onBindVoiceEpisode: (episodeId: string) => void
    onBindVoiceLine: (episodeId: string, lineId: string) => void
    onPullFromWorkspace: () => void
    onRefreshContext: () => void
}) {
    const issue = resolveWorkflowNodeContextIssue({
        nodeId,
        nodeType,
        nodeData,
        label: typeof nodeData.label === 'string' ? nodeData.label : nodeId,
    })
    const guidance = getWorkspaceContextActionHint(nodeType)

    if (nodeType !== 'image-generate' && nodeType !== 'video-generate' && nodeType !== 'voice-synthesis') {
        return null
    }

    const config = (nodeData.config && typeof nodeData.config === 'object' && !Array.isArray(nodeData.config))
        ? nodeData.config as Record<string, unknown>
        : {}

    const panelId = resolvePanelIdFromNode(nodeId, nodeData)
    const voiceEpisodeId = typeof config.episodeId === 'string' ? config.episodeId.trim() : ''
    const voiceLineId = typeof config.lineId === 'string' ? config.lineId.trim() : ''
    const voiceLineOptions = (workspaceContext?.voiceLinesByEpisode[voiceEpisodeId] || [])

    const panelOptions = workspaceContext?.panels || []

    return (
        <SectionHeader title="Workspace Binding" icon={Link2} defaultOpen={true}>
            <div className="space-y-3">
                {!projectId && (
                    <div className="rounded bg-red-500/15 px-2 py-1.5 text-[10px] text-red-300">
                        Missing projectId. Open workflow from a project to bind workspace context.
                    </div>
                )}

                {nodeType !== 'voice-synthesis' && (
                    <>
                        <div className={`rounded px-2 py-1.5 text-[10px] ${panelId ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                            {panelId ? `Linked panel: ${panelId}` : 'Not linked: panelId is required'}
                        </div>
                        <div>
                            <label className="block text-[11px] font-medium text-slate-400 mb-1.5 uppercase tracking-wide">
                                Select Panel
                            </label>
                            <select
                                value={panelId || ''}
                                onChange={(event) => onBindPanel(event.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 focus:outline-none focus:border-blue-500 transition-all"
                                disabled={!projectId || loading}
                            >
                                <option value="">Not linked</option>
                                {panelOptions.map((panel) => {
                                    const title = panel.episodeName && panel.episodeName.trim().length > 0
                                        ? panel.episodeName.trim()
                                        : `Episode ${panel.episodeNumber}`
                                    const panelNumber = panel.panelNumber || panel.panelIndex + 1
                                    const preview = panel.description ? panel.description.slice(0, 40) : ''
                                    return (
                                        <option key={panel.id} value={panel.id}>
                                            {`E${panel.episodeNumber} ${title} • Panel ${panelNumber}${preview ? ` • ${preview}` : ''}`}
                                        </option>
                                    )
                                })}
                            </select>
                        </div>
                    </>
                )}

                {nodeType === 'voice-synthesis' && (
                    <>
                        <div className={`rounded px-2 py-1.5 text-[10px] ${voiceEpisodeId && voiceLineId ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                            {voiceEpisodeId && voiceLineId
                                ? `Linked episode/line: ${voiceEpisodeId} / ${voiceLineId}`
                                : 'Not linked: episodeId + lineId are required'}
                        </div>

                        <div>
                            <label className="block text-[11px] font-medium text-slate-400 mb-1.5 uppercase tracking-wide">
                                Select Episode
                            </label>
                            <select
                                value={voiceEpisodeId}
                                onChange={(event) => onBindVoiceEpisode(event.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 focus:outline-none focus:border-blue-500 transition-all"
                                disabled={!projectId || loading}
                            >
                                <option value="">Choose episode</option>
                                {(workspaceContext?.episodes || []).map((episode) => (
                                    <option key={episode.id} value={episode.id}>
                                        {episode.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-[11px] font-medium text-slate-400 mb-1.5 uppercase tracking-wide">
                                Select Voice Line
                            </label>
                            <select
                                value={voiceLineId}
                                onChange={(event) => onBindVoiceLine(voiceEpisodeId, event.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 focus:outline-none focus:border-blue-500 transition-all"
                                disabled={!projectId || loading || !voiceEpisodeId}
                            >
                                <option value="">Choose line</option>
                                {voiceLineOptions.map((line) => (
                                    <option key={line.id} value={line.id}>
                                        {`#${line.lineIndex} • ${line.speaker}: ${line.content.slice(0, 40)}`}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </>
                )}

                {loading && (
                    <div className="rounded bg-slate-800 px-2 py-1.5 text-[10px] text-slate-300">
                        Loading workspace context...
                    </div>
                )}
                {loadError && (
                    <div className="rounded bg-red-500/15 px-2 py-1.5 text-[10px] text-red-300">
                        {loadError}
                    </div>
                )}
                {issue && (
                    <div className="rounded bg-red-500/15 px-2 py-1.5 text-[10px] text-red-300">
                        {issue.message}
                        <div className="mt-1 text-red-200">{guidance}</div>
                    </div>
                )}

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onRefreshContext}
                        disabled={!projectId || loading}
                        className="px-2.5 py-1 text-[10px] rounded bg-slate-700 text-slate-200 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Refresh context
                    </button>
                    <button
                        type="button"
                        onClick={onPullFromWorkspace}
                        disabled={!projectId}
                        className="px-2.5 py-1 text-[10px] rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Pull from Workspace
                    </button>
                </div>
            </div>
        </SectionHeader>
    )
}

// ── Image Prompt & Regenerate Section (image-generate nodes only) ──
function ImagePromptSection({
    nodeType,
    outputs,
    initialOutput,
    config,
    onConfigChange,
    onRegenerate,
    isRunning,
}: {
    nodeType: string
    outputs: Record<string, unknown> | undefined
    initialOutput: Record<string, unknown> | undefined
    config: Record<string, unknown>
    onConfigChange: (key: string, value: unknown) => void
    onRegenerate: () => void
    isRunning: boolean
}) {
    const [showUsedPrompt, setShowUsedPrompt] = useState(false)

    if (nodeType !== 'image-generate') return null

    const usedPrompt = (outputs?.usedPrompt ?? initialOutput?.usedPrompt) as string | undefined
    const customPrompt = typeof config.customPrompt === 'string' ? config.customPrompt : ''
    const hasImage = !!(outputs?.image || initialOutput?.image)

    return (
        <SectionHeader title="Prompt" icon={Pencil} defaultOpen={true}>
            <div className="space-y-3">
                {/* Used prompt (read-only) */}
                {usedPrompt && (
                    <div>
                        <button
                            onClick={() => setShowUsedPrompt(!showUsedPrompt)}
                            className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-300 transition-colors mb-1.5"
                        >
                            {showUsedPrompt ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            <Eye className="w-3 h-3" />
                            <span>Used Prompt</span>
                        </button>
                        {showUsedPrompt && (
                            <div className="relative">
                                <div className="text-[11px] text-slate-400 bg-slate-900/80 rounded-lg border border-slate-700/50 p-3 max-h-48 overflow-auto font-mono whitespace-pre-wrap leading-relaxed">
                                    {usedPrompt}
                                </div>
                                <button
                                    onClick={() => {
                                        onConfigChange('customPrompt', usedPrompt)
                                    }}
                                    className="mt-1.5 flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                                    title="Copy to custom prompt for editing"
                                >
                                    <Pencil className="w-2.5 h-2.5" />
                                    Copy to Custom Prompt
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Custom prompt textarea */}
                <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1.5 uppercase tracking-wide">
                        Custom Prompt
                    </label>
                    <textarea
                        value={customPrompt}
                        onChange={(e) => onConfigChange('customPrompt', e.target.value)}
                        placeholder="Leave empty to auto-generate from panel data. Enter a custom prompt to override."
                        rows={6}
                        className="w-full px-3 py-2 text-xs rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all resize-y font-mono"
                    />
                    {customPrompt && (
                        <p className="mt-1 text-[10px] text-amber-400/70">
                            Custom prompt active — auto-generated prompt will be skipped
                        </p>
                    )}
                </div>

                {/* Regenerate button */}
                {hasImage && (
                    <button
                        onClick={onRegenerate}
                        disabled={isRunning}
                        className={`flex items-center justify-center gap-2 w-full px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                            isRunning
                                ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
                                : 'bg-gradient-to-r from-blue-600 to-violet-600 text-white hover:from-blue-500 hover:to-violet-500 shadow-lg shadow-blue-500/20'
                        }`}
                    >
                        {isRunning ? (
                            <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Generating...
                            </>
                        ) : (
                            <>
                                <RefreshCw className="w-3.5 h-3.5" />
                                {customPrompt ? 'Regenerate with Custom Prompt' : 'Regenerate Image'}
                            </>
                        )}
                    </button>
                )}
            </div>
        </SectionHeader>
    )
}

// ── Config Fields Renderer ──
function ConfigFieldsSection({ def, nodeData, onConfigChange }: {
    def: any
    nodeData: { config: Record<string, unknown>; nodeType?: string }
    onConfigChange: (key: string, value: unknown) => void
}) {
    // Hide customPrompt from settings — it has its own dedicated section in ImagePromptSection
    const visibleFields = def.configFields.filter((field: any) => {
        if (field.key === 'customPrompt' && nodeData.nodeType === 'image-generate') return false
        return true
    })
    return (
        <SectionHeader title="Settings" icon={Settings2} defaultOpen={false}>
            <div className="space-y-3">
                {visibleFields.map((field: any) => {
                    const value = nodeData.config?.[field.key] ?? field.defaultValue ?? ''
                    return (
                        <div key={field.key}>
                            <label className="block text-[11px] font-medium text-slate-400 mb-1.5 uppercase tracking-wide">
                                {field.label}
                                {field.required && <span className="text-red-400 ml-0.5">*</span>}
                            </label>

                            {field.type === 'textarea' && (
                                <textarea
                                    value={String(value)}
                                    onChange={(e) => onConfigChange(field.key, e.target.value)}
                                    placeholder={field.placeholder}
                                    rows={field.key === 'systemPrompt' || field.key === 'prompt' || field.key === 'userPrompt' ? 8 : 4}
                                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all resize-y font-mono"
                                />
                            )}

                            {field.type === 'text' && (
                                <input
                                    type="text"
                                    value={String(value)}
                                    onChange={(e) => onConfigChange(field.key, e.target.value)}
                                    placeholder={field.placeholder}
                                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all"
                                />
                            )}

                            {field.type === 'number' && (
                                <input
                                    type="number"
                                    value={Number(value)}
                                    onChange={(e) => onConfigChange(field.key, parseFloat(e.target.value) || 0)}
                                    step={field.step ?? 1}
                                    min={field.min ?? 0}
                                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all"
                                />
                            )}

                            {field.type === 'slider' && (
                                <div className="space-y-1.5">
                                    <div className="flex justify-between items-center">
                                        <span className="text-[10px] text-slate-600">{field.min ?? 0}</span>
                                        <span className="text-xs font-mono font-semibold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
                                            {Number(value).toFixed((field.step ?? 1) < 1 ? 1 : 0)}
                                        </span>
                                        <span className="text-[10px] text-slate-600">{field.max ?? 1}</span>
                                    </div>
                                    <input
                                        type="range"
                                        value={Number(value)}
                                        onChange={(e) => onConfigChange(field.key, parseFloat(e.target.value))}
                                        min={field.min ?? 0}
                                        max={field.max ?? 1}
                                        step={field.step ?? 0.1}
                                        className="w-full h-1.5 accent-blue-500 cursor-pointer"
                                    />
                                </div>
                            )}

                            {field.type === 'select' && (
                                <select
                                    value={String(value)}
                                    onChange={(e) => onConfigChange(field.key, e.target.value)}
                                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 focus:outline-none focus:border-blue-500 transition-all"
                                >
                                    <option value="">Select...</option>
                                    {field.options?.map((opt: any) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            )}

                            {(field.type === 'model-picker' || field.type === 'voice-picker') && (
                                <input
                                    type="text"
                                    value={String(value)}
                                    onChange={(e) => onConfigChange(field.key, e.target.value)}
                                    placeholder={field.type === 'model-picker' ? 'e.g., gpt-4o, gemini-2.0-flash' : 'Voice preset name or ID'}
                                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all"
                                />
                            )}

                            {field.type === 'toggle' && (
                                <button
                                    onClick={() => onConfigChange(field.key, !value)}
                                    className={`relative w-10 h-5 rounded-full transition-colors ${value ? 'bg-blue-500' : 'bg-slate-700'}`}
                                >
                                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`} />
                                </button>
                            )}
                        </div>
                    )
                })}
            </div>
        </SectionHeader>
    )
}

// ── Node type visual icon mapping ──
const NODE_ICON_MAP: Record<string, React.ElementType> = {
    'text-input': FileText,
    'llm-prompt': Bot,
    'character-extract': Users,
    'scene-extract': MapPin,
    'storyboard': LayoutGrid,
    'image-generate': ImageIcon,
    'video-generate': Video,
    'voice-synthesis': Mic,
    'upscale': ZoomIn,
    'video-compose': Film,
}

// ── Main Panel ──
export function NodeConfigPanel() {
    const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
    const nodes = useWorkflowStore((s) => s.nodes)
    const executionState = useWorkflowStore((s) => selectedNodeId ? s.nodeExecutionStates[selectedNodeId] : undefined)
    const selectNode = useWorkflowStore((s) => s.selectNode)
    const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig)
    const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
    const executeSingleNode = useWorkflowStore((s) => s.executeSingleNode)
    const projectId = useWorkflowStore((s) => s.meta.projectId)
    const loadFromJSON = useWorkflowStore((s) => s.loadFromJSON)
    const setMeta = useWorkflowStore((s) => s.setMeta)

    const selectedNode = nodes.find((n) => n.id === selectedNodeId)
    const nodeData = selectedNode?.data as { nodeType: string; config: Record<string, unknown>; label?: string; initialOutput?: Record<string, unknown> } | undefined
    const def = nodeData ? NODE_TYPE_REGISTRY[nodeData.nodeType] : undefined
    const workspaceLinked = nodeData
        ? getWorkflowBoundaryDescriptor(nodeData.nodeType).kind === 'workspace-linked'
        : false

    const [workspaceContextData, setWorkspaceContextData] = useState<WorkspaceBindingContextData | null>(null)
    const [workspaceContextLoading, setWorkspaceContextLoading] = useState(false)
    const [workspaceContextError, setWorkspaceContextError] = useState<string | null>(null)

    const handleConfigChange = useCallback(
        (key: string, value: unknown) => {
            if (!selectedNodeId) return
            updateNodeConfig(selectedNodeId, { [key]: value })
        },
        [selectedNodeId, updateNodeConfig],
    )

    const handleRun = useCallback(() => {
        if (!selectedNodeId) return
        executeSingleNode(selectedNodeId)
    }, [selectedNodeId, executeSingleNode])

    const loadWorkspaceContext = useCallback(async () => {
        if (!projectId || !workspaceLinked) return
        setWorkspaceContextLoading(true)
        setWorkspaceContextError(null)
        try {
            const result = await fetchWorkflowWorkspaceContext(projectId)
            setWorkspaceContextData({
                episodes: result.episodes,
                panels: result.panels,
                voiceLinesByEpisode: result.voiceLinesByEpisode,
            })
        } catch (error) {
            const message = error instanceof Error && error.message.trim().length > 0
                ? error.message
                : 'Failed to load workspace binding options'
            setWorkspaceContextError(message)
        } finally {
            setWorkspaceContextLoading(false)
        }
    }, [projectId, workspaceLinked])

    useEffect(() => {
        if (!workspaceLinked) {
            setWorkspaceContextData(null)
            setWorkspaceContextError(null)
            setWorkspaceContextLoading(false)
            return
        }
        if (!projectId) {
            setWorkspaceContextData(null)
            setWorkspaceContextError('Missing projectId in workflow context')
            return
        }
        void loadWorkspaceContext()
    }, [loadWorkspaceContext, projectId, workspaceLinked])

    const handleBindPanel = useCallback((panelId: string) => {
        if (!selectedNodeId || !nodeData) return
        const trimmed = panelId.trim()
        const workspaceBinding = nodeData.nodeType === 'video-generate'
            ? 'panel-video-generate'
            : 'panel-image-generate'
        updateNodeData(selectedNodeId, {
            panelId: trimmed || null,
            workspaceBinding,
        })
    }, [nodeData, selectedNodeId, updateNodeData])

    const handleBindVoiceEpisode = useCallback((episodeId: string) => {
        if (!selectedNodeId) return
        updateNodeConfig(selectedNodeId, {
            episodeId,
            lineId: '',
        })
    }, [selectedNodeId, updateNodeConfig])

    const handleBindVoiceLine = useCallback((episodeId: string, lineId: string) => {
        if (!selectedNodeId) return
        updateNodeConfig(selectedNodeId, {
            episodeId,
            lineId,
        })
    }, [selectedNodeId, updateNodeConfig])

    const handlePullFromWorkspace = useCallback(async () => {
        if (!projectId) return
        const confirmed = window.confirm('Pull from Workspace will replace current workflow graph with synced workspace graph. Continue?')
        if (!confirmed) return
        try {
            const response = await fetch(`/api/workflows/sync-project?projectId=${encodeURIComponent(projectId)}`)
            if (!response.ok) throw new Error('Failed to pull from workspace')
            const result = await response.json()
            if (!result.graphData) throw new Error('Workspace sync returned empty graph data')
            loadFromJSON(result.graphData)
            setMeta({ name: `${result.projectName} Sync`, isSaved: false, id: null })
        } catch (error) {
            const message = error instanceof Error && error.message.trim().length > 0
                ? error.message
                : 'Failed to pull workflow from workspace'
            setWorkspaceContextError(message)
        }
    }, [loadFromJSON, projectId, setMeta])

    const workspaceContext = useMemo(() => {
        if (!workspaceContextData) return null
        return workspaceContextData
    }, [workspaceContextData])

    // ── Empty state ──
    if (!selectedNode || !def || !nodeData) {
        return (
            <div
                className="h-full flex flex-col items-center justify-center p-6 text-center"
                style={{ background: '#0f172a', borderLeft: '1px solid #1e293b' }}
            >
                <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center mb-4">
                    <Settings2 className="w-7 h-7 text-slate-700" />
                </div>
                <p className="text-sm text-slate-500 font-medium">Node Details</p>
                <p className="text-xs text-slate-600 mt-1">Click any node on the canvas</p>
                <p className="text-[10px] text-slate-700 mt-4">Tip: Click a node to see its<br />configuration, preview, and output</p>
            </div>
        )
    }

    const NodeIcon = NODE_ICON_MAP[nodeData.nodeType] || Settings2
    const nodeLabel = nodeData.label || def.title
    const nd = nodeData as any
    // Full items with IDs (for generate buttons)
    const characterItems: { id: string; name: string; imageUrl?: string }[] =
        nd.initialOutput?.characters || []
    const locationItems: { id: string; name: string; imageUrl?: string }[] =
        nd.initialOutput?.scenes || []

    return (
        <div
            className="h-full flex flex-col"
            style={{ background: '#0f172a', borderLeft: '1px solid #1e293b' }}
        >
            {/* ── Header ── */}
            <div className="flex-shrink-0">
                <div
                    className="flex items-center gap-3 px-4 py-3"
                    style={{ borderBottom: `2px solid ${def.color}` }}
                >
                    <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: `${def.color}20` }}
                    >
                        <NodeIcon className="w-4 h-4" style={{ color: def.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-slate-200 truncate">{nodeLabel}</h3>
                        <p className="text-[10px] text-slate-500 truncate">{def.description}</p>
                    </div>
                    <button
                        onClick={() => selectNode(null)}
                        className="p-1 rounded hover:bg-slate-800 transition-colors flex-shrink-0"
                    >
                        <X className="w-4 h-4 text-slate-400" />
                    </button>
                </div>

                {/* Run button bar */}
                <ExecutionStatusBar
                    executionState={executionState}
                    onRun={handleRun}
                />
            </div>

            {/* ── Scrollable content ── */}
            <div className="flex-1 overflow-y-auto">
                {/* Character gallery with inline generate */}
                {nd.isCharacterSummary && characterItems.length > 0 && (
                    <GenerativeAssetGallery
                        items={characterItems}
                        type="character"
                        projectId={projectId}
                        title="Character Models"
                        nodeId={selectedNodeId}
                        updateNodeData={updateNodeData}
                    />
                )}
                {/* Location gallery with inline generate */}
                {nd.isLocationSummary && locationItems.length > 0 && (
                    <GenerativeAssetGallery
                        items={locationItems}
                        type="location"
                        projectId={projectId}
                        title="Location Images"
                        nodeId={selectedNodeId}
                        updateNodeData={updateNodeData}
                    />
                )}

                {/* Preview sections — show first for visual impact */}
                <RuntimeContextSection
                    nodeId={selectedNodeId || selectedNode.id}
                    nodeType={nodeData.nodeType}
                    nodeData={nodeData as unknown as Record<string, unknown>}
                />

                <WorkspaceBindingSection
                    nodeId={selectedNodeId || selectedNode.id}
                    nodeType={nodeData.nodeType}
                    nodeData={nodeData as unknown as Record<string, unknown>}
                    projectId={projectId}
                    workspaceContext={workspaceContext}
                    loading={workspaceContextLoading}
                    loadError={workspaceContextError}
                    onBindPanel={handleBindPanel}
                    onBindVoiceEpisode={handleBindVoiceEpisode}
                    onBindVoiceLine={handleBindVoiceLine}
                    onPullFromWorkspace={handlePullFromWorkspace}
                    onRefreshContext={loadWorkspaceContext}
                />

                <ImagePreviewSection
                    outputs={executionState?.outputs}
                    initialOutput={nodeData.initialOutput}
                />
                <ImagePromptSection
                    nodeType={nodeData.nodeType}
                    outputs={executionState?.outputs as Record<string, unknown> | undefined}
                    initialOutput={nodeData.initialOutput}
                    config={nodeData.config}
                    onConfigChange={handleConfigChange}
                    onRegenerate={handleRun}
                    isRunning={executionState?.status === 'running'}
                />
                <VideoPreviewSection
                    outputs={executionState?.outputs}
                    initialOutput={nodeData.initialOutput}
                />
                <AudioPreviewSection
                    outputs={executionState?.outputs}
                    initialOutput={nodeData.initialOutput}
                />
                <TextOutputSection
                    outputs={executionState?.outputs}
                    initialOutput={nodeData.initialOutput}
                />

                {/* Text Input — show content preview for text-input nodes */}
                {nodeData.nodeType === 'text-input' && nodeData.config?.content && (
                    <SectionHeader title="Content Preview" icon={FileText} defaultOpen={true}>
                        <div className="text-xs text-slate-300 bg-slate-900 rounded-lg border border-slate-700 p-3 max-h-48 overflow-auto font-mono whitespace-pre-wrap">
                            {String(nodeData.config.content).slice(0, 500)}
                            {String(nodeData.config.content).length > 500 && (
                                <span className="text-slate-500">... ({String(nodeData.config.content).length} chars)</span>
                            )}
                        </div>
                    </SectionHeader>
                )}

                {/* Config fields — collapsed by default to prioritize preview */}
                <ConfigFieldsSection
                    def={def}
                    nodeData={nodeData}
                    onConfigChange={handleConfigChange}
                />

                {/* Node info section */}
                <SectionHeader title="Info" icon={Settings2} defaultOpen={false}>
                    <div className="space-y-2 text-[10px]">
                        <div className="flex justify-between">
                            <span className="text-slate-500">Node ID</span>
                            <span className="text-slate-400 font-mono">{selectedNodeId?.slice(0, 16)}...</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Type</span>
                            <span className="text-slate-400">{nodeData.nodeType}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Category</span>
                            <span className="text-slate-400 capitalize">{def.category}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Inputs</span>
                            <span className="text-slate-400">{def.inputs.length}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Outputs</span>
                            <span className="text-slate-400">{def.outputs.length}</span>
                        </div>
                    </div>
                </SectionHeader>
            </div>
        </div>
    )
}
