import type { Prisma } from '@prisma/client'
import { removeLocationPromptSuffix } from '@/lib/constants'
import { isInvalidLocation, parseAliases, readText, toStringArray } from '@/lib/workers/handlers/analyze-global-parse'

export interface WorkflowPushNode {
  id: string
  data?: Record<string, unknown>
}

export interface WorkflowNodeExecutionStateLite {
  status?: string
}

export interface WorkflowCharacterCandidate {
  name: string
  aliases: string[]
  introduction: string
  role_level: string
  archetype: string
  personality_tags: string[]
  era_period: string
  social_class: string
  occupation: string
  costume_tier: number | null
  suggested_colors: string[]
  primary_identifier: string
  visual_keywords: string[]
  gender: string
  age_range: string
}

export interface WorkflowCharacterUpdateCandidate {
  name: string
  updated_introduction: string
  updated_aliases: string[]
}

export interface WorkflowSceneCandidate {
  name: string
  summary: string
  description: string
  descriptions: string[]
}

export interface WorkflowAssetCandidates {
  characters: WorkflowCharacterCandidate[]
  updatedCharacters: WorkflowCharacterUpdateCandidate[]
  scenes: WorkflowSceneCandidate[]
}

export interface CharacterMergeStats {
  inputCount: number
  updateHintCount: number
  created: number
  updated: number
  skipped: number
  matched: number
}

export interface LocationMergeStats {
  inputCount: number
  created: number
  updated: number
  skipped: number
  matched: number
  createdDescriptions: number
}

export interface WorkflowAssetMergeStats {
  characters: CharacterMergeStats
  locations: LocationMergeStats
}

type CharacterProfileData = {
  role_level?: string
  archetype?: string
  personality_tags?: string[]
  era_period?: string
  social_class?: string
  occupation?: string
  costume_tier?: number
  suggested_colors?: string[]
  primary_identifier?: string
  visual_keywords?: string[]
  gender?: string
  age_range?: string
}

function optionalString(value: string): string | undefined {
  return value.trim() ? value.trim() : undefined
}

interface ExistingCharacterRecord {
  id: string
  name: string
  aliases: string[]
  introduction: string
  profileData: CharacterProfileData
}

interface ExistingLocationRecord {
  id: string
  name: string
  summary: string
  selectedImageId: string | null
  images: Array<{
    id: string
    imageIndex: number
    description: string
  }>
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(value)
  }
  return normalized
}

function normalizeCostumeTier(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? Math.round(value)
    : Number.parseInt(readText(value), 10)
  if (!Number.isFinite(parsed)) return null
  if (parsed < 1 || parsed > 5) return null
  return parsed
}

function toStringValue(value: unknown): string {
  return readText(value).trim()
}

function toDescriptionList(record: Record<string, unknown>): string[] {
  const fromArray = toStringArray(record.descriptions).map((item) => removeLocationPromptSuffix(item))
  if (fromArray.length > 0) return uniqueStrings(fromArray)
  const single = removeLocationPromptSuffix(toStringValue(record.description))
  return single ? [single] : []
}

function sanitizeCharacterCandidate(record: Record<string, unknown>): WorkflowCharacterCandidate | null {
  const name = toStringValue(record.name)
  if (!name) return null

  return {
    name,
    aliases: uniqueStrings(toStringArray(record.aliases)).filter((alias) => alias.toLowerCase() !== name.toLowerCase()),
    introduction: toStringValue(record.introduction),
    role_level: toStringValue(record.role_level).toUpperCase(),
    archetype: toStringValue(record.archetype),
    personality_tags: uniqueStrings(toStringArray(record.personality_tags)),
    era_period: toStringValue(record.era_period),
    social_class: toStringValue(record.social_class),
    occupation: toStringValue(record.occupation),
    costume_tier: normalizeCostumeTier(record.costume_tier),
    suggested_colors: uniqueStrings(toStringArray(record.suggested_colors)),
    primary_identifier: toStringValue(record.primary_identifier),
    visual_keywords: uniqueStrings(toStringArray(record.visual_keywords)),
    gender: toStringValue(record.gender),
    age_range: toStringValue(record.age_range),
  }
}

