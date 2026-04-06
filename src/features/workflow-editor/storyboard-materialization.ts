import type { Edge, Node } from '@xyflow/react'

export interface StoryboardCharacterReferenceSeed {
  assetId: string
  name: string
  aliases: string[]
  prompt: string
  imageUrl: string | null
  appearance: string
  primaryIdentifier: string
  visualKeywords: string[]
  selectedAppearanceId: string
  expectedAppearances: StoryboardCharacterExpectedAppearance[]
  referenceSource: 'asset-hub' | 'generated-reference' | 'unknown'
}

export interface StoryboardSceneReferenceSeed {
  assetId: string
  name: string
  prompt: string
  imageUrl: string | null
}

export interface StoryboardPanelSeed {
  panelIndex: number
  panelNumber: number | null
  description: string
  sourceText: string
  imagePrompt: string
  videoPrompt: string
  characters: string[]
  characterAssetIds: string[]
  characterContinuity: StoryboardPanelCharacterContinuitySeed[]
  location: string
  locationAssetId: string
}

export interface StoryboardCharacterExpectedAppearance {
  id: string
  changeReason: string
  description: string
}

export interface StoryboardPanelCharacterContinuitySeed {
  name: string
  assetId: string
  appearanceHint: string
  appearanceId: string
  identityHints: string[]
}

export interface StoryboardPanelGraphBuildResult {
  nodes: Node[]
  edges: Edge[]
  groupId: string
  preloadedOutputs: Record<string, Record<string, unknown>>
}

interface StoryboardPanelContinuityEdgeData extends Record<string, unknown> {
  continuityKind: 'previous-panel-image'
  continuitySource: 'materialized-panel-chain'
  fromPanelIndex: number
  fromPanelNumber: number | null
  toPanelIndex: number
  toPanelNumber: number
}

interface StoryboardCharacterContinuityEdgeData extends Record<string, unknown> {
  continuityKind: 'character-reference'
  continuitySource: 'materialized-character-reference'
  toPanelIndex: number
  toPanelNumber: number
  characterName: string
  characterAssetId: string
  appearanceLockTokens: string[]
  panelAppearanceHints: string[]
  identityTokens: string[]
}

interface StoryboardLocationContinuityEdgeData extends Record<string, unknown> {
  continuityKind: 'location-reference'
  continuitySource: 'materialized-location-reference'
  toPanelIndex: number
  toPanelNumber: number
  locationName: string
  locationAssetId: string
}

interface StoryboardCharacterContinuityProfile {
  referenceNodeId: string
  name: string
  assetId: string
  aliases: string[]
  appearanceLockTokens: string[]
  referenceSource: StoryboardCharacterReferenceSeed['referenceSource']
}

interface StoryboardLocationContinuityProfile {
  referenceNodeId: string
  name: string
  assetId: string
  referenceSource: 'asset-hub' | 'generated-reference'
}

interface StoryboardPanelContinuityCharacterBinding {
  referenceNodeId: string
  characterName: string
  characterAssetId: string
  appearanceLockTokens: string[]
  panelAppearanceHints: string[]
  identityTokens: string[]
  referenceSource: StoryboardCharacterReferenceSeed['referenceSource']
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

function toObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => readString(item))
    .filter(Boolean)
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

function readAssetId(record: Record<string, unknown>): string {
  return readString(record.assetId) || readString(record.id)
}

function normalizeMatchKey(value: string): string {
  return value.trim().toLowerCase()
}

function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const rawValue of values) {
    const value = rawValue.trim()
    if (!value) continue
    const key = normalizeMatchKey(value)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }

  return result
}

function readFirstNonEmptyString(candidates: unknown[]): string {
  for (const candidate of candidates) {
    const value = readString(candidate)
    if (value) return value
  }
  return ''
}

function readCharacterExpectedAppearances(value: unknown): StoryboardCharacterExpectedAppearance[] {
  const records = toObjectArray(value)
  return records
    .map((record, index) => {
      const id = readString(record.id) || readString(record.appearanceId)
      const changeReason = readString(record.change_reason)
        || readString(record.changeReason)
        || `Appearance ${index + 1}`
      const description = readFirstNonEmptyString([
        record.description,
        record.descriptions,
      ])
      return {
        id,
        changeReason,
        description,
      }
    })
    .filter((appearance) => appearance.id || appearance.changeReason || appearance.description)
}

