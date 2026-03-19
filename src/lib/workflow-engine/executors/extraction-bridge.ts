import type { Locale } from '@/i18n/routing'
import { removeLocationPromptSuffix } from '@/lib/constants'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import {
  isInvalidLocation,
  readText,
  safeParseCharactersResponse,
  safeParseLocationsResponse,
  toStringArray,
} from '@/lib/workers/handlers/analyze-global-parse'
import { extractJSON } from './types'

export const LEGACY_CHARACTER_EXTRACT_PROMPT = `Analyze the following text and extract all characters. For each character provide: name, age, gender, appearance description, personality traits, and role in the story.\n\nText:\n{input}\n\nOutput a JSON array of character objects.`

export const LEGACY_SCENE_EXTRACT_PROMPT = `Analyze the following text and extract all locations/scenes. For each provide: name, visual description, atmosphere, time of day, and weather.\n\nText:\n{input}\n\nOutput a JSON array of scene objects.`

export type ExtractionPromptMode = 'production-template' | 'custom-override'
export type CharacterParseMode = 'production-structured' | 'fallback-array' | 'fallback-object' | 'empty'
export type SceneParseMode = 'production-structured' | 'fallback-array' | 'fallback-object' | 'empty'

export interface PromptResolution {
  prompt: string
  promptMode: ExtractionPromptMode
  usedLegacyDefaultPrompt: boolean
}

export interface CharacterExtractionParseResult {
  rawNewCharacters: Array<Record<string, unknown>>
  rawUpdatedCharacters: Array<Record<string, unknown>>
  parseMode: CharacterParseMode
  warnings: string[]
}

export interface SceneExtractionParseResult {
  rawLocations: Array<Record<string, unknown>>
  parseMode: SceneParseMode
  warnings: string[]
}

export interface WorkflowCharacterAppearance {
  id: number
  change_reason: string
}

export interface WorkflowCharacter {
  name: string
  aliases: string[]
  introduction: string
  gender: string
  age_range: string
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
  expected_appearances: WorkflowCharacterAppearance[]
  role: string
  age: string
  appearance: string
  personality: string
}

export interface WorkflowCharacterUpdate {
  name: string
  updated_introduction: string
  updated_aliases: string[]
}

export interface WorkflowScene {
  name: string
  summary: string
  has_crowd: boolean
  crowd_description: string
  descriptions: string[]
  description: string
  atmosphere: string
  time_of_day: string
  interior_exterior: string
  key_objects: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord)
}

function normalizePromptForCompare(prompt: string): string {
  return prompt.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim().toLowerCase()
}

function normalizePromptOverride(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function resolvePromptMode(rawOverride: string, legacyDefault: string): {
  promptMode: ExtractionPromptMode
  usedLegacyDefaultPrompt: boolean
} {
  if (!rawOverride) {
    return {
      promptMode: 'production-template',
      usedLegacyDefaultPrompt: false,
    }
  }

  if (normalizePromptForCompare(rawOverride) === normalizePromptForCompare(legacyDefault)) {
    return {
      promptMode: 'production-template',
      usedLegacyDefaultPrompt: true,
    }
  }

  return {
    promptMode: 'custom-override',
    usedLegacyDefaultPrompt: false,
  }
}

function escapeRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function applyPromptVariables(
  template: string,
  variables: Record<string, string>,
): string {
  let rendered = template
  for (const [key, value] of Object.entries(variables)) {
    const escapedKey = escapeRegex(key)
    const pattern = new RegExp(`\\{\\{${escapedKey}\\}\\}|\\{${escapedKey}\\}`, 'g')
    rendered = rendered.replace(pattern, value)
  }
  return rendered
}

function uniqueNonEmptyStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

function toNameList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const names: string[] = []
    for (const item of raw) {
      if (typeof item === 'string') {
        names.push(item)
        continue
      }
      if (isRecord(item)) {
        const name = readText(item.name).trim()
        if (name) names.push(name)
      }
    }
    return uniqueNonEmptyStrings(names)
  }

  if (typeof raw === 'string' && raw.trim()) {
    const rawText = raw.trim()
    try {
      const parsed = JSON.parse(rawText) as unknown
      return toNameList(parsed)
    } catch {
      return uniqueNonEmptyStrings(
        rawText
          .split(/[,\n;，、]/g)
          .map((part) => part.trim())
          .filter(Boolean),
      )
    }
  }

  return []
}

