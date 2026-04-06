import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import {
  buildImageBillingPayload,
  getUserModelConfig,
  resolveModelCapabilityGenerationOptions,
} from '@/lib/config-service'
import { generateImage } from '@/lib/generator-api'
import type { MediaRef } from '@/lib/media/types'
import {
  applyWorkflowArtStyleToPrompt,
  resolveWorkflowArtStylePrompt,
} from '../art-style'
import type { NodeExecutor } from './types'
import {
  normalizeStandaloneMediaInput,
  persistStandaloneGeneratedMedia,
  resolveStandaloneGeneratedMediaSource,
} from './standalone-generation'
import {
  getCharacterContinuityMemoryCandidateKeys,
  getLocationContinuityMemoryCandidateKeys,
  normalizeWorkflowContinuityMemory,
  type WorkflowContinuityMemory,
} from '../continuity-memory'

function readConfigString(config: Record<string, unknown>, key: string): string {
  const raw = config[key]
  return typeof raw === 'string' ? raw.trim() : ''
}

function readOptionalStringInput(inputs: Record<string, unknown>, key: string): string {
  const raw = inputs[key]
  return typeof raw === 'string' ? raw.trim() : ''
}

function readOptionalNumberConfig(config: Record<string, unknown>, key: string): number | null {
  const raw = config[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

function readCandidateCount(config: Record<string, unknown>): number {
  const rawValue = readOptionalNumberConfig(config, 'candidateCount') ?? readOptionalNumberConfig(config, 'count') ?? 1
  const normalized = Math.floor(rawValue)
  return Math.max(1, Math.min(4, normalized))
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

function toObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
    )
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return [value as Record<string, unknown>]
  }
  return []
}

function readStringArrayLoose(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0)
  }
  if (typeof value === 'string') {
    const rawValue = value.trim()
    if (!rawValue) return []
    try {
      return readStringArrayLoose(JSON.parse(rawValue) as unknown)
    } catch {
      return [rawValue]
    }
  }
  return []
}

type ContinuityKind = 'previous-panel-image' | 'character-reference' | 'location-reference'

function readContinuityKind(value: unknown): ContinuityKind | '' {
  if (value === 'previous-panel-image') return value
  if (value === 'character-reference') return value
  if (value === 'location-reference') return value
  return ''
}

function readContinuityMetaRecords(
  inputs: Record<string, unknown>,
  key: string,
): Array<Record<string, unknown>> {
  return toObjectArray(inputs[key])
}

function readContinuitySourceKinds(records: Array<Record<string, unknown>>): ContinuityKind[] {
  return records
    .map((record) => readContinuityKind(record.continuityKind))
    .filter((kind): kind is ContinuityKind => kind.length > 0)
}

function readContinuitySourceNodeIds(records: Array<Record<string, unknown>>, kind: ContinuityKind): string[] {
  return uniqueStrings(
    records
      .filter((record) => readContinuityKind(record.continuityKind) === kind)
      .map((record) => (typeof record.sourceNodeId === 'string' ? record.sourceNodeId.trim() : ''))
      .filter((value) => value.length > 0),
  )
}

function readContinuityCharacterNames(records: Array<Record<string, unknown>>): string[] {
  return uniqueStrings(
    records
      .filter((record) => readContinuityKind(record.continuityKind) === 'character-reference')
      .map((record) => (typeof record.characterName === 'string' ? record.characterName.trim() : ''))
      .filter((value) => value.length > 0),
  )
}

function readAppearanceLockTokens(records: Array<Record<string, unknown>>): string[] {
  const tokens = records
    .filter((record) => readContinuityKind(record.continuityKind) === 'character-reference')
    .flatMap((record) => [
      ...readStringArrayLoose(record.appearanceLockTokens),
      ...readStringArrayLoose(record.panelAppearanceHints),
      ...readStringArrayLoose(record.identityTokens),
    ])
  return uniqueStrings(tokens)
}

function readContinuityLocationNames(records: Array<Record<string, unknown>>): string[] {
  return uniqueStrings(
    records
      .filter((record) => readContinuityKind(record.continuityKind) === 'location-reference')
      .map((record) => (typeof record.locationName === 'string' ? record.locationName.trim() : ''))
      .filter((value) => value.length > 0),
  )
}

