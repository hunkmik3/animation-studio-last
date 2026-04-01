function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => readString(item))
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    const rawValue = value.trim()
    if (!rawValue) return []
    try {
      return parseStringArray(JSON.parse(rawValue) as unknown)
    } catch {
      return []
    }
  }

  return []
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const normalized = value.trim().toLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(value.trim())
  }

  return result
}

export interface WorkflowCharacterReferenceAppearanceLike {
  id: string
  appearanceIndex: number
  changeReason?: unknown
  description?: unknown
  imageUrl?: unknown
  imageUrls?: unknown
  selectedIndex?: unknown
}

export interface WorkflowCharacterReferenceSource {
  id: string
  name: string
  aliases?: unknown
  appearances?: WorkflowCharacterReferenceAppearanceLike[]
}

export interface WorkflowLocationReferenceImageLike {
  id: string
  imageIndex: number
  description?: unknown
  imageUrl?: unknown
  isSelected?: unknown
}

export interface WorkflowLocationReferenceSource {
  id: string
  name: string
  summary?: unknown
  images?: WorkflowLocationReferenceImageLike[]
}

export interface WorkflowCharacterAssetRecord {
  id: string
  assetId: string
  name: string
  aliases: string[]
  introduction: string
  appearance: string
  referenceSource: 'asset-hub'
  referenceAssetType: 'character'
  referenceImageUrl: string | null
  referenceImageUrls: string[]
  selectedImageUrl: string | null
  selectedAppearanceId: string | null
  expected_appearances: Array<{
    id: string
    change_reason: string
    description: string
  }>
}

export interface WorkflowLocationAssetRecord {
  id: string
  assetId: string
  name: string
  summary: string
  description: string
  descriptions: string[]
  referenceSource: 'asset-hub'
  referenceAssetType: 'scene'
  referenceImageUrl: string | null
  selectedImageUrl: string | null
  selectedLocationImageId: string | null
}

export interface WorkflowCharacterAssetOutputs extends Record<string, unknown> {
  characters: WorkflowCharacterAssetRecord[]
  summary: string
}

export interface WorkflowLocationAssetOutputs extends Record<string, unknown> {
  scenes: WorkflowLocationAssetRecord[]
  locations: WorkflowLocationAssetRecord[]
  summary: string
}

function selectCharacterAppearance(
  appearances: WorkflowCharacterReferenceAppearanceLike[],
): WorkflowCharacterReferenceAppearanceLike | null {
  if (appearances.length === 0) return null

  const sortedAppearances = [...appearances].sort(
    (left, right) => left.appearanceIndex - right.appearanceIndex,
  )

  return sortedAppearances[0] || null
}

function resolveCharacterReferenceImages(
  appearance: WorkflowCharacterReferenceAppearanceLike | null,
): string[] {
  if (!appearance) return []

  const imageUrls = Array.isArray(appearance.imageUrls)
    ? appearance.imageUrls
        .map((imageUrl) => readString(imageUrl))
        .filter(Boolean)
    : []
  const fallbackUrl = readString(appearance.imageUrl)
  const selectedIndex = typeof appearance.selectedIndex === 'number' && appearance.selectedIndex >= 0
    ? appearance.selectedIndex
    : 0
  const selectedUrl = imageUrls[selectedIndex] || fallbackUrl || imageUrls[0] || ''

  return uniqueStrings([
    selectedUrl,
    ...imageUrls,
    fallbackUrl,
  ].filter(Boolean))
}

function selectLocationImage(
  images: WorkflowLocationReferenceImageLike[],
): WorkflowLocationReferenceImageLike | null {
  if (images.length === 0) return null

  const selected = images.find((image) => image.isSelected)
  if (selected) return selected

  const sortedImages = [...images].sort((left, right) => left.imageIndex - right.imageIndex)
  return sortedImages[0] || null
}

export function buildWorkflowCharacterAssetRecord(
  character: WorkflowCharacterReferenceSource,
): WorkflowCharacterAssetRecord {
  const appearances = Array.isArray(character.appearances) ? character.appearances : []
  const primaryAppearance = selectCharacterAppearance(appearances)
  const referenceImageUrls = resolveCharacterReferenceImages(primaryAppearance)
  const referenceImageUrl = referenceImageUrls[0] || null
  const appearanceDescription = readString(primaryAppearance?.description)
  const aliases = uniqueStrings(parseStringArray(character.aliases))
  const expectedAppearances = appearances.map((appearance) => ({
    id: appearance.id,
    change_reason: readString(appearance.changeReason) || `Appearance ${appearance.appearanceIndex + 1}`,
    description: readString(appearance.description),
  })).filter((appearance) => appearance.description.length > 0)

  return {
    id: character.id,
    assetId: character.id,
    name: readString(character.name),
    aliases,
    introduction: appearanceDescription,
    appearance: appearanceDescription,
    referenceSource: 'asset-hub',
    referenceAssetType: 'character',
    referenceImageUrl,
    referenceImageUrls,
    selectedImageUrl: referenceImageUrl,
    selectedAppearanceId: primaryAppearance?.id || null,
    expected_appearances: expectedAppearances,
  }
}

export function buildWorkflowLocationAssetRecord(
  location: WorkflowLocationReferenceSource,
): WorkflowLocationAssetRecord {
  const images = Array.isArray(location.images) ? location.images : []
  const selectedImage = selectLocationImage(images)
  const summary = readString(location.summary)
  const imageDescriptions = uniqueStrings(
    images
      .map((image) => readString(image.description))
      .filter(Boolean),
  )
  const selectedDescription = readString(selectedImage?.description)
  const description = selectedDescription || summary

  return {
    id: location.id,
    assetId: location.id,
    name: readString(location.name),
    summary,
    description,
    descriptions: imageDescriptions,
    referenceSource: 'asset-hub',
    referenceAssetType: 'scene',
    referenceImageUrl: readString(selectedImage?.imageUrl) || null,
    selectedImageUrl: readString(selectedImage?.imageUrl) || null,
    selectedLocationImageId: selectedImage?.id || null,
  }
}

export function buildWorkflowCharacterAssetOutputs(
  characters: WorkflowCharacterReferenceSource[],
): WorkflowCharacterAssetOutputs {
  const records = characters.map(buildWorkflowCharacterAssetRecord)
  return {
    characters: records,
    summary: records.length > 0
      ? `Loaded ${records.length} character asset${records.length === 1 ? '' : 's'} from Asset Hub.`
      : 'No character assets selected.',
  }
}

export function buildWorkflowLocationAssetOutputs(
  locations: WorkflowLocationReferenceSource[],
): WorkflowLocationAssetOutputs {
  const records = locations.map(buildWorkflowLocationAssetRecord)
  const summary = records.length > 0
    ? `Loaded ${records.length} location asset${records.length === 1 ? '' : 's'} from Asset Hub.`
    : 'No location assets selected.'

  return {
    scenes: records,
    locations: records,
    summary,
  }
}
