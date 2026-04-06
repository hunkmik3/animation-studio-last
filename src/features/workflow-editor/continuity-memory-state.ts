import {
  buildCharacterContinuityMemoryKey,
  buildLocationContinuityMemoryKey,
  getCharacterContinuityMemoryCandidateKeys,
  getLocationContinuityMemoryCandidateKeys,
  normalizeWorkflowContinuityMemory,
  type WorkflowContinuityMemory,
  type WorkflowContinuityStrength,
} from '@/lib/workflow-engine/continuity-memory'

interface ImageNodeContinuityCharacterSource {
  referenceNodeId: string
  characterName: string
  characterAssetId: string
  referenceSource: string
  appearanceLockTokens: string[]
  panelAppearanceHints: string[]
  identityTokens: string[]
}

interface ImageNodeContinuityLocationSource {
  referenceNodeId: string
  locationName: string
  locationAssetId: string
  referenceSource: string
}

interface ParsedImageNodeContinuityState {
  panelIndex: number | null
  panelNumber: number | null
  panelId: string | null
  characterSources: ImageNodeContinuityCharacterSource[]
  locationSource: ImageNodeContinuityLocationSource | null
  identityCharacterNames: string[]
  identityAppearanceLockTokens: string[]
}

interface WorkflowContinuityMemoryUpdateResult {
  memory: WorkflowContinuityMemory
  changed: boolean
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => readString(item))
    .filter((item) => item.length > 0)
}