function readPanelCharacterContinuitySeed(record: Record<string, unknown>): StoryboardPanelCharacterContinuitySeed {
  const name = readString(record.name)
  const assetId = readAssetId(record)
  const appearanceHint = readFirstNonEmptyString([
    record.appearance,
    record.look,
    record.outfit,
    record.costume,
    record.description,
  ])
  const appearanceId = readFirstNonEmptyString([
    record.appearance_id,
    record.appearanceId,
    record.selectedAppearanceId,
  ])
  const expectedAppearances = readCharacterExpectedAppearances(record.expected_appearances)
  const identityHints = uniqueNames([
    readString(record.primary_identifier),
    ...readStringArray(record.visual_keywords),
    ...expectedAppearances.map((appearance) => appearance.changeReason),
    ...readStringArrayLoose(record.identity_hints),
    appearanceHint,
  ])

  return {
    name,
    assetId,
    appearanceHint,
    appearanceId,
    identityHints,
  }
}

function mergePanelCharacterContinuity(
  existing: StoryboardPanelCharacterContinuitySeed,
  incoming: StoryboardPanelCharacterContinuitySeed,
): StoryboardPanelCharacterContinuitySeed {
  return {
    name: incoming.name || existing.name,
    assetId: incoming.assetId || existing.assetId,
    appearanceHint: incoming.appearanceHint || existing.appearanceHint,
    appearanceId: incoming.appearanceId || existing.appearanceId,
    identityHints: uniqueNames([...existing.identityHints, ...incoming.identityHints]),
  }
}

function parseCharacterRefs(value: unknown): {
  names: string[]
  assetIds: string[]
  continuity: StoryboardPanelCharacterContinuitySeed[]
} {
  if (Array.isArray(value)) {
    const names: string[] = []
    const assetIds: string[] = []
    const continuityByKey = new Map<string, StoryboardPanelCharacterContinuitySeed>()

    for (const item of value) {
      if (typeof item === 'string') {
        const name = item.trim()
        if (!name) continue
        names.push(name)
        const key = normalizeMatchKey(name)
        const existing = continuityByKey.get(key)
        const next: StoryboardPanelCharacterContinuitySeed = {
          name,
          assetId: '',
          appearanceHint: '',
          appearanceId: '',
          identityHints: [],
        }
        continuityByKey.set(key, existing ? mergePanelCharacterContinuity(existing, next) : next)
        continue
      }

      if (typeof item === 'object' && item !== null) {
        const record = item as Record<string, unknown>
        const continuitySeed = readPanelCharacterContinuitySeed(record)
        if (continuitySeed.name) names.push(continuitySeed.name)
        if (continuitySeed.assetId) assetIds.push(continuitySeed.assetId)
        const key = normalizeMatchKey(continuitySeed.assetId || continuitySeed.name)
        if (!key) continue
        const existing = continuityByKey.get(key)
        continuityByKey.set(
          key,
          existing ? mergePanelCharacterContinuity(existing, continuitySeed) : continuitySeed,
        )
      }
    }

    return {
      names: uniqueNames(names),
      assetIds: uniqueNames(assetIds),
      continuity: Array.from(continuityByKey.values()),
    }
  }

  if (typeof value === 'string') {
    const rawValue = value.trim()
    if (!rawValue) return { names: [], assetIds: [], continuity: [] }
    try {
      return parseCharacterRefs(JSON.parse(rawValue) as unknown)
    } catch {
      const names = uniqueNames(rawValue.split(/[,\n;，、]/g))
      return {
        names,
        assetIds: [],
        continuity: names.map((name) => ({
          name,
          assetId: '',
          appearanceHint: '',
          appearanceId: '',
          identityHints: [],
        })),
      }
    }
  }

  return { names: [], assetIds: [], continuity: [] }
}

function buildCharacterReferencePrompt(record: Record<string, unknown>): string {
  const name = readString(record.name) || 'Character'
  const appearance = readString(record.appearance)
  const introduction = readString(record.introduction)
  const primaryIdentifier = readString(record.primary_identifier)
  const visualKeywords = readStringArray(record.visual_keywords)
  const suggestedColors = readStringArray(record.suggested_colors)
  const personalityTags = readStringArray(record.personality_tags)
  const ageRange = readString(record.age_range) || readString(record.age)
  const gender = readString(record.gender)
  const occupation = readString(record.occupation)
  const eraPeriod = readString(record.era_period)
  const role = readString(record.role)

  const parts = [
    `${name}, production character reference illustration`,
    introduction,
    appearance ? `Appearance: ${appearance}` : '',
    primaryIdentifier ? `Signature identifier: ${primaryIdentifier}` : '',
    visualKeywords.length > 0 ? `Visual keywords: ${visualKeywords.join(', ')}` : '',
    suggestedColors.length > 0 ? `Suggested colors: ${suggestedColors.join(', ')}` : '',
    personalityTags.length > 0 ? `Personality mood: ${personalityTags.join(', ')}` : '',
    ageRange ? `Age range: ${ageRange}` : '',
    gender ? `Gender presentation: ${gender}` : '',
    occupation ? `Occupation: ${occupation}` : '',
    eraPeriod ? `Era period: ${eraPeriod}` : '',
    role ? `Story role: ${role}` : '',
    'Consistent design, clean neutral backdrop, reference-sheet clarity, highly detailed',
  ]

  return parts.filter(Boolean).join('. ')
}