function getDefaultCharactersLibInfo(locale: Locale): string {
  return locale === 'zh' ? '暂无已有角色' : 'No existing characters'
}

function getDefaultLocationsLibInfo(locale: Locale): string {
  return locale === 'zh' ? '无' : 'none'
}

function resolveCharactersLibInfo(locale: Locale, configValue: unknown, inputValue: unknown): string {
  const fromConfig = toNameList(configValue)
  if (fromConfig.length > 0) return fromConfig.join(', ')

  const fromInput = toNameList(inputValue)
  if (fromInput.length > 0) return fromInput.join(', ')

  return getDefaultCharactersLibInfo(locale)
}

function resolveLocationsLibInfo(locale: Locale, configValue: unknown, inputValue: unknown): string {
  const fromConfig = toNameList(configValue)
  if (fromConfig.length > 0) return fromConfig.join(', ')

  const fromInput = toNameList(inputValue)
  if (fromInput.length > 0) return fromInput.join(', ')

  return getDefaultLocationsLibInfo(locale)
}

export function resolveCharacterPrompt(params: {
  locale: Locale
  inputText: string
  promptOverride: unknown
  configCharactersLibInfo?: unknown
  inputCharacters?: unknown
}): PromptResolution {
  const override = normalizePromptOverride(params.promptOverride)
  const mode = resolvePromptMode(override, LEGACY_CHARACTER_EXTRACT_PROMPT)
  const charactersLibInfo = resolveCharactersLibInfo(
    params.locale,
    params.configCharactersLibInfo,
    params.inputCharacters,
  )

  if (mode.promptMode === 'custom-override') {
    return {
      prompt: applyPromptVariables(override, {
        input: params.inputText,
        characters_lib_info: charactersLibInfo,
      }),
      promptMode: mode.promptMode,
      usedLegacyDefaultPrompt: mode.usedLegacyDefaultPrompt,
    }
  }

  return {
    prompt: buildPrompt({
      promptId: PROMPT_IDS.NP_AGENT_CHARACTER_PROFILE,
      locale: params.locale,
      variables: {
        input: params.inputText,
        characters_lib_info: charactersLibInfo,
      },
    }),
    promptMode: mode.promptMode,
    usedLegacyDefaultPrompt: mode.usedLegacyDefaultPrompt,
  }
}

export function resolveScenePrompt(params: {
  locale: Locale
  inputText: string
  promptOverride: unknown
  configLocationsLibInfo?: unknown
  inputScenes?: unknown
}): PromptResolution {
  const override = normalizePromptOverride(params.promptOverride)
  const mode = resolvePromptMode(override, LEGACY_SCENE_EXTRACT_PROMPT)
  const locationsLibInfo = resolveLocationsLibInfo(
    params.locale,
    params.configLocationsLibInfo,
    params.inputScenes,
  )

  if (mode.promptMode === 'custom-override') {
    return {
      prompt: applyPromptVariables(override, {
        input: params.inputText,
        locations_lib_name: locationsLibInfo,
      }),
      promptMode: mode.promptMode,
      usedLegacyDefaultPrompt: mode.usedLegacyDefaultPrompt,
    }
  }

  return {
    prompt: buildPrompt({
      promptId: PROMPT_IDS.NP_SELECT_LOCATION,
      locale: params.locale,
      variables: {
        input: params.inputText,
        locations_lib_name: locationsLibInfo,
      },
    }),
    promptMode: mode.promptMode,
    usedLegacyDefaultPrompt: mode.usedLegacyDefaultPrompt,
  }
}

export function parseCharacterExtractionResponse(responseText: string): CharacterExtractionParseResult {
  const warnings: string[] = []
  const structured = safeParseCharactersResponse(responseText)

  const rawNewCharacters = toObjectArray(
    structured.new_characters && structured.new_characters.length > 0
      ? structured.new_characters
      : structured.characters,
  )
  const rawUpdatedCharacters = toObjectArray(structured.updated_characters)
  if (rawNewCharacters.length > 0 || rawUpdatedCharacters.length > 0) {
    return {
      rawNewCharacters,
      rawUpdatedCharacters,
      parseMode: 'production-structured',
      warnings,
    }
  }

  const fallback = extractJSON(responseText)
  if (Array.isArray(fallback)) {
    return {
      rawNewCharacters: toObjectArray(fallback),
      rawUpdatedCharacters: [],
      parseMode: 'fallback-array',
      warnings: ['LLM response used fallback array parsing.'],
    }
  }

  if (isRecord(fallback)) {
    const fallbackNew = toObjectArray(
      fallback.new_characters && Array.isArray(fallback.new_characters)
        ? fallback.new_characters
        : fallback.characters,
    )
    const fallbackUpdated = toObjectArray(fallback.updated_characters)
    return {
      rawNewCharacters: fallbackNew,
      rawUpdatedCharacters: fallbackUpdated,
      parseMode: 'fallback-object',
      warnings: ['LLM response used fallback object parsing.'],
    }
  }

  warnings.push('Unable to parse character JSON response; returned empty output.')
  return {
    rawNewCharacters: [],
    rawUpdatedCharacters: [],
    parseMode: 'empty',
    warnings,
  }
}