function readContinuityStateRecord(inputs: Record<string, unknown>): Record<string, unknown> {
  if (!inputs.continuityState || typeof inputs.continuityState !== 'object' || Array.isArray(inputs.continuityState)) {
    return {}
  }
  return inputs.continuityState as Record<string, unknown>
}

function readContinuityStateCharacterSources(inputs: Record<string, unknown>): Array<Record<string, unknown>> {
  const continuityState = readContinuityStateRecord(inputs)
  const sources = continuityState.sources
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) return []
  return toObjectArray((sources as Record<string, unknown>).characterReferences)
}

function readContinuityStateLocationSource(inputs: Record<string, unknown>): Record<string, unknown> | null {
  const continuityState = readContinuityStateRecord(inputs)
  const sources = continuityState.sources
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) return null
  const locationReference = (sources as Record<string, unknown>).locationReference
  if (!locationReference || typeof locationReference !== 'object' || Array.isArray(locationReference)) return null
  return locationReference as Record<string, unknown>
}

function readContinuityStateCharacterNames(inputs: Record<string, unknown>): string[] {
  const continuityState = readContinuityStateRecord(inputs)
  const identity = continuityState.identity
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return []
  return readStringArrayLoose((identity as Record<string, unknown>).characterNames)
}

function readContinuityStateAppearanceTokens(inputs: Record<string, unknown>): string[] {
  const continuityState = readContinuityStateRecord(inputs)
  const identity = continuityState.identity
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return []
  return readStringArrayLoose((identity as Record<string, unknown>).appearanceLockTokens)
}

function readContinuityStateEnvironmentTokens(inputs: Record<string, unknown>): string[] {
  const continuityState = readContinuityStateRecord(inputs)
  const identity = continuityState.identity
  const identityTokens = (!identity || typeof identity !== 'object' || Array.isArray(identity))
    ? []
    : readStringArrayLoose((identity as Record<string, unknown>).environmentLockTokens)

  const locationSource = readContinuityStateLocationSource(inputs)
  const locationTokens = locationSource
    ? readStringArrayLoose(locationSource.environmentLockTokens)
    : []

  return uniqueStrings([...identityTokens, ...locationTokens])
}

function readEnvironmentLockTokens(records: Array<Record<string, unknown>>): string[] {
  return uniqueStrings(
    records
      .filter((record) => readContinuityKind(record.continuityKind) === 'location-reference')
      .flatMap((record) => readStringArrayLoose(record.environmentLockTokens)),
  )
}

function buildContinuityPrompt(params: {
  prompt: string
  continuityReferenceCount: number
  previousPanelReferenceCount: number
  characterReferenceCount: number
  locationReferenceCount: number
  continuityCharacterNames: string[]
  continuityLocationNames: string[]
  appearanceLockTokens: string[]
  environmentLockTokens: string[]
}): string {
  if (params.continuityReferenceCount <= 0) {
    return params.prompt
  }

  const lines: string[] = [
    '[Continuity Constraints]',
    'Treat provided references as canonical continuity anchors.',
    'Keep character identity and outfit continuity unless the scene explicitly requires a visible change.',
    'Keep environment geometry and background prop continuity unless the scene explicitly requires a visible change.',
    'Do not add or remove background objects not implied by the current panel action.',
    'Preserve camera side/orientation relative to the environment layout when continuing a sequence.',
    `Continuity sources: previous-panel=${params.previousPanelReferenceCount}, character=${params.characterReferenceCount}, location=${params.locationReferenceCount}.`,
  ]

  if (params.continuityCharacterNames.length > 0) {
    lines.push(`Character anchors: ${params.continuityCharacterNames.join(', ')}.`)
  }
  if (params.continuityLocationNames.length > 0) {
    lines.push(`Location anchors: ${params.continuityLocationNames.join(', ')}.`)
  }
  if (params.appearanceLockTokens.length > 0) {
    lines.push(`Appearance lock cues: ${params.appearanceLockTokens.join(' | ')}.`)
  }
  if (params.environmentLockTokens.length > 0) {
    lines.push(`Environment lock cues: ${params.environmentLockTokens.join(' | ')}.`)
  }

  return `${params.prompt}\n\n${lines.join('\n')}`
}

function readLocationName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

interface ContinuityMemoryCharacterResolution {
  preferredReferences: string[]
  latestReferences: string[]
  usedKeys: string[]
  missingKeys: string[]
  appearanceTokens: string[]
}

interface ContinuityMemoryLocationResolution {
  preferredReferences: string[]
  latestReferences: string[]
  usedKeys: string[]
  missingKeys: string[]
  environmentTokens: string[]
}

