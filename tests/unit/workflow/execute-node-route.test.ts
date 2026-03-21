import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireProjectAuthLight = vi.fn()
const mockRequireUserAuth = vi.fn()
const mockIsErrorResponse = vi.fn()
const mockResolveRequiredTaskLocale = vi.fn()
const mockGetWorkflowExecutionModelConfig = vi.fn()
const mockTextInputExecutor = vi.fn()
const mockImageGenerateExecutor = vi.fn()

vi.mock('@/lib/api-auth', () => ({
  requireProjectAuthLight: mockRequireProjectAuthLight,
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
  getRequestId: () => 'req_test_workflow',
}))

vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: mockResolveRequiredTaskLocale,
}))

vi.mock('@/lib/config-service', () => ({
  getWorkflowExecutionModelConfig: mockGetWorkflowExecutionModelConfig,
}))

vi.mock('@/lib/workflow-engine/executors', () => ({
  NODE_EXECUTOR_REGISTRY: {
    'text-input': mockTextInputExecutor,
    'image-generate': mockImageGenerateExecutor,
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
    mockRequireUserAuth.mockResolvedValue({
      session: {
        user: { id: 'user_1' },
      },
    })
    mockIsErrorResponse.mockReturnValue(false)
    mockResolveRequiredTaskLocale.mockReturnValue('en')
    mockGetWorkflowExecutionModelConfig.mockResolvedValue({
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
    })
    mockTextInputExecutor.mockResolvedValue({
      outputs: { text: 'hello' },
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

  it('allows workflow-native node execution without projectId by resolving user-level context', async () => {
    const { POST } = await import('@/app/api/workflows/execute-node/route')

    const request = new NextRequest('http://localhost:3000/api/workflows/execute-node', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeType: 'text-input',
        nodeId: 'node_native_1',
        config: { content: 'native text' },
        inputs: {},
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.ok).toBe(true)
    expect(mockRequireUserAuth).toHaveBeenCalledTimes(1)
    expect(mockRequireProjectAuthLight).not.toHaveBeenCalled()
    expect(mockGetWorkflowExecutionModelConfig).toHaveBeenCalledWith({
      projectId: null,
      userId: 'user_1',
    })
    expect(mockTextInputExecutor).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: 'node_native_1',
      nodeType: 'text-input',
      projectId: null,
      userId: 'user_1',
      locale: 'en',
      modelConfig: expect.objectContaining({
        analysisModel: null,
      }),
    }))
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      nodeId: 'node_native_1',
      outputs: { text: 'hello' },
    }))
  })

  it('allows hybrid node execution without projectId when no workspace binding is present', async () => {
    const { POST } = await import('@/app/api/workflows/execute-node/route')
    mockImageGenerateExecutor.mockResolvedValue({
      outputs: { image: '/m/pub_1' },
    })

    const request = new NextRequest('http://localhost:3000/api/workflows/execute-node', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeType: 'image-generate',
        nodeId: 'node_image_1',
        config: { model: 'fal::flux-pro' },
        inputs: { prompt: 'standalone prompt' },
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.ok).toBe(true)
    expect(mockRequireUserAuth).toHaveBeenCalledTimes(1)
    expect(mockRequireProjectAuthLight).not.toHaveBeenCalled()
    expect(mockGetWorkflowExecutionModelConfig).toHaveBeenCalledWith({
      projectId: null,
      userId: 'user_1',
    })
    expect(mockImageGenerateExecutor).toHaveBeenCalledWith(expect.objectContaining({
      nodeType: 'image-generate',
      projectId: null,
      userId: 'user_1',
    }))
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      nodeId: 'node_image_1',
      outputs: { image: '/m/pub_1' },
    }))
  })

  it('fails explicitly when hybrid node is bound to workspace data without projectId', async () => {
    const { POST } = await import('@/app/api/workflows/execute-node/route')

    const request = new NextRequest('http://localhost:3000/api/workflows/execute-node', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeType: 'image-generate',
        nodeId: 'node_image_bound_1',
        panelId: 'panel_1',
        config: {},
      }),
    })

    await expect(POST(request, { params: Promise.resolve({}) })).rejects.toThrow('currently bound to workspace data')
    expect(mockRequireUserAuth).not.toHaveBeenCalled()
    expect(mockRequireProjectAuthLight).not.toHaveBeenCalled()
    expect(mockGetWorkflowExecutionModelConfig).not.toHaveBeenCalled()
  })
})