function sanitizeCharacterUpdateCandidate(record: Record<string, unknown>): WorkflowCharacterUpdateCandidate | null {
  const name = toStringValue(record.name)
  if (!name) return null
  return {
    name,
    updated_introduction: toStringValue(record.updated_introduction),
    updated_aliases: uniqueStrings(toStringArray(record.updated_aliases)),
  }
}

function sanitizeSceneCandidate(record: Record<string, unknown>): WorkflowSceneCandidate | null {
  const name = toStringValue(record.name)
  if (!name) return null

  const descriptions = toDescriptionList(record)
  const summary = toStringValue(record.summary)
  const description = descriptions[0] || removeLocationPromptSuffix(toStringValue(record.description)) || summary

  if (isInvalidLocation(name, summary) || isInvalidLocation(name, description)) {
    return null
  }

  return {
    name,
    summary,
    description,
    descriptions: uniqueStrings(descriptions.length > 0 ? descriptions : (description ? [description] : [])),
  }
}

function nameMatchesWithAlias(existingName: string, incomingName: string): boolean {
  const a = existingName.toLowerCase().trim()
  const b = incomingName.toLowerCase().trim()
  if (!a || !b) return false
  if (a === b) return true
  const aliasesA = a.split('/').map((item) => item.trim()).filter(Boolean)
  const aliasesB = b.split('/').map((item) => item.trim()).filter(Boolean)
  return aliasesB.some((alias) => aliasesA.includes(alias))
}

function chooseRicherText(existingValue: string, incomingValue: string): string {
  if (!existingValue) return incomingValue
  if (!incomingValue) return existingValue
  if (incomingValue.length > existingValue.length && incomingValue.toLowerCase().includes(existingValue.toLowerCase())) {
    return incomingValue
  }
  return existingValue
}

function mergeStringArray(existingValue: string[] | undefined, incomingValue: string[]): string[] {
  return uniqueStrings([...(existingValue || []), ...incomingValue])
}

function isExecutionStateEligible(status: string | undefined): boolean {
  if (!status) return false
  return status === 'completed' || status === 'skipped'
}

function parseCharacters(value: unknown): WorkflowCharacterCandidate[] {
  return toObjectArray(value)
    .map(sanitizeCharacterCandidate)
    .filter((item): item is WorkflowCharacterCandidate => item !== null)
}

function parseCharacterUpdates(value: unknown): WorkflowCharacterUpdateCandidate[] {
  return toObjectArray(value)
    .map(sanitizeCharacterUpdateCandidate)
    .filter((item): item is WorkflowCharacterUpdateCandidate => item !== null)
}

function parseScenes(value: unknown): WorkflowSceneCandidate[] {
  return toObjectArray(value)
    .map(sanitizeSceneCandidate)
    .filter((item): item is WorkflowSceneCandidate => item !== null)
}

function mergeCandidateCharacters(
  existing: WorkflowCharacterCandidate,
  incoming: WorkflowCharacterCandidate,
): WorkflowCharacterCandidate {
  return {
    name: existing.name,
    aliases: uniqueStrings([...existing.aliases, ...incoming.aliases, incoming.name]).filter(
      (alias) => alias.toLowerCase() !== existing.name.toLowerCase(),
    ),
    introduction: chooseRicherText(existing.introduction, incoming.introduction),
    role_level: existing.role_level || incoming.role_level,
    archetype: existing.archetype || incoming.archetype,
    personality_tags: mergeStringArray(existing.personality_tags, incoming.personality_tags),
    era_period: existing.era_period || incoming.era_period,
    social_class: existing.social_class || incoming.social_class,
    occupation: existing.occupation || incoming.occupation,
    costume_tier: existing.costume_tier ?? incoming.costume_tier,
    suggested_colors: mergeStringArray(existing.suggested_colors, incoming.suggested_colors),
    primary_identifier: existing.primary_identifier || incoming.primary_identifier,
    visual_keywords: mergeStringArray(existing.visual_keywords, incoming.visual_keywords),
    gender: existing.gender || incoming.gender,
    age_range: existing.age_range || incoming.age_range,
  }
}

