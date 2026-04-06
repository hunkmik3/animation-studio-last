import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getArtStylePrompt } from '@/lib/constants'
import type { NodeExecutorContext } from '@/lib/workflow-engine/executors'

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
  },
}))

const mockSubmitTask = vi.fn()
const mockBuildImageBillingPayload = vi.fn()
const mockGetUserModelConfig = vi.fn()
const mockResolveModelCapabilityGenerationOptions = vi.fn()
const mockGenerateImage = vi.fn()
const mockGenerateVideo = vi.fn()
const mockProcessMediaResult = vi.fn()
const mockEnsureMediaObjectFromStorageKey = vi.fn()
const mockNormalizeToOriginalMediaUrl = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/task/submitter', () => ({
  submitTask: mockSubmitTask,
}))

vi.mock('@/lib/config-service', () => ({
  buildImageBillingPayload: mockBuildImageBillingPayload,
  getUserModelConfig: mockGetUserModelConfig,
  resolveModelCapabilityGenerationOptions: mockResolveModelCapabilityGenerationOptions,
}))

vi.mock('@/lib/generator-api', () => ({
  generateImage: mockGenerateImage,
  generateVideo: mockGenerateVideo,
}))

vi.mock('@/lib/media-process', () => ({
  processMediaResult: mockProcessMediaResult,
}))

vi.mock('@/lib/media/service', () => ({
  ensureMediaObjectFromStorageKey: mockEnsureMediaObjectFromStorageKey,
}))

vi.mock('@/lib/media/outbound-image', () => ({
  normalizeToOriginalMediaUrl: mockNormalizeToOriginalMediaUrl,
}))

vi.mock('@/lib/billing', () => ({
  buildDefaultTaskBillingInfo: vi.fn(() => ({ provider: 'test' })),
}))

vi.mock('@/lib/task/ui-payload', () => ({
  withTaskUiPayload: vi.fn((payload: Record<string, unknown>) => payload),
}))

function createContext(overrides?: Partial<NodeExecutorContext>): NodeExecutorContext {
  return {
    nodeId: 'node_1',
    nodeType: 'image-generate',
    config: {},
    inputs: {},
    projectId: null,
    userId: 'user_1',
    locale: 'en',
    modelConfig: {
      analysisModel: 'google/gemini-3-pro-preview',
      characterModel: null,
      locationModel: null,
      storyboardModel: 'fal::flux-pro',
      editModel: null,
      videoModel: 'google::veo-3',
    },
    ...overrides,
  }
}