function resolveCharacterContinuityMemory(params: {
  memory: WorkflowContinuityMemory
  continuityCharacterNames: string[]
  continuityStateCharacters: Array<Record<string, unknown>>
}): ContinuityMemoryCharacterResolution {
  const preferredReferences: string[] = []
  const latestReferences: string[] = []
  const usedKeys: string[] = []
  const missingKeys: string[] = []
  const appearanceTokens: string[] = []

  const lookupRequests: Array<{ characterAssetId?: string; canonicalName?: string }> = []
  for (const record of params.continuityStateCharacters) {
    lookupRequests.push({
      characterAssetId: typeof record.characterAssetId === 'string' ? record.characterAssetId : '',
      canonicalName: typeof record.characterName === 'string' ? record.characterName : '',
    })
  }
  for (const characterName of params.continuityCharacterNames) {
    lookupRequests.push({ canonicalName: characterName })
  }

  for (const lookupRequest of lookupRequests) {
    const candidateKeys = getCharacterContinuityMemoryCandidateKeys(lookupRequest)
    if (candidateKeys.length === 0) continue
    const key = candidateKeys.find((candidateKey) => params.memory.characters[candidateKey])
      || candidateKeys[0]
    if (!key) continue
    const entry = params.memory.characters[key]
    if (!entry) {
      missingKeys.push(key)
      continue
    }

    usedKeys.push(key)
    if (entry.preferredReferenceImage) preferredReferences.push(entry.preferredReferenceImage)
    if (entry.latestGoodImage) latestReferences.push(entry.latestGoodImage)
    appearanceTokens.push(...entry.appearanceLockTokens, ...entry.identityTokens)
  }

  return {
    preferredReferences: uniqueStrings(preferredReferences),
    latestReferences: uniqueStrings(latestReferences),
    usedKeys: uniqueStrings(usedKeys),
    missingKeys: uniqueStrings(missingKeys),
    appearanceTokens: uniqueStrings(appearanceTokens),
  }
}

function resolveLocationContinuityMemory(params: {
  memory: WorkflowContinuityMemory
  continuityLocationNames: string[]
  continuityStateLocation: Record<string, unknown> | null
}): ContinuityMemoryLocationResolution {
  const preferredReferences: string[] = []
  const latestReferences: string[] = []
  const usedKeys: string[] = []
  const missingKeys: string[] = []
  const environmentTokens: string[] = []

  const lookupRequests: Array<{ locationAssetId?: string; locationName?: string }> = []
  if (params.continuityStateLocation) {
    lookupRequests.push({
      locationAssetId: typeof params.continuityStateLocation.locationAssetId === 'string'
        ? params.continuityStateLocation.locationAssetId
        : '',
      locationName: typeof params.continuityStateLocation.locationName === 'string'
        ? params.continuityStateLocation.locationName
        : '',
    })
  }
  for (const locationName of params.continuityLocationNames) {
    lookupRequests.push({ locationName })
  }

  for (const lookupRequest of lookupRequests) {
    const candidateKeys = getLocationContinuityMemoryCandidateKeys(lookupRequest)
    if (candidateKeys.length === 0) continue
    const key = candidateKeys.find((candidateKey) => params.memory.locations[candidateKey])
      || candidateKeys[0]
    if (!key) continue
    const entry = params.memory.locations[key]
    if (!entry) {
      missingKeys.push(key)
      continue
    }
    usedKeys.push(key)
    if (entry.preferredReferenceImage) preferredReferences.push(entry.preferredReferenceImage)
    if (entry.latestGoodImage) latestReferences.push(entry.latestGoodImage)
    environmentTokens.push(...entry.environmentLockTokens)
  }

  return {
    preferredReferences: uniqueStrings(preferredReferences),
    latestReferences: uniqueStrings(latestReferences),
    usedKeys: uniqueStrings(usedKeys),
    missingKeys: uniqueStrings(missingKeys),
    environmentTokens: uniqueStrings(environmentTokens),
  }
}

function readContinuityMissingKinds(records: Array<Record<string, unknown>>): ContinuityKind[] {
  return records
    .map((record) => readContinuityKind(record.continuityKind))
    .filter((kind): kind is ContinuityKind => kind.length > 0)
}