function readStringArrayLoose(value: unknown): string[] {
  if (Array.isArray(value)) return readStringArray(value)
  if (typeof value === 'string') {
    const rawValue = value.trim()
    if (!rawValue) return []
    try {
      return readStringArrayLoose(JSON.parse(rawValue) as unknown)
    } catch {
      return []
    }
  }
  return []
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const rawValue of values) {
    const value = rawValue.trim()
    if (!value) continue
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function readContinuityStrength(value: unknown): WorkflowContinuityStrength {
  if (value === 'none' || value === 'weak' || value === 'moderate' || value === 'strong') return value
  return 'none'
}

function continuityStrengthScore(value: WorkflowContinuityStrength): number {
  if (value === 'strong') return 3
  if (value === 'moderate') return 2
  if (value === 'weak') return 1
  return 0
}

function pickStrongerContinuityStrength(
  existing: WorkflowContinuityStrength,
  incoming: WorkflowContinuityStrength,
): WorkflowContinuityStrength {
  return continuityStrengthScore(incoming) >= continuityStrengthScore(existing)
    ? incoming
    : existing
}

function readImageFromNodeOutput(output: Record<string, unknown> | undefined): string {
  if (!output) return ''
  return readString(output.image) || readString(output.imageUrl)
}

function parseImageNodeContinuityState(nodeId: string, nodeData: Record<string, unknown>): ParsedImageNodeContinuityState {
  const continuityState = toRecord(nodeData.continuityState)
  const continuitySources = toRecord(continuityState.sources)
  const identityRecord = toRecord(continuityState.identity)
  const characterSourceRecords = Array.isArray(continuitySources.characterReferences)
    ? continuitySources.characterReferences
    : []
  const characterSources: ImageNodeContinuityCharacterSource[] = characterSourceRecords
    .map((item) => toRecord(item))
    .map((record) => ({
      referenceNodeId: readString(record.referenceNodeId),
      characterName: readString(record.characterName),
      characterAssetId: readString(record.characterAssetId),
      referenceSource: readString(record.referenceSource),
      appearanceLockTokens: readStringArray(record.appearanceLockTokens),
      panelAppearanceHints: readStringArray(record.panelAppearanceHints),
      identityTokens: readStringArray(record.identityTokens),
    }))
    .filter((source) => source.characterName.length > 0 || source.characterAssetId.length > 0)
  const locationRecord = toRecord(continuitySources.locationReference)
  const locationSource: ImageNodeContinuityLocationSource | null = (
    readString(locationRecord.locationName)
    || readString(locationRecord.locationAssetId)
  )
    ? {
      referenceNodeId: readString(locationRecord.referenceNodeId),
      locationName: readString(locationRecord.locationName),
      locationAssetId: readString(locationRecord.locationAssetId),
      referenceSource: readString(locationRecord.referenceSource),
    }
    : null

  return {
    panelIndex: readNumber(continuityState.panelIndex) ?? readNumber(nodeData.materializedPanelIndex),
    panelNumber: readNumber(continuityState.panelNumber),
    panelId: readString(nodeData.panelId) || nodeId,
    characterSources,
    locationSource,
    identityCharacterNames: readStringArray(identityRecord.characterNames),
    identityAppearanceLockTokens: readStringArray(identityRecord.appearanceLockTokens),
  }
}

export function updateWorkflowContinuityMemoryFromImageNode(params: {
  memory: WorkflowContinuityMemory | null | undefined
  nodeId: string
  nodeData: Record<string, unknown>
  nodeOutputs: Record<string, Record<string, unknown>>
  resultOutputs: Record<string, unknown>
  executorMetadata: Record<string, unknown>
}): WorkflowContinuityMemoryUpdateResult {
  const normalizedMemory = normalizeWorkflowContinuityMemory(params.memory)
  const latestGoodImage = readImageFromNodeOutput(params.resultOutputs)
  if (!latestGoodImage) {
    return { memory: normalizedMemory, changed: false }
  }

  const nowIso = new Date().toISOString()
  const continuityState = parseImageNodeContinuityState(params.nodeId, params.nodeData)
  const metadataCharacterNames = readStringArrayLoose(params.executorMetadata.continuityCharacterNames)
  const metadataAppearanceLockTokens = readStringArrayLoose(params.executorMetadata.appearanceLockTokens)
  const metadataSourceKinds = uniqueStrings(readStringArrayLoose(params.executorMetadata.continuitySourceKinds))
  const metadataStrength = readContinuityStrength(params.executorMetadata.continuityStrength)

  const nextCharacters = { ...normalizedMemory.characters }
  const nextLocations = { ...normalizedMemory.locations }
  let changed = false

  const upsertCharacterEntry = (
    key: string,
    buildEntry: (existing: WorkflowContinuityMemory['characters'][string] | undefined) => WorkflowContinuityMemory['characters'][string],
  ) => {
    const existing = nextCharacters[key]
    const nextEntry = buildEntry(existing)
    if (JSON.stringify(existing || null) !== JSON.stringify(nextEntry)) {
      changed = true
      nextCharacters[key] = nextEntry
    }
  }

  const upsertLocationEntry = (
    key: string,
    buildEntry: (existing: WorkflowContinuityMemory['locations'][string] | undefined) => WorkflowContinuityMemory['locations'][string],
  ) => {
    const existing = nextLocations[key]
    const nextEntry = buildEntry(existing)
    if (JSON.stringify(existing || null) !== JSON.stringify(nextEntry)) {
      changed = true
      nextLocations[key] = nextEntry
    }
  }

  for (const source of continuityState.characterSources) {
    const candidateKeys = getCharacterContinuityMemoryCandidateKeys({
      characterAssetId: source.characterAssetId,
      canonicalName: source.characterName,
    })
    const entryKey = candidateKeys.find((candidateKey) => nextCharacters[candidateKey]) || candidateKeys[0]
    if (!entryKey) continue

    const sourceReferenceImage = readImageFromNodeOutput(params.nodeOutputs[source.referenceNodeId])
    upsertCharacterEntry(entryKey, (existing) => {
      const preferredReferenceImage = sourceReferenceImage
        || existing?.preferredReferenceImage
        || latestGoodImage
      return {
        canonicalName: source.characterName || existing?.canonicalName || '',
        characterAssetId: source.characterAssetId || existing?.characterAssetId || '',
        identityTokens: uniqueStrings([
          ...(existing?.identityTokens || []),
          ...source.identityTokens,
          ...continuityState.identityCharacterNames,
          ...metadataCharacterNames,
          source.characterName,
          source.characterAssetId,
        ]),
        appearanceLockTokens: uniqueStrings([
          ...(existing?.appearanceLockTokens || []),
          ...source.appearanceLockTokens,
          ...source.panelAppearanceHints,
          ...continuityState.identityAppearanceLockTokens,
          ...metadataAppearanceLockTokens,
        ]),
        preferredReferenceImage,
        latestGoodImage,
        sourceNodeId: params.nodeId,
        sourcePanelId: continuityState.panelId,
        sourcePanelIndex: continuityState.panelIndex ?? existing?.sourcePanelIndex ?? null,
        sourcePanelNumber: continuityState.panelNumber ?? existing?.sourcePanelNumber ?? null,
        continuityStrength: pickStrongerContinuityStrength(existing?.continuityStrength || 'none', metadataStrength),
        continuitySourceKinds: uniqueStrings([
          ...(existing?.continuitySourceKinds || []),
          ...metadataSourceKinds,
          source.referenceSource ? `character-source:${source.referenceSource}` : '',
          sourceReferenceImage ? 'character-reference' : 'panel-image',
        ]),
        updatedAt: nowIso,
      }
    })
  }

  // Fallback: if panel continuity state is sparse, still keep character-level memory keyed by metadata names.
  for (const characterName of metadataCharacterNames) {
    const entryKey = buildCharacterContinuityMemoryKey({ canonicalName: characterName })
    if (!entryKey) continue
    upsertCharacterEntry(entryKey, (existing) => ({
      canonicalName: characterName || existing?.canonicalName || '',
      characterAssetId: existing?.characterAssetId || '',
      identityTokens: uniqueStrings([
        ...(existing?.identityTokens || []),
        characterName,
        ...metadataCharacterNames,
      ]),
      appearanceLockTokens: uniqueStrings([
        ...(existing?.appearanceLockTokens || []),
        ...metadataAppearanceLockTokens,
      ]),
      preferredReferenceImage: existing?.preferredReferenceImage || latestGoodImage,
      latestGoodImage,
      sourceNodeId: params.nodeId,
      sourcePanelId: continuityState.panelId,
      sourcePanelIndex: continuityState.panelIndex ?? existing?.sourcePanelIndex ?? null,
      sourcePanelNumber: continuityState.panelNumber ?? existing?.sourcePanelNumber ?? null,
      continuityStrength: pickStrongerContinuityStrength(existing?.continuityStrength || 'none', metadataStrength),
      continuitySourceKinds: uniqueStrings([
        ...(existing?.continuitySourceKinds || []),
        ...metadataSourceKinds,
        'panel-image',
      ]),
      updatedAt: nowIso,
    }))
  }

  if (continuityState.locationSource) {
    const locationSource = continuityState.locationSource
    const candidateKeys = getLocationContinuityMemoryCandidateKeys({
      locationAssetId: locationSource.locationAssetId,
      locationName: locationSource.locationName,
    })
    const entryKey = candidateKeys.find((candidateKey) => nextLocations[candidateKey]) || candidateKeys[0]
    if (entryKey) {
      const sourceReferenceImage = readImageFromNodeOutput(params.nodeOutputs[locationSource.referenceNodeId])
      upsertLocationEntry(entryKey, (existing) => ({
        locationName: locationSource.locationName || existing?.locationName || '',
        locationAssetId: locationSource.locationAssetId || existing?.locationAssetId || '',
        preferredReferenceImage: sourceReferenceImage || existing?.preferredReferenceImage || latestGoodImage,
        latestGoodImage,
        sourceNodeId: params.nodeId,
        sourcePanelId: continuityState.panelId,
        sourcePanelIndex: continuityState.panelIndex ?? existing?.sourcePanelIndex ?? null,
        sourcePanelNumber: continuityState.panelNumber ?? existing?.sourcePanelNumber ?? null,
        continuityStrength: pickStrongerContinuityStrength(existing?.continuityStrength || 'none', metadataStrength),
        continuitySourceKinds: uniqueStrings([
          ...(existing?.continuitySourceKinds || []),
          ...metadataSourceKinds,
          locationSource.referenceSource ? `location-source:${locationSource.referenceSource}` : '',
          sourceReferenceImage ? 'location-reference' : 'panel-image',
        ]),
        updatedAt: nowIso,
      }))
    }
  }

  // If location continuity metadata exists without explicit state mapping, keep a soft fallback by location name key.
  const locationNameFromMetadata = readString(params.executorMetadata.continuityLocationName)
  if (locationNameFromMetadata) {
    const fallbackLocationKey = buildLocationContinuityMemoryKey({ locationName: locationNameFromMetadata })
    if (fallbackLocationKey) {
      upsertLocationEntry(fallbackLocationKey, (existing) => ({
        locationName: locationNameFromMetadata || existing?.locationName || '',
        locationAssetId: existing?.locationAssetId || '',
        preferredReferenceImage: existing?.preferredReferenceImage || latestGoodImage,
        latestGoodImage,
        sourceNodeId: params.nodeId,
        sourcePanelId: continuityState.panelId,
        sourcePanelIndex: continuityState.panelIndex ?? existing?.sourcePanelIndex ?? null,
        sourcePanelNumber: continuityState.panelNumber ?? existing?.sourcePanelNumber ?? null,
        continuityStrength: pickStrongerContinuityStrength(existing?.continuityStrength || 'none', metadataStrength),
        continuitySourceKinds: uniqueStrings([
          ...(existing?.continuitySourceKinds || []),
          ...metadataSourceKinds,
          'panel-image',
        ]),
        updatedAt: nowIso,
      }))
    }
  }

  if (!changed) {
    return { memory: normalizedMemory, changed: false }
  }

  return {
    changed: true,
    memory: {
      version: 1,
      updatedAt: nowIso,
      characters: nextCharacters,
      locations: nextLocations,
    },
  }
}