function buildSceneReferencePrompt(record: Record<string, unknown>): string {
  const name = readString(record.name) || 'Scene'
  const description = readString(record.description)
  const summary = readString(record.summary)
  const atmosphere = readString(record.atmosphere)
  const timeOfDay = readString(record.time_of_day)
  const interiorExterior = readString(record.interior_exterior)
  const keyObjects = readStringArray(record.key_objects)
  const descriptions = readStringArray(record.descriptions)
  const hasCrowd = record.has_crowd === true
  const crowdDescription = readString(record.crowd_description)

  const parts = [
    `${name}, production environment reference concept art`,
    description,
    summary,
    descriptions.length > 0 ? `Visual notes: ${descriptions.join(' | ')}` : '',
    atmosphere ? `Atmosphere: ${atmosphere}` : '',
    timeOfDay ? `Time of day: ${timeOfDay}` : '',
    interiorExterior ? `Space: ${interiorExterior}` : '',
    keyObjects.length > 0 ? `Key objects: ${keyObjects.join(', ')}` : '',
    hasCrowd ? `Crowd presence: ${crowdDescription || 'visible crowd activity'}` : '',
    'Focus on environment design, cinematic composition, no text overlay, highly detailed',
  ]

  return parts.filter(Boolean).join('. ')
}

function readReferenceImageUrl(record: Record<string, unknown>): string | null {
  const directCandidates = [
    record.selectedImageUrl,
    record.referenceImageUrl,
    record.imageUrl,
  ]

  for (const candidate of directCandidates) {
    const value = readString(candidate)
    if (value) return value
  }

  const arrayCandidates = [
    ...readStringArrayLoose(record.referenceImageUrls),
    ...readStringArrayLoose(record.imageUrls),
  ]

  return arrayCandidates[0] || null
}

function inferCharacterReferenceSource(record: Record<string, unknown>, imageUrl: string | null): StoryboardCharacterReferenceSeed['referenceSource'] {
  const explicitSource = readString(record.referenceSource).toLowerCase()
  if (explicitSource === 'asset-hub') return 'asset-hub'
  if (explicitSource === 'generated-reference') return 'generated-reference'
  if (!imageUrl) return 'generated-reference'
  return 'unknown'
}

function mergeCharacterReferenceSeeds(
  existing: StoryboardCharacterReferenceSeed,
  incoming: StoryboardCharacterReferenceSeed,
): StoryboardCharacterReferenceSeed {
  const existingSourceWeight = existing.referenceSource === 'asset-hub' ? 3 : existing.referenceSource === 'unknown' ? 2 : 1
  const incomingSourceWeight = incoming.referenceSource === 'asset-hub' ? 3 : incoming.referenceSource === 'unknown' ? 2 : 1

  return {
    assetId: incoming.assetId || existing.assetId,
    name: incoming.name || existing.name,
    aliases: uniqueNames([...existing.aliases, ...incoming.aliases]),
    prompt: incoming.prompt || existing.prompt,
    imageUrl: existing.imageUrl || incoming.imageUrl,
    appearance: incoming.appearance || existing.appearance,
    primaryIdentifier: incoming.primaryIdentifier || existing.primaryIdentifier,
    visualKeywords: uniqueNames([...existing.visualKeywords, ...incoming.visualKeywords]),
    selectedAppearanceId: incoming.selectedAppearanceId || existing.selectedAppearanceId,
    expectedAppearances: incoming.expectedAppearances.length > 0
      ? incoming.expectedAppearances
      : existing.expectedAppearances,
    referenceSource: incomingSourceWeight >= existingSourceWeight ? incoming.referenceSource : existing.referenceSource,
  }
}

function buildCharacterAppearanceLockTokens(seed: StoryboardCharacterReferenceSeed): string[] {
  const expectedAppearanceTokens = seed.expectedAppearances.flatMap((appearance) => [
    appearance.changeReason,
    appearance.description,
    appearance.id,
  ])
  return uniqueNames([
    seed.name,
    seed.appearance,
    seed.primaryIdentifier,
    ...seed.visualKeywords,
    seed.selectedAppearanceId,
    ...expectedAppearanceTokens,
  ])
}

