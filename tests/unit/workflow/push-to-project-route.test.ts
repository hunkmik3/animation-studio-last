import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireUserAuth = vi.fn()
const mockIsErrorResponse = vi.fn()
const mockProjectFindFirst = vi.fn()
const mockTransaction = vi.fn()
const mockPanelUpdateMany = vi.fn()

const mockCollectWorkflowAssetCandidates = vi.fn()
const mockGetEmptyAssetMergeStats = vi.fn()
const mockMergeWorkflowCharactersIntoProject = vi.fn()
const mockMergeWorkflowScenesIntoProject = vi.fn()

vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: mockRequireUserAuth,
  isErrorResponse: mockIsErrorResponse,
}))

class MockApiError extends Error {
  code: string

  constructor(code: string, options?: { message?: string }) {
    super(options?.message || code)
    this.name = 'ApiError'
    this.code = code
  }
}

type RouteHandler = (
  request: NextRequest,
  context?: { params: Promise<Record<string, string>> },
) => Promise<Response>

vi.mock('@/lib/api-errors', () => ({
  ApiError: MockApiError,
  apiHandler: (handler: RouteHandler) => handler,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: {
      findFirst: mockProjectFindFirst,
    },
    $transaction: mockTransaction,
  },
}))

vi.mock('@/lib/workflows/project-asset-merge', () => ({
  collectWorkflowAssetCandidates: mockCollectWorkflowAssetCandidates,
  getEmptyAssetMergeStats: mockGetEmptyAssetMergeStats,
  mergeWorkflowCharactersIntoProject: mockMergeWorkflowCharactersIntoProject,
  mergeWorkflowScenesIntoProject: mockMergeWorkflowScenesIntoProject,
}))

describe('POST /api/workflows/push-to-project', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockRequireUserAuth.mockResolvedValue({
      session: { user: { id: 'user_1' } },
    })
    mockIsErrorResponse.mockReturnValue(false)
    mockProjectFindFirst.mockResolvedValue({
      id: 'project_1',
      novelPromotionData: { id: 'np_project_1' },
    })
    mockCollectWorkflowAssetCandidates.mockReturnValue({
      characters: [{ name: 'Lin Mo' }],
      updatedCharacters: [{ name: 'Lin Mo', updated_aliases: ['I'], updated_introduction: 'Main hero' }],
      scenes: [{ name: 'Main Hall' }],
    })
    mockGetEmptyAssetMergeStats.mockReturnValue({
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
    })
    mockMergeWorkflowCharactersIntoProject.mockResolvedValue({
      inputCount: 1,
      updateHintCount: 1,
      created: 1,
      updated: 1,
      skipped: 0,
      matched: 0,
    })
    mockMergeWorkflowScenesIntoProject.mockResolvedValue({
      inputCount: 1,
      created: 1,
      updated: 0,
      skipped: 0,
      matched: 0,
      createdDescriptions: 1,
    })

    mockPanelUpdateMany.mockResolvedValue({ count: 1 })

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        novelPromotionPanel: {
          updateMany: mockPanelUpdateMany,
        },
      }
      return callback(tx)
    })
  })

  it('updates panel prompts and applies character/location merge in a single transaction', async () => {
    const { POST } = await import('@/app/api/workflows/push-to-project/route')

    const request = new NextRequest('http://localhost:3000/api/workflows/push-to-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project_1',
        nodes: [
          {
            id: 'imgPrompt_panel1',
            data: {
              nodeType: 'text-input',
              panelId: 'panel1',
              workspaceBinding: 'panel-image-prompt',
              config: { content: 'Image prompt from workflow' },
            },
          },
          {
            id: 'vidPrompt_panel1',
            data: {
              nodeType: 'text-input',
              panelId: 'panel1',
              workspaceBinding: 'panel-video-prompt',
              config: { content: 'Video prompt from workflow' },
            },
          },
          {
            id: 'char_1',
            data: { nodeType: 'character-extract' },
          },
        ],
        nodeOutputs: {
          char_1: {
            characters: [{ name: 'Lin Mo' }],
          },
        },
        nodeExecutionStates: {
          char_1: { status: 'completed' },
        },
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const json = await response.json()

    expect(mockPanelUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'panel1',
        storyboard: {
          episode: {
            novelPromotionProjectId: 'np_project_1',
          },
        },
      },
      data: {
        imagePrompt: 'Image prompt from workflow',
        videoPrompt: 'Video prompt from workflow',
      },
    })
    expect(mockCollectWorkflowAssetCandidates).toHaveBeenCalledWith(expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'char_1' }),
      ]),
    }))
    expect(mockMergeWorkflowCharactersIntoProject).toHaveBeenCalledWith(expect.objectContaining({
      projectInternalId: 'np_project_1',
      characters: [{ name: 'Lin Mo' }],
    }))
    expect(mockMergeWorkflowScenesIntoProject).toHaveBeenCalledWith(expect.objectContaining({
      projectInternalId: 'np_project_1',
      scenes: [{ name: 'Main Hall' }],
    }))

    expect(json).toEqual({
      success: true,
      updatedCount: 1,
      panelPromptUpdates: 1,
      panelPromptUpdatesRequested: 1,
      panelPromptUpdatesSkipped: 0,
      applyAssetMerge: true,
      assetMerge: {
        characters: {
          inputCount: 1,
          updateHintCount: 1,
          created: 1,
          updated: 1,
          skipped: 0,
          matched: 0,
        },
        locations: {
          inputCount: 1,
          created: 1,
          updated: 0,
          skipped: 0,
          matched: 0,
          createdDescriptions: 1,
        },
      },
      warnings: [],
    })
  })

  it('does not count panel prompt updates that are outside project scope', async () => {
    const { POST } = await import('@/app/api/workflows/push-to-project/route')
    mockPanelUpdateMany.mockResolvedValueOnce({ count: 0 })

    const request = new NextRequest('http://localhost:3000/api/workflows/push-to-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project_1',
        nodes: [
          {
            id: 'imgPrompt_panel_outside',
            data: {
              nodeType: 'text-input',
              panelId: 'panel_outside',
              workspaceBinding: 'panel-image-prompt',
              config: { content: 'Cross-project prompt should be ignored' },
            },
          },
        ],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const json = await response.json()

    expect(json.updatedCount).toBe(0)
    expect(json.panelPromptUpdates).toBe(0)
    expect(json.panelPromptUpdatesRequested).toBe(1)
    expect(json.panelPromptUpdatesSkipped).toBe(1)
    expect(json.warnings).toEqual([])
  })

  it('returns context warnings for workspace-linked nodes missing required linkage', async () => {
    const { POST } = await import('@/app/api/workflows/push-to-project/route')

    const request = new NextRequest('http://localhost:3000/api/workflows/push-to-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project_1',
        nodes: [
          {
            id: 'custom_image_1',
            data: {
              nodeType: 'image-generate',
              label: 'Image Node Missing Context',
              config: {},
            },
          },
          {
            id: 'voice_1',
            data: {
              nodeType: 'voice-synthesis',
              label: 'Voice Node Missing Context',
              config: { episodeId: 'episode_1', lineId: '' },
            },
          },
        ],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const json = await response.json()

    expect(json.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Image Node Missing Context'),
      expect.stringContaining('Voice Node Missing Context'),
    ]))
  })
})
