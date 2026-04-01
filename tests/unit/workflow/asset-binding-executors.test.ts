import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeExecutorContext } from '@/lib/workflow-engine/executors'

const prismaMock = {
  globalCharacter: {
    findMany: vi.fn(),
  },
  globalLocation: {
    findMany: vi.fn(),
  },
}

const mockAttachMediaFieldsToGlobalCharacter = vi.fn()
const mockAttachMediaFieldsToGlobalLocation = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToGlobalCharacter: mockAttachMediaFieldsToGlobalCharacter,
  attachMediaFieldsToGlobalLocation: mockAttachMediaFieldsToGlobalLocation,
}))

function createContext(overrides?: Partial<NodeExecutorContext>): NodeExecutorContext {
  return {
    nodeId: 'node_asset_1',
    nodeType: 'character-assets',
    config: {},
    inputs: {},
    projectId: null,
    userId: 'user_1',
    locale: 'en',
    modelConfig: {
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
    },
    ...overrides,
  }
}

describe('workflow asset binding executors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads selected character assets from the authenticated user asset hub', async () => {
    prismaMock.globalCharacter.findMany.mockResolvedValue([
      {
        id: 'char_1',
        name: 'Queen Elara',
        aliases: JSON.stringify(['Empress Elara']),
        appearances: [
          {
            id: 'appearance_1',
            appearanceIndex: 0,
            changeReason: 'Primary',
            description: 'Royal blue gown',
            imageUrl: '/m/fallback.png',
            imageUrls: '["/m/queen-front.png"]',
            selectedIndex: 0,
          },
        ],
      },
    ])
    mockAttachMediaFieldsToGlobalCharacter.mockResolvedValue({
      id: 'char_1',
      name: 'Queen Elara',
      aliases: JSON.stringify(['Empress Elara']),
      appearances: [
        {
          id: 'appearance_1',
          appearanceIndex: 0,
          changeReason: 'Primary',
          description: 'Royal blue gown',
          imageUrl: '/m/fallback.png',
          imageUrls: ['/m/queen-front.png'],
          selectedIndex: 0,
        },
      ],
    })

    const { executeCharacterAssets } = await import('@/lib/workflow-engine/executors/character-assets')
    const result = await executeCharacterAssets(createContext({
      nodeType: 'character-assets',
      config: { selectedCharacterIds: ['char_1'] },
    }))

    expect(prismaMock.globalCharacter.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        id: { in: ['char_1'] },
      },
      include: {
        appearances: {
          orderBy: { appearanceIndex: 'asc' },
        },
      },
    })
    expect(result.message).toBe('Loaded 1 character asset from Asset Hub.')
    expect(result.outputs).toEqual({
      characters: [
        expect.objectContaining({
          id: 'char_1',
          name: 'Queen Elara',
          referenceImageUrl: '/m/queen-front.png',
          selectedAppearanceId: 'appearance_1',
        }),
      ],
      summary: 'Loaded 1 character asset from Asset Hub.',
    })
  })

  it('fails explicitly when a selected character asset no longer exists for the user', async () => {
    prismaMock.globalCharacter.findMany.mockResolvedValue([])

    const { executeCharacterAssets } = await import('@/lib/workflow-engine/executors/character-assets')

    await expect(executeCharacterAssets(createContext({
      nodeType: 'character-assets',
      config: { selectedCharacterIds: ['missing_char'] },
    }))).rejects.toThrow('missing_char')
  })

  it('loads selected location assets from the authenticated user asset hub', async () => {
    prismaMock.globalLocation.findMany.mockResolvedValue([
      {
        id: 'loc_1',
        name: 'Secret Backroom',
        summary: 'Private strategy room',
        images: [
          {
            id: 'image_1',
            imageIndex: 0,
            description: 'Main boardroom angle',
            imageUrl: '/m/backroom.png',
            isSelected: true,
          },
        ],
      },
    ])
    mockAttachMediaFieldsToGlobalLocation.mockResolvedValue({
      id: 'loc_1',
      name: 'Secret Backroom',
      summary: 'Private strategy room',
      images: [
        {
          id: 'image_1',
          imageIndex: 0,
          description: 'Main boardroom angle',
          imageUrl: '/m/backroom.png',
          isSelected: true,
        },
      ],
    })

    const { executeLocationAssets } = await import('@/lib/workflow-engine/executors/location-assets')
    const result = await executeLocationAssets(createContext({
      nodeType: 'location-assets',
      config: { selectedLocationIds: ['loc_1'] },
    }))

    expect(prismaMock.globalLocation.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        id: { in: ['loc_1'] },
      },
      include: {
        images: {
          orderBy: { imageIndex: 'asc' },
        },
      },
    })
    expect(result.message).toBe('Loaded 1 location asset from Asset Hub.')
    expect(result.outputs).toEqual({
      scenes: [
        expect.objectContaining({
          id: 'loc_1',
          name: 'Secret Backroom',
          referenceImageUrl: '/m/backroom.png',
          selectedLocationImageId: 'image_1',
        }),
      ],
      locations: [
        expect.objectContaining({
          id: 'loc_1',
          name: 'Secret Backroom',
          referenceImageUrl: '/m/backroom.png',
        }),
      ],
      summary: 'Loaded 1 location asset from Asset Hub.',
    })
  })

  it('returns a fixed output image for workflow-native reference image nodes', async () => {
    const { executeReferenceImage } = await import('@/lib/workflow-engine/executors/reference-image')
    const result = await executeReferenceImage(createContext({
      nodeType: 'reference-image',
      config: { imageUrl: '/m/fixed-reference.png' },
    }))

    expect(result).toEqual({
      outputs: { image: '/m/fixed-reference.png' },
      message: 'Reference image ready.',
    })
  })
})