export function extractCharacterReferenceSeeds(raw: unknown): StoryboardCharacterReferenceSeed[] {
  const records = Array.isArray(raw)
    ? toObjectArray(raw)
    : toObjectArray(toRecord(raw).characters)
  const deduped = new Map<string, StoryboardCharacterReferenceSeed>()

  for (const record of records) {
    const name = readString(record.name)
    if (!name) continue

    const aliases = uniqueNames(readStringArray(record.aliases))
    const assetId = readAssetId(record)
    const imageUrl = readReferenceImageUrl(record)
    const expectedAppearances = readCharacterExpectedAppearances(record.expected_appearances)
    const key = normalizeMatchKey(assetId || name)
    const nextSeed: StoryboardCharacterReferenceSeed = {
      assetId,
      name,
      aliases,
      prompt: buildCharacterReferencePrompt(record),
      imageUrl,
      appearance: readString(record.appearance) || readString(record.introduction),
      primaryIdentifier: readString(record.primary_identifier),
      visualKeywords: readStringArray(record.visual_keywords),
      selectedAppearanceId: readFirstNonEmptyString([
        record.selectedAppearanceId,
        record.selected_appearance_id,
      ]),
      expectedAppearances,
      referenceSource: inferCharacterReferenceSource(record, imageUrl),
    }
    const existingSeed = deduped.get(key)

    if (!existingSeed) {
      deduped.set(key, nextSeed)
      continue
    }

    deduped.set(key, mergeCharacterReferenceSeeds(existingSeed, nextSeed))
  }

  return Array.from(deduped.values())
}

export function extractStoryboardSceneReferenceSeeds(raw: unknown): StoryboardSceneReferenceSeed[] {
  const record = toRecord(raw)
  const records = Array.isArray(raw)
    ? toObjectArray(raw)
    : toObjectArray(record.scenes || record.locations)
  const deduped = new Map<string, StoryboardSceneReferenceSeed>()

  for (const scene of records) {
    const name = readString(scene.name)
    if (!name) continue

    const assetId = readAssetId(scene)
    const key = normalizeMatchKey(assetId || name)
    const nextSeed: StoryboardSceneReferenceSeed = {
      assetId,
      name,
      prompt: buildSceneReferencePrompt(scene),
      imageUrl: readReferenceImageUrl(scene),
    }
    const existingSeed = deduped.get(key)

    if (!existingSeed || (!existingSeed.imageUrl && nextSeed.imageUrl)) {
      deduped.set(key, nextSeed)
    }
  }

  return Array.from(deduped.values())
}

export function extractStoryboardPanelsFromOutputs(
  outputs: Record<string, unknown> | null | undefined,
): StoryboardPanelSeed[] {
  const rawPanels = outputs?.panels
  if (!Array.isArray(rawPanels)) return []

  return rawPanels
    .map((rawPanel, index) => {
      const panel = toRecord(rawPanel)
      const panelIndex = readNumber(panel.panelIndex) ?? index
      const panelNumber = readNumber(panel.panel_number)
      const description = readString(panel.description)
      const sourceText = readString(panel.source_text)
      const imagePrompt = readString(panel.imagePrompt) || description || sourceText
      const videoPrompt = readString(panel.videoPrompt) || readString(panel.video_prompt) || description || sourceText
      const characterRefs = parseCharacterRefs(panel.characters)
      const characterAssetIds = uniqueNames([
        ...characterRefs.assetIds,
        ...readStringArrayLoose(panel.character_asset_ids),
        ...readStringArrayLoose(panel.characterAssetIds),
      ])
      const location = readString(panel.location)
      const locationAssetId = readString(panel.location_asset_id) || readString(panel.locationAssetId)

      return {
        panelIndex,
        panelNumber,
        description,
        sourceText,
        imagePrompt,
        videoPrompt,
        characters: characterRefs.names,
        characterAssetIds,
        characterContinuity: characterRefs.continuity,
        location,
        locationAssetId,
      }
    })
    .filter((panel) => panel.imagePrompt.length > 0 || panel.videoPrompt.length > 0 || panel.description.length > 0)
}

export function collectStoryboardDerivedNodeIds(nodes: Node[], storyboardNodeId: string): Set<string> {
  const derivedIds = new Set<string>()

  for (const node of nodes) {
    const nodeData = toRecord(node.data)
    if (readString(nodeData.derivedFromStoryboard) === storyboardNodeId) {
      derivedIds.add(node.id)
    }
  }

  return derivedIds
}

function buildGroupNode(params: {
  groupId: string
  storyboardNodeId: string
  storyboardNodeLabel: string
  position: { x: number; y: number }
  height: number
  width: number
}): Node {
  return {
    id: params.groupId,
    type: 'workflowGroup',
    position: params.position,
    data: {
      label: `Storyboard Assets · ${params.storyboardNodeLabel}`,
      width: params.width,
      height: params.height,
      isCollapsed: false,
      derivedFromStoryboard: params.storyboardNodeId,
      materializedStoryboard: true,
    },
    style: {
      backgroundColor: 'rgba(30, 41, 59, 0.4)',
      border: '1px dashed #64748b',
      borderRadius: '16px',
      width: params.width,
      height: params.height,
      zIndex: -1,
    },
  }
}

