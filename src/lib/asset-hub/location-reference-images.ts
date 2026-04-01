export interface LocationImageSeed {
  readonly imageIndex: number
  readonly description: string
  readonly imageUrl: string | null
  readonly isSelected: boolean
}

function normalizeReferenceImageValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeLocationReferenceImageUrls(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((value) => normalizeReferenceImageValue(value))
      .filter((value): value is string => value !== null)
      .slice(0, 5)
  }

  const single = normalizeReferenceImageValue(input)
  return single ? [single] : []
}

export function buildLocationImageSeeds(input: {
  readonly name: string
  readonly summary: string | null | undefined
  readonly referenceImageUrls: readonly string[]
}): LocationImageSeed[] {
  const description = input.summary?.trim() || input.name.trim()

  if (input.referenceImageUrls.length > 0) {
    return input.referenceImageUrls.map((imageUrl, index) => ({
      imageIndex: index,
      description,
      imageUrl,
      isSelected: index === 0,
    }))
  }

  return [0, 1, 2].map((imageIndex) => ({
    imageIndex,
    description,
    imageUrl: null,
    isSelected: false,
  }))
}
