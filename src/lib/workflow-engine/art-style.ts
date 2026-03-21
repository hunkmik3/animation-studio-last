import type { Locale } from '@/i18n/routing'
import { ART_STYLES, getArtStylePrompt } from '@/lib/constants'

export const WORKFLOW_ART_STYLE_OPTIONS = ART_STYLES.map((style) => ({
  label: style.label,
  value: style.value,
}))

const LEGACY_WORKFLOW_ART_STYLE_MAP: Record<string, string> = {
  anime: 'japanese-anime',
  comic: 'american-comic',
  realistic: 'realistic',
  watercolor: 'chinese-comic',
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function appendClause(base: string, clause: string, locale: Locale): string {
  const trimmedBase = base.trim()
  const trimmedClause = clause.trim()
  if (!trimmedClause) return trimmedBase
  if (!trimmedBase) return trimmedClause
  const separator = locale === 'zh' ? '，' : ', '
  return `${trimmedBase}${separator}${trimmedClause}`
}

export function normalizeWorkflowArtStyle(value: unknown): string | null {
  const rawValue = readString(value)
  if (!rawValue) return null

  const directMatch = ART_STYLES.find((style) => style.value === rawValue)
  if (directMatch) return directMatch.value

  const legacyMatch = LEGACY_WORKFLOW_ART_STYLE_MAP[rawValue]
  return legacyMatch || null
}

export function resolveWorkflowArtStylePrompt(
  artStyle: unknown,
  locale: Locale,
): { artStyle: string | null; artStylePrompt: string } {
  const normalizedStyle = normalizeWorkflowArtStyle(artStyle)
  if (!normalizedStyle) {
    return {
      artStyle: null,
      artStylePrompt: '',
    }
  }

  return {
    artStyle: normalizedStyle,
    artStylePrompt: getArtStylePrompt(normalizedStyle, locale),
  }
}

export function applyWorkflowArtStyleToPrompt(params: {
  prompt: string
  artStylePrompt: string
  locale: Locale
  mode: 'image' | 'video'
}): string {
  const basePrompt = params.prompt.trim()
  if (!params.artStylePrompt.trim()) return basePrompt

  const clause = params.locale === 'zh'
    ? params.mode === 'image'
      ? `整体画面风格：${params.artStylePrompt}`
      : `整体视频视觉风格：${params.artStylePrompt}`
    : params.mode === 'image'
      ? `overall visual style: ${params.artStylePrompt}`
      : `overall video visual style: ${params.artStylePrompt}`

  return appendClause(basePrompt, clause, params.locale)
}

export function buildStoryboardStyleDirective(params: {
  artStylePrompt: string
  locale: Locale
}): string {
  if (!params.artStylePrompt.trim()) return ''
  if (params.locale === 'zh') {
    return `目标视觉风格：${params.artStylePrompt}。请在分镜描述、镜头设计、角色呈现和场景氛围中保持该风格统一。`
  }

  return `Target visual style: ${params.artStylePrompt}. Keep this style consistent across panel descriptions, shot design, character presentation, and environment mood.`
}