function mergeCandidateScenes(existing: WorkflowSceneCandidate, incoming: WorkflowSceneCandidate): WorkflowSceneCandidate {
  const descriptions = uniqueStrings([...existing.descriptions, ...incoming.descriptions])
  const summary = chooseRicherText(existing.summary, incoming.summary)
  const description = descriptions[0] || existing.description || incoming.description
  return {
    name: existing.name,
    summary,
    description,
    descriptions,
  }
}

function findMatchingCharacter(
  records: ExistingCharacterRecord[],
  name: string,
  aliases: string[],
): ExistingCharacterRecord | null {
  const incomingNames = [name, ...aliases]
  for (const record of records) {
    const existingNames = [record.name, ...record.aliases]
    for (const existingName of existingNames) {
      for (const incomingName of incomingNames) {
        if (nameMatchesWithAlias(existingName, incomingName)) {
          return record
        }
      }
    }
  }
  return null
}

function findMatchingScene(
  records: WorkflowSceneCandidate[],
  incoming: WorkflowSceneCandidate,
): WorkflowSceneCandidate | null {
  for (const record of records) {
    if (nameMatchesWithAlias(record.name, incoming.name)) return record
  }
  return null
}

function findMatchingLocation(
  records: ExistingLocationRecord[],
  incomingName: string,
): ExistingLocationRecord | null {
  for (const record of records) {
    if (nameMatchesWithAlias(record.name, incomingName)) return record
  }
  return null
}

function parseProfileData(raw: string | null): CharacterProfileData {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const obj = parsed as Record<string, unknown>
    const personalityTags = uniqueStrings(toStringArray(obj.personality_tags))
    const suggestedColors = uniqueStrings(toStringArray(obj.suggested_colors))
    const visualKeywords = uniqueStrings(toStringArray(obj.visual_keywords))
    const roleLevel = optionalString(toStringValue(obj.role_level))
    const archetype = optionalString(toStringValue(obj.archetype))
    const eraPeriod = optionalString(toStringValue(obj.era_period))
    const socialClass = optionalString(toStringValue(obj.social_class))
    const occupation = optionalString(toStringValue(obj.occupation))
    const primaryIdentifier = optionalString(toStringValue(obj.primary_identifier))
    const gender = optionalString(toStringValue(obj.gender))
    const ageRange = optionalString(toStringValue(obj.age_range))
    const costumeTier = normalizeCostumeTier(obj.costume_tier) ?? undefined
    return {
      ...(roleLevel ? { role_level: roleLevel } : {}),
      ...(archetype ? { archetype } : {}),
      ...(personalityTags.length > 0 ? { personality_tags: personalityTags } : {}),
      ...(eraPeriod ? { era_period: eraPeriod } : {}),
      ...(socialClass ? { social_class: socialClass } : {}),
      ...(occupation ? { occupation } : {}),
      ...(costumeTier !== undefined ? { costume_tier: costumeTier } : {}),
      ...(suggestedColors.length > 0 ? { suggested_colors: suggestedColors } : {}),
      ...(primaryIdentifier ? { primary_identifier: primaryIdentifier } : {}),
      ...(visualKeywords.length > 0 ? { visual_keywords: visualKeywords } : {}),
      ...(gender ? { gender } : {}),
      ...(ageRange ? { age_range: ageRange } : {}),
    }
  } catch {
    return {}
  }
}

