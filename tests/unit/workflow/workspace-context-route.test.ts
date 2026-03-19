import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireProjectAuth = vi.fn()
const mockIsErrorResponse = vi.fn()
const mockPanelFindMany = vi.fn()
const mockVoiceLineFindMany = vi.fn()

type RouteHandler = (
  request: NextRequest,
  context?: { params: Promise<Record<string, string>> },
) => Promise<Response>

vi.mock('@/lib/api-auth', () => ({
  requireProjectAuth: mockRequireProjectAuth,
  isErrorResponse: mockIsErrorResponse,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    novelPromotionPanel: {
      findMany: mockPanelFindMany,
    },
    novelPromotionVoiceLine: {
      findMany: mockVoiceLineFindMany,
    },
  },
}))

vi.mock('@/lib/api-errors', () => ({
  ApiError: class MockApiError extends Error {
    code: string

    constructor(code: string, options?: { message?: string }) {
      super(options?.message || code)
      this.name = 'ApiError'
      this.code = code
    }
  },
  apiHandler: (handler: RouteHandler) => handler,
}))

describe('GET /api/workflows/workspace-context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsErrorResponse.mockReturnValue(false)
    mockRequireProjectAuth.mockResolvedValue({
      session: { user: { id: 'user_1' } },
      project: { id: 'project_1', userId: 'user_1', name: 'Project 1' },
      novelData: {
        id: 'np_1',
        episodes: [
          { id: 'ep_2', name: 'Second', episodeNumber: 2 },
          { id: 'ep_1', name: 'First', episodeNumber: 1 },
        ],
      },
    })

    mockPanelFindMany.mockResolvedValue([
      {
        id: 'panel_2',
        panelIndex: 1,
        panelNumber: 2,
        description: 'Panel two',
        imageUrl: null,
        videoUrl: null,
        storyboard: { episodeId: 'ep_1' },
      },
      {
        id: 'panel_1',
        panelIndex: 0,
        panelNumber: 1,
        description: 'Panel one',
        imageUrl: 'https://img/p1.png',
        videoUrl: null,
        storyboard: { episodeId: 'ep_1' },
      },
    ])

    mockVoiceLineFindMany.mockResolvedValue([
      {
        id: 'line_1',
        episodeId: 'ep_1',
        lineIndex: 1,
        speaker: 'A',
        content: 'Hello',
        audioUrl: null,
        audioDuration: null,
      },
      {
        id: 'line_2',
        episodeId: 'ep_2',
        lineIndex: 1,
        speaker: 'B',
        content: 'World',
        audioUrl: 'https://audio/2.mp3',
        audioDuration: 2,
      },
    ])
  })

  it('returns sorted workspace context payload for panel and voice binding selectors', async () => {
    const { GET } = await import('@/app/api/workflows/workspace-context/route')

    const request = new NextRequest('http://localhost:3000/api/workflows/workspace-context?projectId=project_1')
    const response = await GET(request, { params: Promise.resolve({}) })
    const json = await response.json()

    expect(mockRequireProjectAuth).toHaveBeenCalledWith('project_1', {
      include: { episodes: true },
    })

    expect(json.episodes).toEqual([
      { id: 'ep_1', label: 'E1 · First', episodeNumber: 1 },
      { id: 'ep_2', label: 'E2 · Second', episodeNumber: 2 },
    ])
    expect(json.panels.map((panel: { id: string }) => panel.id)).toEqual(['panel_1', 'panel_2'])
    expect(json.voiceLinesByEpisode.ep_1[0]).toEqual(expect.objectContaining({
      id: 'line_1',
      speaker: 'A',
    }))
  })
})