function hasMissingContinuityKind(
  records: Array<Record<string, unknown>>,
  kind: ContinuityKind,
): boolean {
  return records.some((record) => readContinuityKind(record.continuityKind) === kind)
}

function classifyContinuityStrength(params: {
  previousPanelReferenceCount: number
  characterReferenceCount: number
  locationReferenceCount: number
  appearanceLockTokenCount: number
}): 'none' | 'weak' | 'moderate' | 'strong' {
  const sourceCount = [
    params.previousPanelReferenceCount,
    params.characterReferenceCount,
    params.locationReferenceCount,
  ].filter((count) => count > 0).length

  if (sourceCount === 0) return 'none'
  if (sourceCount === 1) return params.appearanceLockTokenCount > 0 ? 'moderate' : 'weak'
  if (sourceCount === 2) return params.appearanceLockTokenCount > 0 ? 'strong' : 'moderate'
  return 'strong'
}

function readContinuitySourceNodeId(inputs: Record<string, unknown>): string | null {
  const records = toObjectArray(inputs.previousPanelReferenceMeta)
  for (const record of records) {
    const sourceNodeId = record.sourceNodeId
    if (typeof sourceNodeId === 'string' && sourceNodeId.trim().length > 0) {
      return sourceNodeId.trim()
    }
  }
  return null
}

/**
 * Image Generate executor — BRIDGE to production task system.
 *
 * When a panelId is provided (node synced from workspace), this executor
 * delegates to the EXACT same production pipeline used by the original
 * waoowaoo workspace:
 *
 *   submitTask(IMAGE_PANEL) → BullMQ image queue → image.worker.ts
 *   → handlePanelImageTask → FAL.ai / Google Gemini / Bytedance Seedream
 *   → saves panel.imageUrl → SSE event → frontend updates
 *
 * This is a FULL CAPABILITY BRIDGE — zero quality loss compared to
 * the original pipeline. The workflow editor's WorkflowTaskMonitor
 * component listens for task completion and updates the node state.
 *
 * Without panelId: fails explicitly because production generation requires
 * a linked workspace panel context.
 *
 * Parity: FULL (when panelId provided) — uses identical code path
 * as the workspace "Generate Image" button.
 */