export function parseSceneExtractionResponse(responseText: string): SceneExtractionParseResult {
  const structured = safeParseLocationsResponse(responseText)
  const structuredLocations = toObjectArray(structured.locations)
  if (structuredLocations.length > 0) {
    return {
      rawLocations: structuredLocations,
      parseMode: 'production-structured',
      warnings: [],
    }
  }

  const fallback = extractJSON(responseText)
  if (Array.isArray(fallback)) {
    return {
      rawLocations: toObjectArray(fallback),
      parseMode: 'fallback-array',
      warnings: ['LLM response used fallback array parsing.'],
    }
  }

  if (isRecord(fallback)) {
    const fallbackLocations = Array.isArray(fallback.locations)
      ? fallback.locations
      : fallback.scenes
    return {
      rawLocations: toObjectArray(fallbackLocations),
      parseMode: 'fallback-object',
      warnings: ['LLM response used fallback object parsing.'],
    }
  }

  return {
    rawLocations: [],
    parseMode: 'empty',
    warnings: ['Unable to parse scene/location JSON response; returned empty output.'],
  }
}

function normalizeRoleLevel(value: string): string {
  const normalized = value.trim().toUpperCase()
  if (['S', 'A', 'B', 'C', 'D'].includes(normalized)) return normalized
  return ''
}

function normalizeCostumeTier(value: unknown): number | null {
  const asNumber = typeof value === 'number'
    ? value
    : Number.parseInt(readText(value), 10)
  if (!Number.isFinite(asNumber)) return null
  const integer = Math.round(asNumber)
  if (integer < 1 || integer > 5) return null
  return integer
}

function normalizeExpectedAppearances(value: unknown, locale: Locale): WorkflowCharacterAppearance[] {
  const fallbackReason = locale === 'zh' ? '初始形象' : 'initial appearance'
  const byId = new Map<number, WorkflowCharacterAppearance>()

  for (const item of toObjectArray(value)) {
    const parsedId = typeof item.id === 'number'
      ? Math.round(item.id)
      : Number.parseInt(readText(item.id), 10)
    const id = Number.isFinite(parsedId) && parsedId > 0 ? parsedId : 1
    const changeReason = readText(item.change_reason).trim() || readText(item.changeReason).trim() || fallbackReason
    if (!byId.has(id)) {
      byId.set(id, { id, change_reason: changeReason })
    }
  }

  if (!byId.has(1)) {
    byId.set(1, { id: 1, change_reason: fallbackReason })
  }

  return Array.from(byId.values()).sort((a, b) => a.id - b.id)
}

function canonicalNameScore(name: string): number {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return 0
  if (['i', 'me', 'myself', '我', '本人'].includes(normalized)) return 1
  const slashPenalty = normalized.includes('/') ? -1 : 0
  return 10 + normalized.length + slashPenalty
}

function nameMatchesWithAlias(existingName: string, newName: string): boolean {
  const a = existingName.toLowerCase().trim()
  const b = newName.toLowerCase().trim()
  if (!a || !b) return false
  if (a === b) return true
  const aliasesA = a.split('/').map((value) => value.trim()).filter(Boolean)
  const aliasesB = b.split('/').map((value) => value.trim()).filter(Boolean)
  return aliasesB.some((alias) => aliasesA.includes(alias))
}

function charactersMatch(a: WorkflowCharacter, b: WorkflowCharacter): boolean {
  const namesA = [a.name, ...a.aliases]
  const namesB = [b.name, ...b.aliases]
  for (const nameA of namesA) {
    for (const nameB of namesB) {
      if (nameMatchesWithAlias(nameA, nameB)) return true
    }
  }
  return false
}

function chooseLongerText(current: string, incoming: string): string {
  if (!current) return incoming
  if (!incoming) return current
  return incoming.length > current.length ? incoming : current
}