function toProfileData(candidate: WorkflowCharacterCandidate): CharacterProfileData {
  const personalityTags = uniqueStrings(candidate.personality_tags)
  const suggestedColors = uniqueStrings(candidate.suggested_colors)
  const visualKeywords = uniqueStrings(candidate.visual_keywords)
  const roleLevel = optionalString(candidate.role_level)
  const archetype = optionalString(candidate.archetype)
  const eraPeriod = optionalString(candidate.era_period)
  const socialClass = optionalString(candidate.social_class)
  const occupation = optionalString(candidate.occupation)
  const primaryIdentifier = optionalString(candidate.primary_identifier)
  const gender = optionalString(candidate.gender)
  const ageRange = optionalString(candidate.age_range)

  return {
    ...(roleLevel ? { role_level: roleLevel } : {}),
    ...(archetype ? { archetype } : {}),
    ...(personalityTags.length > 0 ? { personality_tags: personalityTags } : {}),
    ...(eraPeriod ? { era_period: eraPeriod } : {}),
    ...(socialClass ? { social_class: socialClass } : {}),
    ...(occupation ? { occupation } : {}),
    ...(candidate.costume_tier !== null ? { costume_tier: candidate.costume_tier } : {}),
    ...(suggestedColors.length > 0 ? { suggested_colors: suggestedColors } : {}),
    ...(primaryIdentifier ? { primary_identifier: primaryIdentifier } : {}),
    ...(visualKeywords.length > 0 ? { visual_keywords: visualKeywords } : {}),
    ...(gender ? { gender } : {}),
    ...(ageRange ? { age_range: ageRange } : {}),
  }
}

function mergeProfileData(existing: CharacterProfileData, incoming: CharacterProfileData): CharacterProfileData {
  const personalityTags = mergeStringArray(existing.personality_tags, incoming.personality_tags || [])
  const suggestedColors = mergeStringArray(existing.suggested_colors, incoming.suggested_colors || [])
  const visualKeywords = mergeStringArray(existing.visual_keywords, incoming.visual_keywords || [])

  return {
    ...(existing.role_level || incoming.role_level ? { role_level: existing.role_level || incoming.role_level } : {}),
    ...(existing.archetype || incoming.archetype ? { archetype: existing.archetype || incoming.archetype } : {}),
    ...(personalityTags.length > 0 ? { personality_tags: personalityTags } : {}),
    ...(existing.era_period || incoming.era_period ? { era_period: existing.era_period || incoming.era_period } : {}),
    ...(existing.social_class || incoming.social_class ? { social_class: existing.social_class || incoming.social_class } : {}),
    ...(existing.occupation || incoming.occupation ? { occupation: existing.occupation || incoming.occupation } : {}),
    ...((existing.costume_tier ?? incoming.costume_tier) !== undefined
      ? { costume_tier: existing.costume_tier ?? incoming.costume_tier }
      : {}),
    ...(suggestedColors.length > 0 ? { suggested_colors: suggestedColors } : {}),
    ...(existing.primary_identifier || incoming.primary_identifier
      ? { primary_identifier: existing.primary_identifier || incoming.primary_identifier }
      : {}),
    ...(visualKeywords.length > 0 ? { visual_keywords: visualKeywords } : {}),
    ...(existing.gender || incoming.gender ? { gender: existing.gender || incoming.gender } : {}),
    ...(existing.age_range || incoming.age_range ? { age_range: existing.age_range || incoming.age_range } : {}),
  }
}

function profileDataChanged(a: CharacterProfileData, b: CharacterProfileData): boolean {
  return JSON.stringify(a) !== JSON.stringify(b)
}

function hasCharacterUpdatePayload(payload: {
  aliases?: string
  introduction?: string
  profileData?: string
}): boolean {
  return Boolean(payload.aliases !== undefined || payload.introduction !== undefined || payload.profileData !== undefined)
}