export const executeImageGenerate: NodeExecutor = async (ctx) => {
  if (!ctx.panelId) {
    const imageModel = readConfigString(ctx.config, 'model') || ctx.modelConfig.storyboardModel
    if (!imageModel) {
      throw new Error('Image model not configured. Set a model in node settings or user defaults.')
    }

    const customPrompt = readConfigString(ctx.config, 'customPrompt')
    const promptInput = readOptionalStringInput(ctx.inputs, 'prompt')
    const basePrompt = customPrompt || promptInput
    if (!basePrompt) {
      throw new Error('Image generation requires a prompt input or custom prompt.')
    }
    const { artStyle, artStylePrompt } = resolveWorkflowArtStylePrompt(ctx.config.artStyle, ctx.locale)
    const styledPrompt = applyWorkflowArtStyleToPrompt({
      prompt: basePrompt,
      artStylePrompt,
      locale: ctx.locale,
      mode: 'image',
    })
    const candidateCount = readCandidateCount(ctx.config)

    const userConfig = await getUserModelConfig(ctx.userId)
    const runtimeSelections: Record<string, string | number | boolean> = {}
    const resolution = readConfigString(ctx.config, 'resolution')
    if (resolution) runtimeSelections.resolution = resolution
    const capabilityOptions = resolveModelCapabilityGenerationOptions({
      modelType: 'image',
      modelKey: imageModel,
      capabilityDefaults: userConfig.capabilityDefaults,
      runtimeSelections,
    })

    const aspectRatio = readConfigString(ctx.config, 'aspectRatio')
    const negativePrompt = readConfigString(ctx.config, 'negativePrompt')
    const continuityMetaRecords = readContinuityMetaRecords(ctx.inputs, 'continuityReferenceMeta')
    const continuityMissingMeta = readContinuityMetaRecords(ctx.inputs, 'continuityMissingMeta')
    const continuityStateCharacters = readContinuityStateCharacterSources(ctx.inputs)
    const continuityStateLocation = readContinuityStateLocationSource(ctx.inputs)
    const continuityStateCharacterNames = readContinuityStateCharacterNames(ctx.inputs)
    const continuityStateAppearanceTokens = readContinuityStateAppearanceTokens(ctx.inputs)
    const continuityStateEnvironmentTokens = readContinuityStateEnvironmentTokens(ctx.inputs)
    const continuityMemory = normalizeWorkflowContinuityMemory(ctx.inputs.continuityMemory)
    const previousPanelReferences = await normalizeStandaloneMediaInput(ctx.inputs.previousPanelReference)
    const characterReferences = await normalizeStandaloneMediaInput(ctx.inputs.characterReference)
    const locationReferences = await normalizeStandaloneMediaInput(ctx.inputs.locationReference)
    const manualReferences = await normalizeStandaloneMediaInput(ctx.inputs.reference)
    const continuityCharacterNames = uniqueStrings([
      ...readContinuityCharacterNames(continuityMetaRecords),
      ...continuityStateCharacterNames,
    ])
    const continuityLocationNames = uniqueStrings([
      ...readContinuityLocationNames(continuityMetaRecords),
      readLocationName(continuityStateLocation?.locationName),
    ])
    const characterMemoryResolution = resolveCharacterContinuityMemory({
      memory: continuityMemory,
      continuityCharacterNames,
      continuityStateCharacters,
    })
    const locationMemoryResolution = resolveLocationContinuityMemory({
      memory: continuityMemory,
      continuityLocationNames,
      continuityStateLocation,
    })
    const continuityMemoryCharacterPreferredReferences = characterMemoryResolution.preferredReferences
    const continuityMemoryCharacterLatestReferences = characterMemoryResolution.latestReferences
    const continuityMemoryLocationPreferredReferences = locationMemoryResolution.preferredReferences
    const continuityMemoryLocationLatestReferences = locationMemoryResolution.latestReferences
    const referenceImages = uniqueStrings([
      ...previousPanelReferences,
      ...continuityMemoryCharacterPreferredReferences,
      ...characterReferences,
      ...continuityMemoryCharacterLatestReferences,
      ...locationReferences,
      ...continuityMemoryLocationPreferredReferences,
      ...continuityMemoryLocationLatestReferences,
      ...manualReferences,
    ])
    const continuitySourceNodeId = readContinuitySourceNodeId(ctx.inputs)
    const continuitySourceKinds = uniqueStrings([
      ...readContinuitySourceKinds(continuityMetaRecords),
      ...(continuityMemoryCharacterPreferredReferences.length > 0 ? ['continuity-memory-character-preferred'] : []),
      ...(continuityMemoryCharacterLatestReferences.length > 0 ? ['continuity-memory-character-latest'] : []),
      ...(continuityMemoryLocationPreferredReferences.length > 0 ? ['continuity-memory-location-preferred'] : []),
      ...(continuityMemoryLocationLatestReferences.length > 0 ? ['continuity-memory-location-latest'] : []),
    ])
    const continuityMissingKinds = uniqueStrings(readContinuityMissingKinds(continuityMissingMeta))
    const appearanceLockTokens = uniqueStrings([
      ...readAppearanceLockTokens(continuityMetaRecords),
      ...continuityStateAppearanceTokens,
      ...characterMemoryResolution.appearanceTokens,
    ])
    const environmentLockTokens = uniqueStrings([
      ...readEnvironmentLockTokens(continuityMetaRecords),
      ...continuityStateEnvironmentTokens,
      ...locationMemoryResolution.environmentTokens,
    ])
    const continuityMemoryCharacterReferenceCount = (
      continuityMemoryCharacterPreferredReferences.length
      + continuityMemoryCharacterLatestReferences.length
    )
    const continuityMemoryLocationReferenceCount = (
      continuityMemoryLocationPreferredReferences.length
      + continuityMemoryLocationLatestReferences.length
    )
    const effectiveCharacterReferenceCount = characterReferences.length + continuityMemoryCharacterReferenceCount
    const effectiveLocationReferenceCount = locationReferences.length + continuityMemoryLocationReferenceCount
    const continuityReferenceCount = (
      previousPanelReferences.length
      + characterReferences.length
      + locationReferences.length
      + continuityMemoryCharacterReferenceCount
      + continuityMemoryLocationReferenceCount
    )
    const compiledPrompt = buildContinuityPrompt({
      prompt: styledPrompt,
      continuityReferenceCount,
      previousPanelReferenceCount: previousPanelReferences.length,
      characterReferenceCount: effectiveCharacterReferenceCount,
      locationReferenceCount: effectiveLocationReferenceCount,
      continuityCharacterNames,
      continuityLocationNames,
      appearanceLockTokens,
      environmentLockTokens,
    })
    const continuityStrength = classifyContinuityStrength({
      previousPanelReferenceCount: previousPanelReferences.length,
      characterReferenceCount: effectiveCharacterReferenceCount,
      locationReferenceCount: effectiveLocationReferenceCount,
      appearanceLockTokenCount: appearanceLockTokens.length,
    })
    const warnings: string[] = []
    if (referenceImages.length === 0) {
      warnings.push('Continuity is weak: no usable references resolved; generation will rely on prompt only.')
    } else if (
      previousPanelReferences.length === 0
      && characterReferences.length === 0
      && locationReferences.length === 0
      && manualReferences.length > 0
    ) {
      warnings.push('Continuity attribution is weak: only untagged manual references were resolved.')
    }
    if (hasMissingContinuityKind(continuityMissingMeta, 'previous-panel-image')) {
      warnings.push('Previous-panel continuity source is missing output. Run the earlier panel image first.')
    }
    if (hasMissingContinuityKind(continuityMissingMeta, 'character-reference')) {
      warnings.push('Character continuity source is missing output. Generate character reference nodes or bind asset references.')
    }
    if (hasMissingContinuityKind(continuityMissingMeta, 'location-reference')) {
      warnings.push('Location continuity source is missing output. Generate scene/location reference nodes to stabilize background continuity.')
    }
    if (effectiveCharacterReferenceCount > 0 && appearanceLockTokens.length === 0) {
      warnings.push('Character references resolved but appearance lock tokens are empty; look/outfit consistency may drift.')
    }
    if (effectiveLocationReferenceCount > 0 && environmentLockTokens.length === 0) {
      warnings.push('Environment continuity lock tokens are empty; background object continuity may drift.')
    }
    if (
      continuityCharacterNames.length > 0
      && effectiveCharacterReferenceCount === 0
    ) {
      warnings.push('Character continuity is weak: no resolved character memory/reference found for this panel.')
    }
    if (
      continuityLocationNames.length > 0
      && effectiveLocationReferenceCount === 0
    ) {
      warnings.push('Location continuity is weak: no resolved location memory/reference found for this panel.')
    }
    if (
      characterMemoryResolution.missingKeys.length > 0
      && characterReferences.length === 0
    ) {
      warnings.push('Continuity memory miss: one or more character memory keys were not found for this panel.')
    }
    if (
      locationMemoryResolution.missingKeys.length > 0
      && locationReferences.length === 0
    ) {
      warnings.push('Continuity memory miss: location memory key was not found for this panel.')
    }
    const mediaRefs: MediaRef[] = []
    for (let index = 0; index < candidateCount; index += 1) {
      const result = await generateImage(ctx.userId, imageModel, compiledPrompt, {
        ...(referenceImages.length > 0 ? { referenceImages } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(negativePrompt ? { negativePrompt } : {}),
        ...capabilityOptions,
      })
      if (!result.success) {
        throw new Error(result.error || 'Image generation failed')
      }

      const resolved = await resolveStandaloneGeneratedMediaSource({
        result,
        userId: ctx.userId,
        mediaType: 'image',
      })
      const mediaRef = await persistStandaloneGeneratedMedia({
        nodeId: `${ctx.nodeId}_${index + 1}`,
        nodeType: ctx.nodeType,
        mediaType: 'image',
        source: resolved.source,
        ...(resolved.downloadHeaders ? { downloadHeaders: resolved.downloadHeaders } : {}),
      })
      mediaRefs.push(mediaRef)
    }

    const primaryMedia = mediaRefs[0]
    if (!primaryMedia) {
      throw new Error('Image generation returned no media output.')
    }
    const candidateImages = mediaRefs.map((mediaRef) => mediaRef.url)

    return {
      outputs: {
        image: primaryMedia.url,
        imageUrl: primaryMedia.url,
        imageMediaId: primaryMedia.id,
        ...(candidateImages.length > 1 ? { candidateImages } : {}),
        usedPrompt: compiledPrompt,
      },
      message: 'Image generated',
      metadata: {
        mode: 'standalone',
        imageModel,
        referenceImageCount: referenceImages.length,
        continuityReferenceCount,
        previousPanelReferenceCount: previousPanelReferences.length,
        characterReferenceCount: characterReferences.length,
        effectiveCharacterReferenceCount,
        locationReferenceCount: locationReferences.length,
        effectiveLocationReferenceCount,
        manualReferenceCount: manualReferences.length,
        continuityMemoryReferenceCount: continuityMemoryCharacterReferenceCount + continuityMemoryLocationReferenceCount,
        continuityMemoryCharacterReferenceCount,
        continuityMemoryLocationReferenceCount,
        continuityMemoryCharacterKeysUsed: characterMemoryResolution.usedKeys,
        continuityMemoryCharacterKeysMissing: characterMemoryResolution.missingKeys,
        continuityMemoryLocationKeysUsed: locationMemoryResolution.usedKeys,
        continuityMemoryLocationKeysMissing: locationMemoryResolution.missingKeys,
        continuityMemoryCharacterEntryCount: Object.keys(continuityMemory.characters).length,
        continuityMemoryLocationEntryCount: Object.keys(continuityMemory.locations).length,
        continuityMemoryActive: continuityMemoryCharacterReferenceCount + continuityMemoryLocationReferenceCount > 0,
        continuityChainActive: previousPanelReferences.length > 0,
        continuityCharacterActive: effectiveCharacterReferenceCount > 0,
        continuityLocationActive: effectiveLocationReferenceCount > 0,
        continuitySourceKinds,
        continuityMissingKinds,
        continuityMissingCount: continuityMissingMeta.length,
        continuitySourceNodeIds: {
          previousPanel: readContinuitySourceNodeIds(continuityMetaRecords, 'previous-panel-image'),
          character: readContinuitySourceNodeIds(continuityMetaRecords, 'character-reference'),
          location: readContinuitySourceNodeIds(continuityMetaRecords, 'location-reference'),
        },
        continuityCharacterNames,
        continuityLocationName: continuityLocationNames[0] || null,
        appearanceLockTokenCount: appearanceLockTokens.length,
        appearanceLockTokens,
        environmentLockTokenCount: environmentLockTokens.length,
        environmentLockTokens,
        continuityStrength,
        warnings,
        continuitySourceNodeId,
        candidateCount: candidateImages.length,
        resolution: runtimeSelections.resolution || null,
        aspectRatio: aspectRatio || null,
        negativePrompt: negativePrompt || null,
        seed: readOptionalNumberConfig(ctx.config, 'seed'),
        artStyle,
        artStylePrompt,
      },
    }
  }
  if (!ctx.projectId) {
    throw new Error('Image generation workspace bridge requires projectId.')
  }

  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: ctx.panelId },
  })
  if (!panel) {
    throw new Error('Panel not found')
  }

  const imageModel = (ctx.config.model as string) || ctx.modelConfig.storyboardModel
  if (!imageModel) {
    throw new Error('Image model not configured. Set a model in node settings or project config.')
  }

  const customPrompt = typeof ctx.config.customPrompt === 'string' && ctx.config.customPrompt.trim()
    ? ctx.config.customPrompt.trim()
    : undefined
  const { artStyle } = resolveWorkflowArtStylePrompt(ctx.config.artStyle, ctx.locale)
  const candidateCount = readCandidateCount(ctx.config)

  let billingPayload: Record<string, unknown>
  try {
    billingPayload = await buildImageBillingPayload({
      projectId: ctx.projectId,
      userId: ctx.userId,
      imageModel,
      basePayload: { panelId: ctx.panelId, ...ctx.config },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image model capability not configured'
    throw new Error(message)
  }

  if (customPrompt) {
    billingPayload.customPrompt = customPrompt
  }
  if (artStyle) {
    billingPayload.artStyle = artStyle
  }
  billingPayload.candidateCount = candidateCount

  const result = await submitTask({
    userId: ctx.userId,
    locale: ctx.locale,
    requestId: ctx.requestId || undefined,
    projectId: ctx.projectId,
    type: TASK_TYPE.IMAGE_PANEL,
    targetType: 'NovelPromotionPanel',
    targetId: ctx.panelId,
    payload: withTaskUiPayload(billingPayload, { hasOutputAtStart: !!panel.imageUrl }),
    dedupeKey: `workflow:image:${ctx.nodeId}:${ctx.panelId}:${candidateCount}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, billingPayload),
  })

  return {
    outputs: {},
    async: true,
    taskId: result.taskId,
    message: 'Image generation task submitted',
    metadata: {
      imageModel,
      panelId: ctx.panelId,
      deduped: result.deduped,
      artStyle: artStyle || null,
      candidateCount,
    },
  }
}