function mergeAppearances(
  current: WorkflowCharacterAppearance[],
  incoming: WorkflowCharacterAppearance[],
): WorkflowCharacterAppearance[] {
  const byId = new Map<number, WorkflowCharacterAppearance>()
  for (const item of current) byId.set(item.id, item)
  for (const item of incoming) {
    if (!byId.has(item.id)) {
      byId.set(item.id, item)
      continue
    }
    const existing = byId.get(item.id)!
    byId.set(item.id, {
      id: item.id,
      change_reason: chooseLongerText(existing.change_reason, item.change_reason),
    })
  }
  return Array.from(byId.values()).sort((a, b) => a.id - b.id)
}

function mergeCharacters(base: WorkflowCharacter, incoming: WorkflowCharacter): WorkflowCharacter {
  const preferIncomingName = canonicalNameScore(incoming.name) > canonicalNameScore(base.name)
  const name = preferIncomingName ? incoming.name : base.name

  const aliases = uniqueNonEmptyStrings([
    ...base.aliases,
    ...incoming.aliases,
    preferIncomingName ? base.name : incoming.name,
  ]).filter((alias) => alias.toLowerCase() !== name.toLowerCase())

  const introduction = chooseLongerText(base.introduction, incoming.introduction)
  const gender = base.gender || incoming.gender
  const ageRange = base.age_range || incoming.age_range
  const roleLevel = base.role_level || incoming.role_level
  const archetype = base.archetype || incoming.archetype
  const personalityTags = uniqueNonEmptyStrings([...base.personality_tags, ...incoming.personality_tags])
  const eraPeriod = base.era_period || incoming.era_period
  const socialClass = base.social_class || incoming.social_class
  const occupation = base.occupation || incoming.occupation
  const costumeTier = base.costume_tier ?? incoming.costume_tier
  const suggestedColors = uniqueNonEmptyStrings([...base.suggested_colors, ...incoming.suggested_colors])
  const primaryIdentifier = base.primary_identifier || incoming.primary_identifier
  const visualKeywords = uniqueNonEmptyStrings([...base.visual_keywords, ...incoming.visual_keywords])
  const expectedAppearances = mergeAppearances(base.expected_appearances, incoming.expected_appearances)
  const role = base.role || incoming.role || roleLevel
  const age = base.age || incoming.age || ageRange
  const personality = base.personality || incoming.personality || personalityTags.join(', ')
  const appearance = chooseLongerText(base.appearance, incoming.appearance)

  return {
    name,
    aliases,
    introduction,
    gender,
    age_range: ageRange,
    role_level: roleLevel,
    archetype,
    personality_tags: personalityTags,
    era_period: eraPeriod,
    social_class: socialClass,
    occupation,
    costume_tier: costumeTier,
    suggested_colors: suggestedColors,
    primary_identifier: primaryIdentifier,
    visual_keywords: visualKeywords,
    expected_appearances: expectedAppearances,
    role,
    age,
    appearance,
    personality,
  }
}

function normalizeCharacter(record: Record<string, unknown>, locale: Locale): WorkflowCharacter | null {
  const name = readText(record.name).trim()
  if (!name) return null

  const aliases = uniqueNonEmptyStrings(toStringArray(record.aliases))
    .filter((alias) => alias.toLowerCase() !== name.toLowerCase())
  const introduction = readText(record.introduction).trim() || readText(record.description).trim()
  const roleLevel = normalizeRoleLevel(readText(record.role_level))
  const personalityTags = uniqueNonEmptyStrings(toStringArray(record.personality_tags))
  const suggestedColors = uniqueNonEmptyStrings(toStringArray(record.suggested_colors))
  const visualKeywords = uniqueNonEmptyStrings(toStringArray(record.visual_keywords))
  const primaryIdentifier = readText(record.primary_identifier).trim()
  const appearanceFromProfile = uniqueNonEmptyStrings([primaryIdentifier, ...visualKeywords]).join(', ')
  const appearance = readText(record.appearance).trim() || appearanceFromProfile
  const personality = readText(record.personality).trim() || personalityTags.join(', ')
  const ageRange = readText(record.age_range).trim() || readText(record.age).trim()

  return {
    name,
    aliases,
    introduction,
    gender: readText(record.gender).trim(),
    age_range: ageRange,
    role_level: roleLevel,
    archetype: readText(record.archetype).trim(),
    personality_tags: personalityTags,
    era_period: readText(record.era_period).trim(),
    social_class: readText(record.social_class).trim(),
    occupation: readText(record.occupation).trim(),
    costume_tier: normalizeCostumeTier(record.costume_tier),
    suggested_colors: suggestedColors,
    primary_identifier: primaryIdentifier,
    visual_keywords: visualKeywords,
    expected_appearances: normalizeExpectedAppearances(record.expected_appearances, locale),
    role: readText(record.role).trim() || roleLevel,
    age: readText(record.age).trim() || ageRange,
    appearance,
    personality,
  }
}