export function collectWorkflowAssetCandidates(params: {
  nodes: WorkflowPushNode[]
  nodeOutputs?: Record<string, Record<string, unknown>>
  nodeExecutionStates?: Record<string, WorkflowNodeExecutionStateLite>
}): WorkflowAssetCandidates {
  const characters: WorkflowCharacterCandidate[] = []
  const updatedCharacters: WorkflowCharacterUpdateCandidate[] = []
  const scenesRaw: WorkflowSceneCandidate[] = []

  for (const node of params.nodes) {
    const nodeData = toRecord(node.data)
    const nodeType = toStringValue(nodeData.nodeType)
    if (!nodeType) continue

    const status = params.nodeExecutionStates?.[node.id]?.status
    if (!isExecutionStateEligible(status)) continue

    const sourceOutput = params.nodeOutputs?.[node.id] || toRecord(nodeData.initialOutput)
    if (nodeType === 'character-extract') {
      characters.push(...parseCharacters(sourceOutput.characters))
      updatedCharacters.push(...parseCharacterUpdates(sourceOutput.updatedCharacters))
      continue
    }

    if (nodeType === 'scene-extract') {
      const sceneSource = sourceOutput.scenes || sourceOutput.locations
      scenesRaw.push(...parseScenes(sceneSource))
    }
  }

  const dedupedCharacters: WorkflowCharacterCandidate[] = []
  for (const candidate of characters) {
    const existing = dedupedCharacters.find((item) => findMatchingCharacter(
      [{ id: 'tmp', name: item.name, aliases: item.aliases, introduction: '', profileData: {} }],
      candidate.name,
      candidate.aliases,
    ) !== null)
    if (!existing) {
      dedupedCharacters.push(candidate)
      continue
    }
    const index = dedupedCharacters.findIndex((item) => item === existing)
    dedupedCharacters[index] = mergeCandidateCharacters(existing, candidate)
  }

  const dedupedScenes: WorkflowSceneCandidate[] = []
  for (const scene of scenesRaw) {
    const existing = findMatchingScene(dedupedScenes, scene)
    if (!existing) {
      dedupedScenes.push(scene)
      continue
    }
    const index = dedupedScenes.findIndex((item) => item === existing)
    dedupedScenes[index] = mergeCandidateScenes(existing, scene)
  }

  return {
    characters: dedupedCharacters,
    updatedCharacters,
    scenes: dedupedScenes,
  }
}