describe('workflow media executors standalone behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: 'panel_1',
      storyboardId: 'storyboard_1',
      panelIndex: 0,
      imageUrl: '/m/existing-image',
      videoUrl: null,
    })
    mockGetUserModelConfig.mockResolvedValue({
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: 'fal::flux-pro',
      editModel: null,
      videoModel: 'google::veo-3',
      capabilityDefaults: {},
    })
    mockResolveModelCapabilityGenerationOptions.mockReturnValue({})
    mockProcessMediaResult.mockResolvedValue('workflow/media/object')
    mockEnsureMediaObjectFromStorageKey.mockResolvedValue({
      id: 'media_1',
      publicId: 'pub_1',
      url: '/m/pub_1',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      width: 1024,
      height: 1024,
      durationMs: null,
    })
    mockNormalizeToOriginalMediaUrl.mockImplementation(async (value: string) => value)
  })

  it('generates standalone image output and persists it as workflow media', async () => {
    mockGenerateImage.mockResolvedValue({
      success: true,
      imageUrl: 'https://cdn.example.com/generated.jpg',
    })

    const { executeImageGenerate } = await import('@/lib/workflow-engine/executors/image-generate')
    const result = await executeImageGenerate(createContext({
      nodeType: 'image-generate',
      config: {
        model: 'fal::flux-pro',
        artStyle: 'realistic',
        customPrompt: 'A dramatic anime shot',
        aspectRatio: '16:9',
        resolution: '2K',
      },
    }))

    expect(mockGenerateImage).toHaveBeenCalledWith(
      'user_1',
      'fal::flux-pro',
      `A dramatic anime shot, overall visual style: ${getArtStylePrompt('realistic', 'en')}`,
      expect.objectContaining({
        aspectRatio: '16:9',
      }),
    )
    expect(mockProcessMediaResult).toHaveBeenCalledWith(expect.objectContaining({
      source: 'https://cdn.example.com/generated.jpg',
      type: 'image',
      keyPrefix: 'workflow/image-generate',
      targetId: 'node_1_1',
    }))
    expect(mockSubmitTask).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({
      outputs: expect.objectContaining({
        image: '/m/pub_1',
        imageUrl: '/m/pub_1',
        imageMediaId: 'media_1',
        usedPrompt: `A dramatic anime shot, overall visual style: ${getArtStylePrompt('realistic', 'en')}`,
      }),
      message: 'Image generated',
    }))
  })

  it('forwards standalone reference images to the image generator when provided', async () => {
    mockGenerateImage.mockResolvedValue({
      success: true,
      imageUrl: 'https://cdn.example.com/generated-with-refs.jpg',
    })

    const { executeImageGenerate } = await import('@/lib/workflow-engine/executors/image-generate')
    await executeImageGenerate(createContext({
      nodeType: 'image-generate',
      config: {
        model: 'fal::flux-pro',
      },
      inputs: {
        prompt: 'Hero at the city gate',
        reference: ['/m/character-ref', '/m/scene-ref'],
      },
    }))

    expect(mockNormalizeToOriginalMediaUrl).toHaveBeenCalledWith('/m/character-ref')
    expect(mockNormalizeToOriginalMediaUrl).toHaveBeenCalledWith('/m/scene-ref')
    expect(mockGenerateImage).toHaveBeenCalledWith(
      'user_1',
      'fal::flux-pro',
      'Hero at the city gate',
      expect.objectContaining({
        referenceImages: ['/m/character-ref', '/m/scene-ref'],
      }),
    )
  })

  it('prioritizes previous panel continuity references in standalone mode and dedupes merged references', async () => {
    mockGenerateImage.mockResolvedValue({
      success: true,
      imageUrl: 'https://cdn.example.com/generated-with-chain.jpg',
    })

    const { executeImageGenerate } = await import('@/lib/workflow-engine/executors/image-generate')
    const result = await executeImageGenerate(createContext({
      nodeType: 'image-generate',
      config: {
        model: 'fal::flux-pro',
      },
      inputs: {
        prompt: 'Panel 2 with continuity',
        previousPanelReference: ['/m/panel-1-ref'],
        previousPanelReferenceMeta: [{ sourceNodeId: 'storyboard_1__panel_1__image' }],
        reference: ['/m/character-ref', '/m/panel-1-ref'],
      },
    }))

    expect(mockNormalizeToOriginalMediaUrl).toHaveBeenCalledWith('/m/panel-1-ref')
    expect(mockNormalizeToOriginalMediaUrl).toHaveBeenCalledWith('/m/character-ref')
    expect(mockGenerateImage).toHaveBeenCalledWith(
      'user_1',
      'fal::flux-pro',
      expect.stringContaining('Panel 2 with continuity'),
      expect.objectContaining({
        referenceImages: ['/m/panel-1-ref', '/m/character-ref'],
      }),
    )
    expect(mockGenerateImage.mock.calls[0]?.[2]).toContain('[Continuity Constraints]')
    expect(result.metadata).toEqual(expect.objectContaining({
      continuityReferenceCount: 1,
      previousPanelReferenceCount: 1,
      characterReferenceCount: 0,
      locationReferenceCount: 0,
      manualReferenceCount: 2,
      referenceImageCount: 2,
      continuityChainActive: true,
      continuityStrength: 'weak',
      continuitySourceNodeId: 'storyboard_1__panel_1__image',
    }))
  })

  it('surfaces character/location continuity state and warnings when continuity sources are missing', async () => {
    mockGenerateImage.mockResolvedValue({
      success: true,
      imageUrl: 'https://cdn.example.com/generated-with-continuity-state.jpg',
    })

    const { executeImageGenerate } = await import('@/lib/workflow-engine/executors/image-generate')
    const result = await executeImageGenerate(createContext({
      nodeType: 'image-generate',
      config: {
        model: 'fal::flux-pro',
      },
      inputs: {
        prompt: 'Panel 3 escalation shot',
        characterReference: ['/m/queen-ref'],
        locationReference: ['/m/secret-room-ref'],
        reference: ['/m/manual-frame'],
        continuityReferenceMeta: [
          {
            continuityKind: 'character-reference',
            sourceNodeId: 'storyboard_1__character_ref_1__image',
            characterName: 'Clara Queen',
            appearanceLockTokens: ['deep blue royal gown', 'silver crown'],
            identityTokens: ['cold gaze'],
          },
          {
            continuityKind: 'location-reference',
            sourceNodeId: 'storyboard_1__scene_ref_1__image',
            locationName: 'Secret Backroom',
            environmentLockTokens: ['stone walls', 'long wooden table'],
          },
        ],
        continuityMissingMeta: [
          {
            continuityKind: 'previous-panel-image',
            sourceNodeId: 'storyboard_1__panel_2__image',
            reason: 'source-node-output-missing',
          },
        ],
      },
    }))

    expect(mockGenerateImage).toHaveBeenCalledWith(
      'user_1',
      'fal::flux-pro',
      expect.stringContaining('Panel 3 escalation shot'),
      expect.objectContaining({
        referenceImages: ['/m/queen-ref', '/m/secret-room-ref', '/m/manual-frame'],
      }),
    )
    expect(mockGenerateImage.mock.calls[0]?.[2]).toContain('Environment lock cues:')
    expect(result.metadata).toEqual(expect.objectContaining({
      continuityReferenceCount: 2,
      previousPanelReferenceCount: 0,
      characterReferenceCount: 1,
      locationReferenceCount: 1,
      continuityChainActive: false,
      continuityCharacterActive: true,
      continuityLocationActive: true,
      continuityStrength: 'strong',
      continuitySourceKinds: ['character-reference', 'location-reference'],
      continuityMissingKinds: ['previous-panel-image'],
      continuityCharacterNames: ['Clara Queen'],
      appearanceLockTokenCount: 3,
      warnings: expect.arrayContaining([
        'Previous-panel continuity source is missing output. Run the earlier panel image first.',
      ]),
    }))
  })

  it('uses workflow continuity memory as standalone reference source across panels', async () => {
    mockGenerateImage.mockResolvedValue({
      success: true,
      imageUrl: 'https://cdn.example.com/generated-with-memory.jpg',
    })

    const { executeImageGenerate } = await import('@/lib/workflow-engine/executors/image-generate')
    const result = await executeImageGenerate(createContext({
      nodeType: 'image-generate',
      config: {
        model: 'fal::flux-pro',
      },
      inputs: {
        prompt: 'Panel 4 continuity test',
        continuityState: {
          panelIndex: 3,
          panelNumber: 4,
          sources: {
            characterReferences: [
              {
                characterName: 'Clara Queen',
                characterAssetId: '',
              },
            ],
            locationReference: {
              locationName: 'Secret Backroom',
              locationAssetId: '',
            },
          },
          identity: {
            characterNames: ['Clara Queen'],
            appearanceLockTokens: ['deep blue royal gown'],
          },
        },
        continuityMemory: {
          version: 1,
          updatedAt: '2026-04-01T12:00:00.000Z',
          characters: {
            'name:clara queen': {
              canonicalName: 'Clara Queen',
              characterAssetId: '',
              identityTokens: ['queen'],
              appearanceLockTokens: ['deep blue royal gown', 'silver crown'],
              preferredReferenceImage: '/m/memory-clara-preferred',
              latestGoodImage: '/m/memory-clara-latest',
              sourceNodeId: 'panel_3_image',
              sourcePanelId: 'panel_3_image',
              sourcePanelIndex: 2,
              sourcePanelNumber: 3,
              continuityStrength: 'strong',
              continuitySourceKinds: ['panel-image'],
              updatedAt: '2026-04-01T12:00:00.000Z',
            },
          },
          locations: {
            'name:secret backroom': {
              locationName: 'Secret Backroom',
              locationAssetId: '',
              preferredReferenceImage: '/m/memory-room-preferred',
              latestGoodImage: '/m/memory-room-latest',
              sourceNodeId: 'panel_3_image',
              sourcePanelId: 'panel_3_image',
              sourcePanelIndex: 2,
              sourcePanelNumber: 3,
              continuityStrength: 'strong',
              continuitySourceKinds: ['panel-image'],
              updatedAt: '2026-04-01T12:00:00.000Z',
            },
          },
        },
        reference: ['/m/manual-frame'],
      },
    }))

    expect(mockGenerateImage).toHaveBeenCalledWith(
      'user_1',
      'fal::flux-pro',
      expect.stringContaining('Panel 4 continuity test'),
      expect.objectContaining({
        referenceImages: [
          '/m/memory-clara-preferred',
          '/m/memory-clara-latest',
          '/m/memory-room-preferred',
          '/m/memory-room-latest',
          '/m/manual-frame',
        ],
      }),
    )
    expect(mockGenerateImage.mock.calls[0]?.[2]).toContain('[Continuity Constraints]')
    expect(result.metadata).toEqual(expect.objectContaining({
      continuityMemoryActive: true,
      continuityMemoryReferenceCount: 4,
      continuityMemoryCharacterReferenceCount: 2,
      continuityMemoryLocationReferenceCount: 2,
      continuityCharacterActive: true,
      continuityLocationActive: true,
      continuityStrength: 'strong',
      continuityCharacterNames: ['Clara Queen'],
      continuityLocationName: 'Secret Backroom',
    }))
  })

  it('returns candidateImages for standalone image generation when candidateCount is greater than one', async () => {
    mockGenerateImage.mockResolvedValue({
      success: true,
      imageUrl: 'https://cdn.example.com/generated-candidate.jpg',
    })
    mockProcessMediaResult
      .mockResolvedValueOnce('workflow/media/object-1')
      .mockResolvedValueOnce('workflow/media/object-2')
      .mockResolvedValueOnce('workflow/media/object-3')
    mockEnsureMediaObjectFromStorageKey
      .mockResolvedValueOnce({
        id: 'media_1',
        publicId: 'pub_1',
        url: '/m/pub_1',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        width: 1024,
        height: 1024,
        durationMs: null,
      })
      .mockResolvedValueOnce({
        id: 'media_2',
        publicId: 'pub_2',
        url: '/m/pub_2',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        width: 1024,
        height: 1024,
        durationMs: null,
      })
      .mockResolvedValueOnce({
        id: 'media_3',
        publicId: 'pub_3',
        url: '/m/pub_3',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        width: 1024,
        height: 1024,
        durationMs: null,
      })

    const { executeImageGenerate } = await import('@/lib/workflow-engine/executors/image-generate')
    const result = await executeImageGenerate(createContext({
      nodeType: 'image-generate',
      config: {
        model: 'fal::flux-pro',
        candidateCount: 3,
      },
      inputs: {
        prompt: 'Hero in the rain',
      },
    }))

    expect(mockGenerateImage).toHaveBeenCalledTimes(3)
    expect(result.outputs).toEqual(expect.objectContaining({
      image: '/m/pub_1',
      imageUrl: '/m/pub_1',
      candidateImages: ['/m/pub_1', '/m/pub_2', '/m/pub_3'],
    }))
    expect(result.metadata).toEqual(expect.objectContaining({
      candidateCount: 3,
    }))
  })

  it('generates standalone video output from upstream image input', async () => {
    mockGenerateVideo.mockResolvedValue({
      success: true,
      videoUrl: 'https://cdn.example.com/generated.mp4',
    })

    const { executeVideoGenerate } = await import('@/lib/workflow-engine/executors/video-generate')
    const result = await executeVideoGenerate(createContext({
      nodeType: 'video-generate',
      config: {
        model: 'google::veo-3',
        artStyle: 'american-comic',
        duration: 5,
        aspectRatio: '16:9',
      },
      inputs: {
        image: '/m/source-image',
        prompt: 'Subtle camera push-in',
      },
    }))

    expect(mockNormalizeToOriginalMediaUrl).toHaveBeenCalledWith('/m/source-image')
    expect(mockGenerateVideo).toHaveBeenCalledWith(
      'user_1',
      'google::veo-3',
      '/m/source-image',
      expect.objectContaining({
        prompt: `Subtle camera push-in, overall video visual style: ${getArtStylePrompt('american-comic', 'en')}`,
        duration: 5,
        aspectRatio: '16:9',
      }),
    )
    expect(mockProcessMediaResult).toHaveBeenCalledWith(expect.objectContaining({
      source: 'https://cdn.example.com/generated.mp4',
      type: 'video',
      keyPrefix: 'workflow/video-generate',
      targetId: 'node_1',
    }))
    expect(mockSubmitTask).not.toHaveBeenCalled()
    expect(result.outputs).toEqual(expect.objectContaining({
      video: '/m/pub_1',
      videoUrl: '/m/pub_1',
      videoMediaId: 'media_1',
    }))
  })

  it('forwards selected art style into the workspace image bridge payload', async () => {
    mockBuildImageBillingPayload.mockResolvedValue({ panelId: 'panel_1' })
    mockSubmitTask.mockResolvedValue({ taskId: 'task_image_1', deduped: false })

    const { executeImageGenerate } = await import('@/lib/workflow-engine/executors/image-generate')
    const result = await executeImageGenerate(createContext({
      nodeType: 'image-generate',
      projectId: 'project_1',
      panelId: 'panel_1',
      config: {
        model: 'fal::flux-pro',
        artStyle: 'realistic',
        candidateCount: 4,
      },
    }))

    expect(mockBuildImageBillingPayload).toHaveBeenCalledWith({
      projectId: 'project_1',
      userId: 'user_1',
      imageModel: 'fal::flux-pro',
      basePayload: expect.objectContaining({
        panelId: 'panel_1',
        artStyle: 'realistic',
        candidateCount: 4,
      }),
    })
    expect(mockSubmitTask).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        panelId: 'panel_1',
        artStyle: 'realistic',
        candidateCount: 4,
      }),
    }))
    expect(result.metadata).toEqual(expect.objectContaining({
      artStyle: 'realistic',
      candidateCount: 4,
    }))
  })

  it('forwards selected art style into the workspace video bridge payload', async () => {
    mockSubmitTask.mockResolvedValue({ taskId: 'task_video_1', deduped: false })

    const { executeVideoGenerate } = await import('@/lib/workflow-engine/executors/video-generate')
    const result = await executeVideoGenerate(createContext({
      nodeType: 'video-generate',
      projectId: 'project_1',
      panelId: 'panel_1',
      config: {
        model: 'google::veo-3',
        artStyle: 'realistic',
      },
    }))

    expect(mockSubmitTask).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        storyboardId: 'storyboard_1',
        panelIndex: 0,
        artStyle: 'realistic',
      }),
    }))
    expect(result.metadata).toEqual(expect.objectContaining({
      artStyle: 'realistic',
    }))
  })

  it('fails standalone image generation when neither prompt input nor custom prompt is provided', async () => {
    const { executeImageGenerate } = await import('@/lib/workflow-engine/executors/image-generate')

    await expect(executeImageGenerate(createContext({
      nodeType: 'image-generate',
      config: { model: 'fal::flux-pro' },
      inputs: {},
    }))).rejects.toThrow('requires a prompt input or custom prompt')
    expect(mockGenerateImage).not.toHaveBeenCalled()
    expect(mockSubmitTask).not.toHaveBeenCalled()
  })

  it('fails standalone video generation when image input is missing', async () => {
    const { executeVideoGenerate } = await import('@/lib/workflow-engine/executors/video-generate')

    await expect(executeVideoGenerate(createContext({
      nodeType: 'video-generate',
      config: { model: 'google::veo-3' },
      inputs: { prompt: 'Move forward slowly' },
    }))).rejects.toThrow('requires an image input')
    expect(mockGenerateVideo).not.toHaveBeenCalled()
    expect(mockSubmitTask).not.toHaveBeenCalled()
  })
})
