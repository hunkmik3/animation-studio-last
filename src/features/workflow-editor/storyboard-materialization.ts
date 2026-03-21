import type { Edge, Node } from '@xyflow/react'

export interface StoryboardCharacterReferenceSeed {
  name: string
  aliases: string[]
  prompt: string
}

export interface StoryboardSceneReferenceSeed {
  name: string
  prompt: string
}

export interface StoryboardPanelSeed {
  panelIndex: number
  panelNumber: number | null
  description: string
  sourceText: string
  imagePrompt: string
  videoPrompt: string
  characters: string[]
  location: string
}

export interface StoryboardPanelGraphBuildResult {
  nodes: Node[]
  edges: Edge[]
  groupId: string
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

function parseNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    const names = value.flatMap((item) => {
      if (typeof item === 'string') return [item]
      if (typeof item === 'object' && item !== null) {
        return [readString((item as Record<string, unknown>).name)]
      }
      return []
    })
    return uniqueNames(names)
  }

  if (typeof value === 'string') {
    const rawValue = value.trim()
    if (!rawValue) return []
    try {
      return parseNames(JSON.parse(rawValue) as unknown)
    } catch {
      return uniqueNames(rawValue.split(/[,\n;，、]/g))
    }
  }

  return []
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

export function extractCharacterReferenceSeeds(raw: unknown): StoryboardCharacterReferenceSeed[] {
  const records = Array.isArray(raw)
    ? toObjectArray(raw)
    : toObjectArray(toRecord(raw).characters)
  const deduped = new Map<string, StoryboardCharacterReferenceSeed>()

  for (const record of records) {
    const name = readString(record.name)
    if (!name) continue

    const aliases = uniqueNames(readStringArray(record.aliases))
    const key = normalizeMatchKey(name)
    deduped.set(key, {
      name,
      aliases,
      prompt: buildCharacterReferencePrompt(record),
    })
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

    deduped.set(normalizeMatchKey(name), {
      name,
      prompt: buildSceneReferencePrompt(scene),
    })
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
      const characters = parseNames(panel.characters)
      const location = readString(panel.location)

      return {
        panelIndex,
        panelNumber,
        description,
        sourceText,
        imagePrompt,
        videoPrompt,
        characters,
        location,
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

function registerReferenceNodeIds(
  registry: Map<string, string>,
  names: string[],
  nodeId: string,
) {
  for (const name of names) {
    const key = normalizeMatchKey(name)
    if (!key || registry.has(key)) continue
    registry.set(key, nodeId)
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
  const characterReferenceNodeIds = new Map<string, string>()
  const sceneReferenceNodeIds = new Map<string, string>()
  const derivedMeta = {
    derivedFromStoryboard: params.storyboardNodeId,
    materializedStoryboard: true,
  }

  let referenceY = 30
  for (const [referenceIndex, character] of characterReferences.entries()) {
    const suffix = `character_ref_${referenceIndex + 1}`
    const promptNodeId = `${params.storyboardNodeId}__${suffix}__prompt`
    const imageNodeId = `${params.storyboardNodeId}__${suffix}__image`

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
          provider: 'flux',
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

    registerReferenceNodeIds(
      characterReferenceNodeIds,
      [character.name, ...character.aliases],
      imageNodeId,
    )
    referenceY += 150
  }

  if (characterReferences.length > 0 && sceneReferences.length > 0) {
    referenceY += 40
  }

  for (const [referenceIndex, scene] of sceneReferences.entries()) {
    const suffix = `scene_ref_${referenceIndex + 1}`
    const promptNodeId = `${params.storyboardNodeId}__${suffix}__prompt`
    const imageNodeId = `${params.storyboardNodeId}__${suffix}__image`

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
          provider: 'flux',
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

    registerReferenceNodeIds(sceneReferenceNodeIds, [scene.name], imageNodeId)
    referenceY += 150
  }

  let localY = 30
  for (const panel of params.panels) {
    const suffix = `panel_${panel.panelIndex + 1}`
    const imagePromptNodeId = `${params.storyboardNodeId}__${suffix}__image_prompt`
    const videoPromptNodeId = `${params.storyboardNodeId}__${suffix}__video_prompt`
    const imageNodeId = `${params.storyboardNodeId}__${suffix}__image`
    const videoNodeId = `${params.storyboardNodeId}__${suffix}__video`
    const panelLabel = panel.panelNumber ?? panel.panelIndex + 1
    const panelDerivedMeta = { ...derivedMeta, materializedPanelIndex: panel.panelIndex }

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
          provider: 'flux',
          model: '',
          artStyle,
          customPrompt: '',
          negativePrompt: '',
          aspectRatio: '16:9',
          resolution: '2K',
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

    const referenceNodeIds = new Set<string>()
    for (const characterName of panel.characters) {
      const matchedNodeId = characterReferenceNodeIds.get(normalizeMatchKey(characterName))
      if (matchedNodeId) referenceNodeIds.add(matchedNodeId)
    }
    if (panel.location) {
      const matchedSceneNodeId = sceneReferenceNodeIds.get(normalizeMatchKey(panel.location))
      if (matchedSceneNodeId) referenceNodeIds.add(matchedSceneNodeId)
    }

    for (const referenceNodeId of referenceNodeIds) {
      const isSceneReference = referenceNodeId.includes('__scene_ref_')
      edges.push({
        id: `${referenceNodeId}__to__${imageNodeId}__reference`,
        source: referenceNodeId,
        sourceHandle: 'image',
        target: imageNodeId,
        targetHandle: 'reference',
        animated: true,
        style: { strokeWidth: 2, stroke: isSceneReference ? '#22c55e' : '#8b5cf6' },
      })
    }

    localY += 250
  }

  return {
    nodes,
    edges,
    groupId,
  }
}
