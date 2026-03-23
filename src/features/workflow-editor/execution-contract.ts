import { NODE_TYPE_REGISTRY } from '@/lib/workflow-engine/registry'

export interface WorkflowPanelMediaSnapshot {
  imageUrl: string | null
  videoUrl: string | null
  previousImageUrl?: string | null
  candidateImages?: string[]
}

export interface WorkflowVoiceLineSnapshot {
  id: string
  audioUrl: string | null
  speaker: string | null
  content: string | null
  audioDuration: number | null
}

export interface WorkflowVoiceLineTarget {
  episodeId: string
  lineId: string
}

function hasStringValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isMediaOutputKey(key: string): boolean {
  return key === 'image' || key === 'video' || key === 'audio'
}

function isUsableOutputValue(key: string, value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (isMediaOutputKey(key)) return hasStringValue(value)
  return true
}

export function resolvePanelIdFromNode(nodeId: string, nodeData?: Record<string, unknown> | null): string | null {
  const fromData = nodeData?.panelId
  if (typeof fromData === 'string' && fromData.trim().length > 0) {
    return fromData.trim()
  }
  if (nodeId.startsWith('img_') || nodeId.startsWith('vid_')) {
    const panelId = nodeId.replace(/^(img_|vid_)/, '')
    return panelId || null
  }
  return null
}

export function resolveVoiceLineTargetFromNode(
  nodeData?: Record<string, unknown> | null,
): WorkflowVoiceLineTarget | null {
  if (!nodeData) return null

  const config = (nodeData.config && typeof nodeData.config === 'object' && !Array.isArray(nodeData.config))
    ? nodeData.config as Record<string, unknown>
    : {}

  const episodeId = typeof config.episodeId === 'string' && config.episodeId.trim().length > 0
    ? config.episodeId.trim()
    : null
  const lineId = typeof config.lineId === 'string' && config.lineId.trim().length > 0
    ? config.lineId.trim()
    : null

  if (!episodeId || !lineId) return null
  return { episodeId, lineId }
}

export function normalizeMediaOutputsForNode(
  nodeType: string,
  panel: WorkflowPanelMediaSnapshot,
): Record<string, unknown> {
  if (nodeType === 'image-generate') {
    const outputs: Record<string, unknown> = {}
    if (hasStringValue(panel.imageUrl)) {
      outputs.image = panel.imageUrl
    }
    if (hasStringValue(panel.previousImageUrl)) {
      outputs.previousImageUrl = panel.previousImageUrl
    }
    if (Array.isArray(panel.candidateImages) && panel.candidateImages.length > 0) {
      outputs.candidateImages = panel.candidateImages
    }
    return outputs
  }
  if (nodeType === 'video-generate') {
    return hasStringValue(panel.videoUrl) ? { video: panel.videoUrl } : {}
  }

  const outputs: Record<string, unknown> = {}
  if (hasStringValue(panel.imageUrl)) outputs.image = panel.imageUrl
  if (hasStringValue(panel.videoUrl)) outputs.video = panel.videoUrl
  return outputs
}

export function normalizeVoiceOutputsForNode(
  nodeType: string,
  voiceLine: WorkflowVoiceLineSnapshot,
): Record<string, unknown> {
  if (nodeType !== 'voice-synthesis') return {}
  if (!hasStringValue(voiceLine.audioUrl)) return {}
  return {
    audio: voiceLine.audioUrl,
    lineId: voiceLine.id,
    speaker: voiceLine.speaker || '',
    content: voiceLine.content || '',
    audioDuration: voiceLine.audioDuration,
  }
}

export function isUsableNodeOutput(
  nodeType: string,
  outputs: Record<string, unknown> | null | undefined,
): boolean {
  if (!outputs) return false
  const keys = Object.keys(outputs).filter((key) => !key.startsWith('_'))
  if (keys.length === 0) return false

  const definition = NODE_TYPE_REGISTRY[nodeType]
  const requiredOutputKeys = definition
    ? definition.outputs.filter((output) => output.required).map((output) => output.id)
    : []

  if (requiredOutputKeys.length === 0) {
    return keys.some((key) => isUsableOutputValue(key, outputs[key]))
  }

  return requiredOutputKeys.every((key) => isUsableOutputValue(key, outputs[key]))
}

export function toNodeInitialOutput(
  currentInitialOutput: Record<string, unknown> | null | undefined,
  outputs: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(currentInitialOutput || {}), ...outputs }
  if (typeof merged.image === 'string') {
    merged.imageUrl = merged.image
  }
  if (typeof merged.video === 'string') {
    merged.videoUrl = merged.video
  }
  if (typeof merged.audio === 'string') {
    merged.audioUrl = merged.audio
  }
  return merged
}