export async function mergeWorkflowCharactersIntoProject(params: {
  tx: Prisma.TransactionClient
  projectInternalId: string
  characters: WorkflowCharacterCandidate[]
  updatedCharacters: WorkflowCharacterUpdateCandidate[]
}): Promise<CharacterMergeStats> {
  const stats: CharacterMergeStats = {
    inputCount: params.characters.length,
    updateHintCount: params.updatedCharacters.length,
    created: 0,
    updated: 0,
    skipped: 0,
    matched: 0,
  }

  if (params.characters.length === 0 && params.updatedCharacters.length === 0) {
    return stats
  }

  const existingRows = await params.tx.novelPromotionCharacter.findMany({
    where: { novelPromotionProjectId: params.projectInternalId },
    select: {
      id: true,
      name: true,
      aliases: true,
      introduction: true,
      profileData: true,
    },
  })

  const existing: ExistingCharacterRecord[] = existingRows.map((row) => ({
    id: row.id,
    name: row.name,
    aliases: parseAliases(row.aliases),
    introduction: row.introduction || '',
    profileData: parseProfileData(row.profileData),
  }))

  for (const candidate of params.characters) {
    const matched = findMatchingCharacter(existing, candidate.name, candidate.aliases)
    if (!matched) {
      const created = await params.tx.novelPromotionCharacter.create({
        data: {
          novelPromotionProjectId: params.projectInternalId,
          name: candidate.name,
          aliases: JSON.stringify(candidate.aliases),
          introduction: candidate.introduction || null,
          profileData: JSON.stringify(toProfileData(candidate)),
          profileConfirmed: false,
        },
        select: {
          id: true,
          name: true,
          aliases: true,
          introduction: true,
          profileData: true,
        },
      })
      existing.push({
        id: created.id,
        name: created.name,
        aliases: parseAliases(created.aliases),
        introduction: created.introduction || '',
        profileData: parseProfileData(created.profileData),
      })
      stats.created += 1
      continue
    }

    stats.matched += 1
    const mergedAliases = uniqueStrings([...matched.aliases, ...candidate.aliases, candidate.name])
      .filter((alias) => alias.toLowerCase() !== matched.name.toLowerCase())
    const mergedIntroduction = chooseRicherText(matched.introduction, candidate.introduction)
    const mergedProfileData = mergeProfileData(matched.profileData, toProfileData(candidate))
    const updatePayload: {
      aliases?: string
      introduction?: string
      profileData?: string
    } = {}

    if (JSON.stringify(mergedAliases) !== JSON.stringify(matched.aliases)) {
      updatePayload.aliases = JSON.stringify(mergedAliases)
      matched.aliases = mergedAliases
    }
    if (mergedIntroduction !== matched.introduction) {
      updatePayload.introduction = mergedIntroduction
      matched.introduction = mergedIntroduction
    }
    if (profileDataChanged(matched.profileData, mergedProfileData)) {
      updatePayload.profileData = JSON.stringify(mergedProfileData)
      matched.profileData = mergedProfileData
    }

    if (!hasCharacterUpdatePayload(updatePayload)) {
      stats.skipped += 1
      continue
    }

    await params.tx.novelPromotionCharacter.update({
      where: { id: matched.id },
      data: updatePayload,
    })
    stats.updated += 1
  }

  for (const updateHint of params.updatedCharacters) {
    const matched = findMatchingCharacter(existing, updateHint.name, updateHint.updated_aliases)
    if (!matched) continue

    const mergedAliases = uniqueStrings([...matched.aliases, ...updateHint.updated_aliases])
    const mergedIntroduction = chooseRicherText(matched.introduction, updateHint.updated_introduction)
    const updatePayload: {
      aliases?: string
      introduction?: string
    } = {}

    if (JSON.stringify(mergedAliases) !== JSON.stringify(matched.aliases)) {
      updatePayload.aliases = JSON.stringify(mergedAliases)
      matched.aliases = mergedAliases
    }
    if (mergedIntroduction !== matched.introduction) {
      updatePayload.introduction = mergedIntroduction
      matched.introduction = mergedIntroduction
    }

    if (!updatePayload.aliases && !updatePayload.introduction) continue
    await params.tx.novelPromotionCharacter.update({
      where: { id: matched.id },
      data: updatePayload,
    })
    stats.updated += 1
  }

  return stats
}

function nextImageIndex(images: Array<{ imageIndex: number }>): number {
  if (images.length === 0) return 0
  return Math.max(...images.map((item) => item.imageIndex)) + 1
}