function registerCharacterContinuityProfile(
  registry: Map<string, StoryboardCharacterContinuityProfile>,
  character: StoryboardCharacterReferenceSeed,
  referenceNodeId: string,
) {
  const profile: StoryboardCharacterContinuityProfile = {
    referenceNodeId,
    name: character.name,
    assetId: character.assetId,
    aliases: character.aliases,
    appearanceLockTokens: buildCharacterAppearanceLockTokens(character),
    referenceSource: character.referenceSource,
  }

  for (const key of [character.assetId, character.name, ...character.aliases]) {
    const normalized = normalizeMatchKey(key)
    if (!normalized || registry.has(normalized)) continue
    registry.set(normalized, profile)
  }
}

function registerSceneContinuityProfile(
  registry: Map<string, StoryboardLocationContinuityProfile>,
  scene: StoryboardSceneReferenceSeed,
  referenceNodeId: string,
) {
  const profile: StoryboardLocationContinuityProfile = {
    referenceNodeId,
    name: scene.name,
    assetId: scene.assetId,
    referenceSource: scene.imageUrl ? 'asset-hub' : 'generated-reference',
  }
  for (const key of [scene.assetId, scene.name]) {
    const normalized = normalizeMatchKey(key)
    if (!normalized || registry.has(normalized)) continue
    registry.set(normalized, profile)
  }
}

