import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireProjectAuthLight = vi.fn()
const mockIsErrorResponse = vi.fn()
const mockResolveRequiredTaskLocale = vi.fn()
const mockGetProjectModelConfig = vi.fn()

vi.mock('@/lib/api-auth', () => ({
  requireProjectAuthLight: mockRequireProjectAuthLight,
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
  getRequestId: () => 'req_test_workflow',
}))

vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: mockResolveRequiredTaskLocale,
}))

vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: mockGetProjectModelConfig,
}))

vi.mock('@/lib/workflow-engine/executors', () => ({
  NODE_EXECUTOR_REGISTRY: {
    'text-input': undefined,
  },
}))

describe('POST /api/workflows/execute-node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireProjectAuthLight.mockResolvedValue({
      session: {
        user: { id: 'user_1' },
      },
    })
    mockIsErrorResponse.mockReturnValue(false)
    mockResolveRequiredTaskLocale.mockReturnValue('en')
    mockGetProjectModelConfig.mockResolvedValue({
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
    })
  })

  it('fails explicitly for unsupported node types instead of returning mock success', async () => {
    const { POST } = await import('@/app/api/workflows/execute-node/route')

    const request = new NextRequest('http://localhost:3000/api/workflows/execute-node', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeType: 'condition',
        nodeId: 'node_1',
        projectId: 'project_1',
        config: {},
      }),
    })

    await expect(POST(request, { params: Promise.resolve({}) })).rejects.toThrow('not enabled')
  })
})