function normalizeDescriptionForCompare(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function findMissingDescriptions(existing: string[], incoming: string[]): string[] {
  const existingSet = new Set(existing.map((item) => normalizeDescriptionForCompare(item)))
  return incoming.filter((item) => !existingSet.has(normalizeDescriptionForCompare(item)))
}

export async function mergeWorkflowScenesIntoProject(params: {
  tx: Prisma.TransactionClient
  projectInternalId: string
  scenes: WorkflowSceneCandidate[]
}): Promise<LocationMergeStats> {
  const stats: LocationMergeStats = {
    inputCount: params.scenes.length,
    created: 0,
    updated: 0,
    skipped: 0,
    matched: 0,
    createdDescriptions: 0,
  }

  if (params.scenes.length === 0) return stats

  const existingRows = await params.tx.novelPromotionLocation.findMany({
    where: { novelPromotionProjectId: params.projectInternalId },
    select: {
      id: true,
      name: true,
      summary: true,
      selectedImageId: true,
      images: {
        select: {
          id: true,
          imageIndex: true,
          description: true,
        },
      },
    },
  })

  const existing: ExistingLocationRecord[] = existingRows.map((row) => ({
    id: row.id,
    name: row.name,
    summary: row.summary || '',
    selectedImageId: row.selectedImageId || null,
    images: row.images.map((img) => ({
      id: img.id,
      imageIndex: img.imageIndex,
      description: img.description || '',
    })),
  }))

  for (const scene of params.scenes) {
    const descriptions = uniqueStrings(scene.descriptions.length > 0 ? scene.descriptions : (scene.description ? [scene.description] : []))
    const firstDescription = descriptions[0] || scene.description || ''
    if (isInvalidLocation(scene.name, scene.summary) || isInvalidLocation(scene.name, firstDescription)) {
      stats.skipped += 1
      continue
    }

    const matched = findMatchingLocation(existing, scene.name)
    if (!matched) {
      const createdLocation = await params.tx.novelPromotionLocation.create({
        data: {
          novelPromotionProjectId: params.projectInternalId,
          name: scene.name,
          summary: scene.summary || null,
        },
        select: {
          id: true,
          name: true,
          summary: true,
          selectedImageId: true,
        },
      })

      const createdImages: Array<{ id: string; imageIndex: number; description: string }> = []
      for (let index = 0; index < descriptions.length; index += 1) {
        const createdImage = await params.tx.locationImage.create({
          data: {
            locationId: createdLocation.id,
            imageIndex: index,
            description: descriptions[index],
          },
          select: {
            id: true,
            imageIndex: true,
            description: true,
          },
        })
        createdImages.push({
          id: createdImage.id,
          imageIndex: createdImage.imageIndex,
          description: createdImage.description || '',
        })
        stats.createdDescriptions += 1
      }

      existing.push({
        id: createdLocation.id,
        name: createdLocation.name,
        summary: createdLocation.summary || '',
        selectedImageId: createdLocation.selectedImageId || null,
        images: createdImages,
      })
      stats.created += 1
      continue
    }

    stats.matched += 1
    const updateSummary = chooseRicherText(matched.summary, scene.summary)
    const existingDescriptions = matched.images.map((image) => image.description || '').filter(Boolean)
    const missingDescriptions = findMissingDescriptions(existingDescriptions, descriptions)

    if (missingDescriptions.length === 0 && updateSummary === matched.summary) {
      stats.skipped += 1
      continue
    }

    if (updateSummary !== matched.summary) {
      await params.tx.novelPromotionLocation.update({
        where: { id: matched.id },
        data: {
          summary: updateSummary || null,
        },
      })
      matched.summary = updateSummary
    }

    let createdFirstImageId: string | null = null
    for (const description of missingDescriptions) {
      const imageIndex = nextImageIndex(matched.images)
      const createdImage = await params.tx.locationImage.create({
        data: {
          locationId: matched.id,
          imageIndex,
          description,
        },
        select: {
          id: true,
          imageIndex: true,
          description: true,
        },
      })
      if (!createdFirstImageId) createdFirstImageId = createdImage.id
      matched.images.push({
        id: createdImage.id,
        imageIndex: createdImage.imageIndex,
        description: createdImage.description || '',
      })
      stats.createdDescriptions += 1
    }

    if (!matched.selectedImageId && createdFirstImageId) {
      await params.tx.novelPromotionLocation.update({
        where: { id: matched.id },
        data: {
          selectedImageId: createdFirstImageId,
        },
      })
      matched.selectedImageId = createdFirstImageId
    }

    stats.updated += 1
  }

  return stats
}

export function getEmptyAssetMergeStats(): WorkflowAssetMergeStats {
  return {
    characters: {
      inputCount: 0,
      updateHintCount: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      matched: 0,
    },
    locations: {
      inputCount: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      matched: 0,
      createdDescriptions: 0,
    },
  }
}