export function buildStoryboardPanelGraph(params: {
  storyboardNodeId: string
  storyboardNodeLabel: string
  storyboardPosition: { x: number; y: number }
  panels: StoryboardPanelSeed[]
  characterReferences?: StoryboardCharacterReferenceSeed[]
  sceneReferences?: StoryboardSceneReferenceSeed[]
  artStyle?: string | null
}): StoryboardPanelGraphBuildResult {
  const characterReferences = params.characterReferences || []
  const sceneReferences = params.sceneReferences || []
  const artStyle = readString(params.artStyle)
  const totalReferenceRows = characterReferences.length + sceneReferences.length
  const referenceHeight = totalReferenceRows > 0
    ? totalReferenceRows * 150 + (characterReferences.length > 0 && sceneReferences.length > 0 ? 40 : 0) + 50
    : 260
  const panelHeight = Math.max(260, params.panels.length * 250 + 50)
  const height = Math.max(referenceHeight, panelHeight)
  const width = 1600
  const groupId = `${params.storyboardNodeId}__panels_group`
  const nodes: Node[] = [
    buildGroupNode({
      groupId,
      storyboardNodeId: params.storyboardNodeId,
      storyboardNodeLabel: params.storyboardNodeLabel,
      position: {
        x: params.storyboardPosition.x + 380,
        y: params.storyboardPosition.y - 40,
      },
      height,
      width,
    }),
  ]
  const edges: Edge[] = []
  const preloadedOutputs: Record<string, Record<string, unknown>> = {}
  const characterContinuityProfiles = new Map<string, StoryboardCharacterContinuityProfile>()
  const sceneContinuityProfiles = new Map<string, StoryboardLocationContinuityProfile>()
  const derivedMeta = {
    derivedFromStoryboard: params.storyboardNodeId,
    materializedStoryboard: true,
  }

  let referenceY = 30
  for (const [referenceIndex, character] of characterReferences.entries()) {
    const suffix = `character_ref_${referenceIndex + 1}`
    const imageNodeId = `${params.storyboardNodeId}__${suffix}__image`
    const imageUrl = readString(character.imageUrl)

    if (imageUrl) {
      nodes.push({
        id: imageNodeId,
        parentId: groupId,
        extent: 'parent',
        type: 'workflowNode',
        position: { x: 280, y: referenceY - 20 },
        data: {
          nodeType: 'reference-image',
          label: `${character.name} Ref Image`,
          config: {
            imageUrl,
          },
          initialOutput: {
            image: imageUrl,
          },
          materializedReferenceType: 'character',
          materializedReferenceName: character.name,
          materializedReferenceSource: 'asset-hub',
          ...derivedMeta,
        },
      })
      preloadedOutputs[imageNodeId] = { image: imageUrl }
    } else {
      const promptNodeId = `${params.storyboardNodeId}__${suffix}__prompt`

      nodes.push({
        id: promptNodeId,
        parentId: groupId,
        extent: 'parent',
        type: 'workflowNode',
        position: { x: 40, y: referenceY },
        data: {
          nodeType: 'text-input',
          label: `${character.name} Ref Prompt`,
          config: { content: character.prompt },
          materializedReferenceType: 'character',
          materializedReferenceName: character.name,
          ...derivedMeta,
        },
      })

      nodes.push({
        id: imageNodeId,
        parentId: groupId,
        extent: 'parent',
        type: 'workflowNode',
        position: { x: 280, y: referenceY - 20 },
        data: {
          nodeType: 'image-generate',
          label: `${character.name} Ref Image`,
          config: {
            provider: 'google',
            model: '',
            artStyle,
            customPrompt: '',
            negativePrompt: '',
            aspectRatio: '1:1',
            resolution: '2K',
          },
          materializedReferenceType: 'character',
          materializedReferenceName: character.name,
          ...derivedMeta,
        },
      })

      edges.push({
        id: `${promptNodeId}__to__${imageNodeId}`,
        source: promptNodeId,
        sourceHandle: 'text',
        target: imageNodeId,
        targetHandle: 'prompt',
        animated: true,
        style: { strokeWidth: 2, stroke: '#8b5cf6' },
      })
    }

    registerCharacterContinuityProfile(characterContinuityProfiles, character, imageNodeId)
    referenceY += 150
  }

  if (characterReferences.length > 0 && sceneReferences.length > 0) {
    referenceY += 40
  }

  for (const [referenceIndex, scene] of sceneReferences.entries()) {
    const suffix = `scene_ref_${referenceIndex + 1}`
    const imageNodeId = `${params.storyboardNodeId}__${suffix}__image`
    const imageUrl = readString(scene.imageUrl)

    if (imageUrl) {
      nodes.push({
        id: imageNodeId,
        parentId: groupId,
        extent: 'parent',
        type: 'workflowNode',
        position: { x: 280, y: referenceY - 20 },
        data: {
          nodeType: 'reference-image',
          label: `${scene.name} Scene Image`,
          config: {
            imageUrl,
          },
          initialOutput: {
            image: imageUrl,
          },
          materializedReferenceType: 'scene',
          materializedReferenceName: scene.name,
          materializedReferenceSource: 'asset-hub',
          ...derivedMeta,
        },
      })
      preloadedOutputs[imageNodeId] = { image: imageUrl }
    } else {
      const promptNodeId = `${params.storyboardNodeId}__${suffix}__prompt`

      nodes.push({
        id: promptNodeId,
        parentId: groupId,
        extent: 'parent',
        type: 'workflowNode',
        position: { x: 40, y: referenceY },
        data: {
          nodeType: 'text-input',
          label: `${scene.name} Scene Prompt`,
          config: { content: scene.prompt },
          materializedReferenceType: 'scene',
          materializedReferenceName: scene.name,
          ...derivedMeta,
        },
      })

      nodes.push({
        id: imageNodeId,
        parentId: groupId,
        extent: 'parent',
        type: 'workflowNode',
        position: { x: 280, y: referenceY - 20 },
        data: {
          nodeType: 'image-generate',
          label: `${scene.name} Scene Image`,
          config: {
            provider: 'google',
            model: '',
            artStyle,
            customPrompt: '',
            negativePrompt: '',
            aspectRatio: '16:9',
            resolution: '2K',
          },
          materializedReferenceType: 'scene',
          materializedReferenceName: scene.name,
          ...derivedMeta,
        },
      })

      edges.push({
        id: `${promptNodeId}__to__${imageNodeId}`,
        source: promptNodeId,
        sourceHandle: 'text',
        target: imageNodeId,
        targetHandle: 'prompt',
        animated: true,
        style: { strokeWidth: 2, stroke: '#22c55e' },
      })
    }

    registerSceneContinuityProfile(sceneContinuityProfiles, scene, imageNodeId)
    referenceY += 150
  }

  let localY = 30
  let previousPanelImageNodeId: string | null = null
  let previousPanelIndex: number | null = null
  let previousPanelNumber: number | null = null
  for (const panel of params.panels) {
    const suffix = `panel_${panel.panelIndex + 1}`
    const imagePromptNodeId = `${params.storyboardNodeId}__${suffix}__image_prompt`
    const videoPromptNodeId = `${params.storyboardNodeId}__${suffix}__video_prompt`
    const imageNodeId = `${params.storyboardNodeId}__${suffix}__image`
    const videoNodeId = `${params.storyboardNodeId}__${suffix}__video`
    const panelLabel = panel.panelNumber ?? panel.panelIndex + 1
    const panelDerivedMeta = { ...derivedMeta, materializedPanelIndex: panel.panelIndex }

    const panelCharacterContinuityLookup = new Map<string, StoryboardPanelCharacterContinuitySeed>()
    for (const panelCharacter of panel.characterContinuity) {
      const keys = [panelCharacter.assetId, panelCharacter.name]
      for (const key of keys) {
        const normalized = normalizeMatchKey(key)
        if (!normalized || panelCharacterContinuityLookup.has(normalized)) continue
        panelCharacterContinuityLookup.set(normalized, panelCharacter)
      }
    }

    const characterBindingsByNodeId = new Map<string, StoryboardPanelContinuityCharacterBinding>()
    const registerCharacterBinding = (lookupKey: string) => {
      const normalized = normalizeMatchKey(lookupKey)
      if (!normalized) return
      const profile = characterContinuityProfiles.get(normalized)
      if (!profile) return
      const panelCharacter = panelCharacterContinuityLookup.get(normalized)
      const existing = characterBindingsByNodeId.get(profile.referenceNodeId)
      const mergedPanelHints = uniqueNames([
        ...(existing?.panelAppearanceHints || []),
        panelCharacter?.appearanceHint || '',
      ])
      const mergedIdentityTokens = uniqueNames([
        ...(existing?.identityTokens || []),
        ...(panelCharacter?.identityHints || []),
      ])
      characterBindingsByNodeId.set(profile.referenceNodeId, {
        referenceNodeId: profile.referenceNodeId,
        characterName: profile.name,
        characterAssetId: profile.assetId,
        appearanceLockTokens: profile.appearanceLockTokens,
        panelAppearanceHints: mergedPanelHints,
        identityTokens: mergedIdentityTokens,
        referenceSource: profile.referenceSource,
      })
    }

    for (const characterAssetId of panel.characterAssetIds) {
      registerCharacterBinding(characterAssetId)
    }
    for (const panelCharacter of panel.characterContinuity) {
      registerCharacterBinding(panelCharacter.assetId)
      registerCharacterBinding(panelCharacter.name)
    }
    for (const characterName of panel.characters) {
      registerCharacterBinding(characterName)
    }
    const characterBindings = Array.from(characterBindingsByNodeId.values())

    const locationLookupKey = panel.locationAssetId || panel.location
    const locationContinuityProfile = locationLookupKey
      ? sceneContinuityProfiles.get(normalizeMatchKey(locationLookupKey)) || null
      : null
    const locationReferenceNodeId = locationContinuityProfile?.referenceNodeId || null

    const appearanceLockTokens = uniqueNames([
      ...characterBindings.flatMap((binding) => binding.appearanceLockTokens),
      ...characterBindings.flatMap((binding) => binding.panelAppearanceHints),
      ...characterBindings.flatMap((binding) => binding.identityTokens),
    ])

    nodes.push({
      id: imagePromptNodeId,
      parentId: groupId,
      extent: 'parent',
      type: 'workflowNode',
      position: { x: 620, y: localY },
      data: {
        nodeType: 'text-input',
        label: `Panel ${panelLabel} Image Prompt`,
        config: { content: panel.imagePrompt },
        ...panelDerivedMeta,
      },
    })

    nodes.push({
      id: videoPromptNodeId,
      parentId: groupId,
      extent: 'parent',
      type: 'workflowNode',
      position: { x: 620, y: localY + 115 },
      data: {
        nodeType: 'text-input',
        label: `Panel ${panelLabel} Video Prompt`,
        config: { content: panel.videoPrompt },
        ...panelDerivedMeta,
      },
    })

    nodes.push({
      id: imageNodeId,
      parentId: groupId,
      extent: 'parent',
      type: 'workflowNode',
      position: { x: 940, y: localY - 30 },
      data: {
        nodeType: 'image-generate',
        label: `Panel ${panelLabel} Image`,
        config: {
          provider: 'google',
          model: '',
          artStyle,
          customPrompt: '',
          negativePrompt: '',
          aspectRatio: '16:9',
          resolution: '2K',
        },
        continuityChain: {
          enabled: previousPanelImageNodeId !== null,
          source: previousPanelImageNodeId ? 'previous-panel-image' : 'none',
          previousPanelImageNodeId,
          previousPanelIndex,
          previousPanelNumber,
        },
        continuityState: {
          panelIndex: panel.panelIndex,
          panelNumber: panelLabel,
          sources: {
            previousPanel: {
              expected: previousPanelImageNodeId !== null,
              sourceNodeId: previousPanelImageNodeId,
              panelIndex: previousPanelIndex,
              panelNumber: previousPanelNumber,
            },
            characterReferences: characterBindings.map((binding) => ({
              referenceNodeId: binding.referenceNodeId,
              characterName: binding.characterName,
              characterAssetId: binding.characterAssetId,
              referenceSource: binding.referenceSource,
              appearanceLockTokens: binding.appearanceLockTokens,
              panelAppearanceHints: binding.panelAppearanceHints,
              identityTokens: binding.identityTokens,
            })),
            locationReference: locationContinuityProfile
              ? {
                referenceNodeId: locationContinuityProfile.referenceNodeId,
                locationName: locationContinuityProfile.name,
                locationAssetId: locationContinuityProfile.assetId,
                referenceSource: locationContinuityProfile.referenceSource,
              }
              : null,
          },
          identity: {
            characterNames: uniqueNames(characterBindings.map((binding) => binding.characterName)),
            appearanceLockTokens,
            hasAppearanceLock: appearanceLockTokens.length > 0,
          },
        },
        ...panelDerivedMeta,
      },
    })

    nodes.push({
      id: videoNodeId,
      parentId: groupId,
      extent: 'parent',
      type: 'workflowNode',
      position: { x: 1260, y: localY + 20 },
      data: {
        nodeType: 'video-generate',
        label: `Panel ${panelLabel} Video`,
        config: {
          provider: 'kling',
          model: '',
          artStyle,
          duration: 5,
          aspectRatio: '16:9',
        },
        ...panelDerivedMeta,
      },
    })

    edges.push({
      id: `${imagePromptNodeId}__to__${imageNodeId}`,
      source: imagePromptNodeId,
      sourceHandle: 'text',
      target: imageNodeId,
      targetHandle: 'prompt',
      animated: true,
      style: { strokeWidth: 2, stroke: '#ec4899' },
    })

    edges.push({
      id: `${videoPromptNodeId}__to__${videoNodeId}`,
      source: videoPromptNodeId,
      sourceHandle: 'text',
      target: videoNodeId,
      targetHandle: 'prompt',
      animated: true,
      style: { strokeWidth: 2, stroke: '#ef4444' },
    })

    edges.push({
      id: `${imageNodeId}__to__${videoNodeId}`,
      source: imageNodeId,
      sourceHandle: 'image',
      target: videoNodeId,
      targetHandle: 'image',
      animated: true,
      style: { strokeWidth: 2, stroke: '#3b82f6' },
    })

    if (
      previousPanelImageNodeId
      && previousPanelIndex !== null
      && previousPanelNumber !== null
    ) {
      const continuityEdgeData: StoryboardPanelContinuityEdgeData = {
        continuityKind: 'previous-panel-image',
        continuitySource: 'materialized-panel-chain',
        fromPanelIndex: previousPanelIndex,
        fromPanelNumber: previousPanelNumber,
        toPanelIndex: panel.panelIndex,
        toPanelNumber: panelLabel,
      }
      edges.push({
        id: `${previousPanelImageNodeId}__to__${imageNodeId}__continuity_reference`,
        source: previousPanelImageNodeId,
        sourceHandle: 'image',
        target: imageNodeId,
        targetHandle: 'reference',
        animated: true,
        style: { strokeWidth: 2, stroke: '#f59e0b', strokeDasharray: '5 4' },
        data: continuityEdgeData,
      })
    }

    for (const binding of characterBindings) {
      const continuityEdgeData: StoryboardCharacterContinuityEdgeData = {
        continuityKind: 'character-reference',
        continuitySource: 'materialized-character-reference',
        toPanelIndex: panel.panelIndex,
        toPanelNumber: panelLabel,
        characterName: binding.characterName,
        characterAssetId: binding.characterAssetId,
        appearanceLockTokens: binding.appearanceLockTokens,
        panelAppearanceHints: binding.panelAppearanceHints,
        identityTokens: binding.identityTokens,
      }
      edges.push({
        id: `${binding.referenceNodeId}__to__${imageNodeId}__character_reference`,
        source: binding.referenceNodeId,
        sourceHandle: 'image',
        target: imageNodeId,
        targetHandle: 'reference',
        animated: true,
        style: { strokeWidth: 2, stroke: '#8b5cf6' },
        data: continuityEdgeData,
      })
    }

    if (locationReferenceNodeId && locationContinuityProfile) {
      const continuityEdgeData: StoryboardLocationContinuityEdgeData = {
        continuityKind: 'location-reference',
        continuitySource: 'materialized-location-reference',
        toPanelIndex: panel.panelIndex,
        toPanelNumber: panelLabel,
        locationName: locationContinuityProfile.name,
        locationAssetId: locationContinuityProfile.assetId,
      }
      edges.push({
        id: `${locationReferenceNodeId}__to__${imageNodeId}__location_reference`,
        source: locationReferenceNodeId,
        sourceHandle: 'image',
        target: imageNodeId,
        targetHandle: 'reference',
        animated: true,
        style: { strokeWidth: 2, stroke: '#22c55e' },
        data: continuityEdgeData,
      })
    }

    previousPanelImageNodeId = imageNodeId
    previousPanelIndex = panel.panelIndex
    previousPanelNumber = panelLabel
    localY += 250
  }

  return {
    nodes,
    edges,
    groupId,
    preloadedOutputs,
  }
}