export function normalizeCharacterUpdates(
  updates: Array<Record<string, unknown>>,
): WorkflowCharacterUpdate[] {
  const normalized: WorkflowCharacterUpdate[] = []
  for (const update of updates) {
    const name = readText(update.name).trim()
    if (!name) continue
    normalized.push({
      name,
      updated_introduction: readText(update.updated_introduction).trim(),
      updated_aliases: uniqueNonEmptyStrings(toStringArray(update.updated_aliases)),
    })
  }
  return normalized
}

export function normalizeCharacters(
  records: Array<Record<string, unknown>>,
  locale: Locale,
): WorkflowCharacter[] {
  const deduped: WorkflowCharacter[] = []
  for (const record of records) {
    const normalized = normalizeCharacter(record, locale)
    if (!normalized) continue

    const existingIndex = deduped.findIndex((item) => charactersMatch(item, normalized))
    if (existingIndex === -1) {
      deduped.push(normalized)
      continue
    }
    deduped[existingIndex] = mergeCharacters(deduped[existingIndex], normalized)
  }
  return deduped
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return false
}

function locationMatch(aName: string, bName: string): boolean {
  return nameMatchesWithAlias(aName, bName)
}

function mergeScenes(base: WorkflowScene, incoming: WorkflowScene): WorkflowScene {
  const preferIncomingName = canonicalNameScore(incoming.name) > canonicalNameScore(base.name)
  const name = preferIncomingName ? incoming.name : base.name
  const descriptions = uniqueNonEmptyStrings([...base.descriptions, ...incoming.descriptions])
  const summary = chooseLongerText(base.summary, incoming.summary)
  const description = descriptions[0] || summary

  return {
    name,
    summary,
    has_crowd: base.has_crowd || incoming.has_crowd,
    crowd_description: chooseLongerText(base.crowd_description, incoming.crowd_description),
    descriptions,
    description,
    atmosphere: chooseLongerText(base.atmosphere, incoming.atmosphere),
    time_of_day: base.time_of_day || incoming.time_of_day,
    interior_exterior: base.interior_exterior || incoming.interior_exterior,
    key_objects: uniqueNonEmptyStrings([...base.key_objects, ...incoming.key_objects]),
  }
}

function normalizeScene(record: Record<string, unknown>): WorkflowScene | null {
  const name = readText(record.name).trim()
  if (!name) return null

  const descriptions = uniqueNonEmptyStrings(
    toStringArray(record.descriptions).map((value) => removeLocationPromptSuffix(value)),
  )
  const legacyDescription = removeLocationPromptSuffix(readText(record.description).trim())
  const normalizedDescriptions = descriptions.length > 0
    ? descriptions
    : (legacyDescription ? [legacyDescription] : [])
  const summary = readText(record.summary).trim()
  const description = normalizedDescriptions[0] || summary

  if (isInvalidLocation(name, summary) || isInvalidLocation(name, description)) {
    return null
  }

  return {
    name,
    summary,
    has_crowd: parseBoolean(record.has_crowd),
    crowd_description: readText(record.crowd_description).trim(),
    descriptions: normalizedDescriptions,
    description,
    atmosphere: readText(record.atmosphere).trim(),
    time_of_day: readText(record.time_of_day).trim(),
    interior_exterior: readText(record.interior_exterior).trim(),
    key_objects: uniqueNonEmptyStrings(toStringArray(record.key_objects)),
  }
}

export function normalizeScenes(records: Array<Record<string, unknown>>): WorkflowScene[] {
  const deduped: WorkflowScene[] = []
  for (const record of records) {
    const normalized = normalizeScene(record)
    if (!normalized) continue
    const existingIndex = deduped.findIndex((scene) => locationMatch(scene.name, normalized.name))
    if (existingIndex === -1) {
      deduped.push(normalized)
      continue
    }
    deduped[existingIndex] = mergeScenes(deduped[existingIndex], normalized)
  }
  return deduped
}
