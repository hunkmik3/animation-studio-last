export const WORKFLOW_CONTINUITY_MEMORY_STATE_KEY = '__workflowContinuityMemory'

export type WorkflowContinuityStrength = 'none' | 'weak' | 'moderate' | 'strong'

export interface WorkflowContinuityCharacterMemory {
  canonicalName: string
  characterAssetId: string
  identityTokens: string[]
  appearanceLockTokens: string[]
  preferredReferenceImage: string | null
  latestGoodImage: string | null
  sourceNodeId: string | null
  sourcePanelId: string | null
  sourcePanelIndex: number | null
  sourcePanelNumber: number | null
  continuityStrength: WorkflowContinuityStrength
  continuitySourceKinds: string[]
  updatedAt: string
}

export interface WorkflowContinuityLocationMemory {
  locationName: string
  locationAssetId: string
  environmentLockTokens: string[]
  preferredReferenceImage: string | null
  latestGoodImage: string | null
  sourceNodeId: string | null
  sourcePanelId: string | null
  sourcePanelIndex: number | null
  sourcePanelNumber: number | null
  continuityStrength: WorkflowContinuityStrength
  continuitySourceKinds: string[]
  updatedAt: string
}

export interface WorkflowContinuityMemory {
  version: 1
  updatedAt: string
  characters: Record<string, WorkflowContinuityCharacterMemory>
  locations: Record<string, WorkflowContinuityLocationMemory>
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readOptionalString(value: unknown): string | null {
  const text = readString(value)
  return text || null
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

function isValidIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function readContinuityStrength(value: unknown): WorkflowContinuityStrength {
  if (value === 'none' || value === 'weak' || value === 'moderate' || value === 'strong') {
    return value
  }
  return 'none'
}

function isWorkflowContinuityCharacterMemory(value: unknown): value is WorkflowContinuityCharacterMemory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (typeof record.canonicalName !== 'string') return false
  if (typeof record.characterAssetId !== 'string') return false
  if (!Array.isArray(record.identityTokens) || !record.identityTokens.every((token) => typeof token === 'string')) return false
  if (!Array.isArray(record.appearanceLockTokens) || !record.appearanceLockTokens.every((token) => typeof token === 'string')) return false
  if (record.preferredReferenceImage !== null && record.preferredReferenceImage !== undefined && typeof record.preferredReferenceImage !== 'string') return false
  if (record.latestGoodImage !== null && record.latestGoodImage !== undefined && typeof record.latestGoodImage !== 'string') return false
  if (record.sourceNodeId !== null && record.sourceNodeId !== undefined && typeof record.sourceNodeId !== 'string') return false
  if (record.sourcePanelId !== null && record.sourcePanelId !== undefined && typeof record.sourcePanelId !== 'string') return false
  if (record.sourcePanelIndex !== null && record.sourcePanelIndex !== undefined && typeof record.sourcePanelIndex !== 'number') return false
  if (record.sourcePanelNumber !== null && record.sourcePanelNumber !== undefined && typeof record.sourcePanelNumber !== 'number') return false
  if (readContinuityStrength(record.continuityStrength) !== record.continuityStrength) return false
  if (!Array.isArray(record.continuitySourceKinds) || !record.continuitySourceKinds.every((item) => typeof item === 'string')) return false
  if (!isValidIsoTimestamp(record.updatedAt)) return false
  return true
}

function isWorkflowContinuityLocationMemory(value: unknown): value is WorkflowContinuityLocationMemory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (typeof record.locationName !== 'string') return false
  if (typeof record.locationAssetId !== 'string') return false
  if (
    record.environmentLockTokens !== undefined
    && (!Array.isArray(record.environmentLockTokens) || !record.environmentLockTokens.every((item) => typeof item === 'string'))
  ) return false
  if (record.preferredReferenceImage !== null && record.preferredReferenceImage !== undefined && typeof record.preferredReferenceImage !== 'string') return false
  if (record.latestGoodImage !== null && record.latestGoodImage !== undefined && typeof record.latestGoodImage !== 'string') return false
  if (record.sourceNodeId !== null && record.sourceNodeId !== undefined && typeof record.sourceNodeId !== 'string') return false
  if (record.sourcePanelId !== null && record.sourcePanelId !== undefined && typeof record.sourcePanelId !== 'string') return false
  if (record.sourcePanelIndex !== null && record.sourcePanelIndex !== undefined && typeof record.sourcePanelIndex !== 'number') return false
  if (record.sourcePanelNumber !== null && record.sourcePanelNumber !== undefined && typeof record.sourcePanelNumber !== 'number') return false
  if (readContinuityStrength(record.continuityStrength) !== record.continuityStrength) return false
  if (!Array.isArray(record.continuitySourceKinds) || !record.continuitySourceKinds.every((item) => typeof item === 'string')) return false
  if (!isValidIsoTimestamp(record.updatedAt)) return false
  return true
}

export function normalizeContinuityLookupKey(value: string): string {
  return value.trim().toLowerCase()
}

export function buildCharacterContinuityMemoryKey(params: {
  characterAssetId?: string | null
  canonicalName?: string | null
}): string {
  const assetId = readString(params.characterAssetId)
  if (assetId) return `asset:${normalizeContinuityLookupKey(assetId)}`
  const name = readString(params.canonicalName)
  if (name) return `name:${normalizeContinuityLookupKey(name)}`
  return ''
}

export function buildLocationContinuityMemoryKey(params: {
  locationAssetId?: string | null
  locationName?: string | null
}): string {
  const assetId = readString(params.locationAssetId)
  if (assetId) return `asset:${normalizeContinuityLookupKey(assetId)}`
  const name = readString(params.locationName)
  if (name) return `name:${normalizeContinuityLookupKey(name)}`
  return ''
}

