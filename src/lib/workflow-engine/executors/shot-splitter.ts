import type { NodeExecutor } from './types'

interface ShotMatchCandidate {
  assetId: string
  name: string
  aliases: string[]
}

interface SceneMatchCandidate {
  assetId: string
  name: string
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => readString(item))
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    const rawValue = value.trim()
    if (!rawValue) return []
    try {
      return readStringArray(JSON.parse(rawValue) as unknown)
    } catch {
      return []
    }
  }

  return []
}

function toObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
  )
}

function normalizeShotContent(value: string): string {
  return value
    .replace(/^\s*([-*•]+|\d+[\.\)])\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitByLines(text: string): string[] {
  return text
    .split(/\r?\n+/u)
    .map(normalizeShotContent)
    .filter(Boolean)
}

function splitByParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/u)
    .map((paragraph) => normalizeShotContent(paragraph.replace(/\r?\n+/gu, ' ')))
    .filter(Boolean)
}

function splitBySentences(text: string): string[] {
  const normalized = text.replace(/\r?\n+/gu, ' ').trim()
  if (!normalized) return []

  const matches = normalized.match(/[^.!?。！？\n]+[.!?。！？]?/gu) || []
  return matches
    .map(normalizeShotContent)
    .filter(Boolean)
}

function splitScript(text: string, mode: string): string[] {
  if (mode === 'paragraph') return splitByParagraphs(text)
  if (mode === 'sentence') return splitBySentences(text)
  return splitByLines(text)
}

function normalizeMatchKey(value: string): string {
  return value.trim().toLowerCase()
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const normalized = normalizeMatchKey(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(value.trim())
  }

  return result
}

function readAssetId(record: Record<string, unknown>): string {
  return readString(record.assetId) || readString(record.id)
}

function collectCharacterCandidates(raw: unknown): ShotMatchCandidate[] {
  const records = Array.isArray(raw)
    ? toObjectArray(raw)
    : toObjectArray((raw as Record<string, unknown> | null)?.characters)

  return records
    .map((record) => ({
      assetId: readAssetId(record),
      name: readString(record.name),
      aliases: readStringArray(record.aliases),
    }))
    .filter((record) => record.name.length > 0)
}

function collectSceneCandidates(raw: unknown): SceneMatchCandidate[] {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null
  const records = Array.isArray(raw)
    ? toObjectArray(raw)
    : toObjectArray(record?.scenes || record?.locations)

  return records
    .map((scene) => ({
      assetId: readAssetId(scene),
      name: readString(scene.name),
    }))
    .filter((scene) => scene.name.length > 0)
}

function findMatchingCharacters(text: string, candidates: ShotMatchCandidate[]): ShotMatchCandidate[] {
  const normalizedText = normalizeMatchKey(text)
  const matches = candidates.flatMap((candidate) => {
      const namesToMatch = [candidate.name, ...candidate.aliases]
      const hasMatch = namesToMatch.some((candidateName) => normalizedText.includes(normalizeMatchKey(candidateName)))
      return hasMatch ? [candidate] : []
    })

  const seen = new Set<string>()
  return matches.filter((candidate) => {
    const key = normalizeMatchKey(candidate.assetId || candidate.name)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function findMatchingScene(text: string, candidates: SceneMatchCandidate[]): SceneMatchCandidate | null {
  const normalizedText = normalizeMatchKey(text)
  const match = candidates.find((candidate) => normalizedText.includes(normalizeMatchKey(candidate.name)))
  return match || null
}

function readPositiveInteger(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  return fallback
}

type LocationBindingMode = 'inherit-last' | 'explicit-only'

function readLocationBindingMode(value: unknown): LocationBindingMode {
  if (value === 'explicit-only') return 'explicit-only'
  return 'inherit-last'
}

export const executeShotSplitter: NodeExecutor = async (ctx) => {
  const inputText = typeof ctx.inputs.text === 'string' ? ctx.inputs.text : ''
  if (!inputText.trim()) {
    throw new Error('Input text is required for shot splitting.')
  }

  const splitMode = readString(ctx.config.splitMode) || 'line'
  const locationBindingMode = readLocationBindingMode(ctx.config.locationBindingMode)
  const maxShots = readPositiveInteger(ctx.config.maxShots, 24)
  const segments = splitScript(inputText, splitMode).slice(0, maxShots)
  const characterCandidates = collectCharacterCandidates(ctx.inputs.characters)
  const sceneCandidates = collectSceneCandidates(ctx.inputs.scenes)
  const defaultScene = sceneCandidates[0] || null
  let lastResolvedScene: SceneMatchCandidate | null = defaultScene
  let explicitLocationMatchCount = 0
  let inheritedLocationMatchCount = 0

  const panels = segments.map((segment, index) => {
    const matchedCharacters = findMatchingCharacters(segment, characterCandidates)
    const explicitScene = findMatchingScene(segment, sceneCandidates)
    const resolvedScene = explicitScene
      || (locationBindingMode === 'inherit-last' ? lastResolvedScene : null)
    const locationSource = explicitScene
      ? 'explicit'
      : (resolvedScene ? 'inherited' : 'none')

    if (locationSource === 'explicit') explicitLocationMatchCount += 1
    if (locationSource === 'inherited') inheritedLocationMatchCount += 1

    if (explicitScene) {
      lastResolvedScene = explicitScene
    } else if (!lastResolvedScene && locationBindingMode === 'inherit-last') {
      lastResolvedScene = defaultScene
    }

    return {
      panelIndex: index,
      panel_number: index + 1,
      description: segment,
      source_text: segment,
      imagePrompt: segment,
      video_prompt: segment,
      videoPrompt: segment,
      characters: matchedCharacters.map((character) => character.name),
      character_asset_ids: matchedCharacters
        .map((character) => character.assetId)
        .filter((assetId) => assetId.length > 0),
      location: resolvedScene?.name || '',
      location_asset_id: resolvedScene?.assetId || '',
      location_source: locationSource,
    }
  })

  const matchedLocationCount = panels.filter((panel) => readString(panel.location).length > 0).length

  return {
    outputs: {
      panels,
      summary: `Split script into ${panels.length} shot${panels.length === 1 ? '' : 's'} using ${splitMode} mode.`,
    },
    message: `Created ${panels.length} shot${panels.length === 1 ? '' : 's'}.`,
    metadata: {
      splitMode,
      locationBindingMode,
      shotCount: panels.length,
      matchedCharacterCount: panels.reduce((total, panel) => total + panel.characters.length, 0),
      matchedLocationCount,
      explicitLocationMatchCount,
      inheritedLocationMatchCount,
    },
  }
}