export function getCharacterContinuityMemoryCandidateKeys(params: {
  characterAssetId?: string | null
  canonicalName?: string | null
  aliases?: string[]
}): string[] {
  return uniqueStrings([
    buildCharacterContinuityMemoryKey({
      characterAssetId: params.characterAssetId,
      canonicalName: params.canonicalName,
    }),
    ...((params.aliases || []).map((alias) =>
      buildCharacterContinuityMemoryKey({ canonicalName: alias }),
    )),
  ])
}

export function getLocationContinuityMemoryCandidateKeys(params: {
  locationAssetId?: string | null
  locationName?: string | null
  aliases?: string[]
}): string[] {
  return uniqueStrings([
    buildLocationContinuityMemoryKey({
      locationAssetId: params.locationAssetId,
      locationName: params.locationName,
    }),
    ...((params.aliases || []).map((alias) =>
      buildLocationContinuityMemoryKey({ locationName: alias }),
    )),
  ])
}

export function createEmptyWorkflowContinuityMemory(now: Date = new Date()): WorkflowContinuityMemory {
  return {
    version: 1,
    updatedAt: now.toISOString(),
    characters: {},
    locations: {},
  }
}

export function isWorkflowContinuityMemory(value: unknown): value is WorkflowContinuityMemory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.version !== 1) return false
  if (!isValidIsoTimestamp(record.updatedAt)) return false
  if (!record.characters || typeof record.characters !== 'object' || Array.isArray(record.characters)) return false
  if (!record.locations || typeof record.locations !== 'object' || Array.isArray(record.locations)) return false

  const characters = record.characters as Record<string, unknown>
  const locations = record.locations as Record<string, unknown>
  for (const entry of Object.values(characters)) {
    if (!isWorkflowContinuityCharacterMemory(entry)) return false
  }
  for (const entry of Object.values(locations)) {
    if (!isWorkflowContinuityLocationMemory(entry)) return false
  }
  return true
}

export function normalizeWorkflowContinuityMemory(
  value: unknown,
  now: Date = new Date(),
): WorkflowContinuityMemory {
  const nowIso = now.toISOString()
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createEmptyWorkflowContinuityMemory(now)
  }

  const record = toRecord(value)
  const rawCharacters = toRecord(record.characters)
  const rawLocations = toRecord(record.locations)
  const normalizedCharacters: Record<string, WorkflowContinuityCharacterMemory> = {}
  const normalizedLocations: Record<string, WorkflowContinuityLocationMemory> = {}

  for (const [entryKey, entryValue] of Object.entries(rawCharacters)) {
    const entryRecord = toRecord(entryValue)
    const key = buildCharacterContinuityMemoryKey({
      characterAssetId: readString(entryRecord.characterAssetId),
      canonicalName: readString(entryRecord.canonicalName) || entryKey,
    }) || buildCharacterContinuityMemoryKey({ canonicalName: entryKey })
    if (!key) continue

    normalizedCharacters[key] = {
      canonicalName: readString(entryRecord.canonicalName),
      characterAssetId: readString(entryRecord.characterAssetId),
      identityTokens: uniqueStrings(readStringArray(entryRecord.identityTokens)),
      appearanceLockTokens: uniqueStrings(readStringArray(entryRecord.appearanceLockTokens)),
      preferredReferenceImage: readOptionalString(entryRecord.preferredReferenceImage),
      latestGoodImage: readOptionalString(entryRecord.latestGoodImage),
      sourceNodeId: readOptionalString(entryRecord.sourceNodeId),
      sourcePanelId: readOptionalString(entryRecord.sourcePanelId),
      sourcePanelIndex: readNumber(entryRecord.sourcePanelIndex),
      sourcePanelNumber: readNumber(entryRecord.sourcePanelNumber),
      continuityStrength: readContinuityStrength(entryRecord.continuityStrength),
      continuitySourceKinds: uniqueStrings(readStringArray(entryRecord.continuitySourceKinds)),
      updatedAt: isValidIsoTimestamp(entryRecord.updatedAt) ? entryRecord.updatedAt : nowIso,
    }
  }

  for (const [entryKey, entryValue] of Object.entries(rawLocations)) {
    const entryRecord = toRecord(entryValue)
    const key = buildLocationContinuityMemoryKey({
      locationAssetId: readString(entryRecord.locationAssetId),
      locationName: readString(entryRecord.locationName) || entryKey,
    }) || buildLocationContinuityMemoryKey({ locationName: entryKey })
    if (!key) continue

    normalizedLocations[key] = {
      locationName: readString(entryRecord.locationName),
      locationAssetId: readString(entryRecord.locationAssetId),
      environmentLockTokens: uniqueStrings(readStringArray(entryRecord.environmentLockTokens)),
      preferredReferenceImage: readOptionalString(entryRecord.preferredReferenceImage),
      latestGoodImage: readOptionalString(entryRecord.latestGoodImage),
      sourceNodeId: readOptionalString(entryRecord.sourceNodeId),
      sourcePanelId: readOptionalString(entryRecord.sourcePanelId),
      sourcePanelIndex: readNumber(entryRecord.sourcePanelIndex),
      sourcePanelNumber: readNumber(entryRecord.sourcePanelNumber),
      continuityStrength: readContinuityStrength(entryRecord.continuityStrength),
      continuitySourceKinds: uniqueStrings(readStringArray(entryRecord.continuitySourceKinds)),
      updatedAt: isValidIsoTimestamp(entryRecord.updatedAt) ? entryRecord.updatedAt : nowIso,
    }
  }

  return {
    version: 1,
    updatedAt: isValidIsoTimestamp(record.updatedAt) ? record.updatedAt : nowIso,
    characters: normalizedCharacters,
    locations: normalizedLocations,
  }
}
