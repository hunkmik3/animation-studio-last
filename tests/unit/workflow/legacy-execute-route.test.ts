import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireUserAuth = vi.fn()
const mockIsErrorResponse = vi.fn()
const mockWorkflowFindFirst = vi.fn()

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
    workflow: {
      findFirst: mockWorkflowFindFirst,
    },
  },
}))

describe('POST /api/workflows/[workflowId]/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUserAuth.mockResolvedValue({
      session: { user: { id: 'user_1' } },
    })
    mockIsErrorResponse.mockReturnValue(false)
    mockWorkflowFindFirst.mockResolvedValue({ id: 'workflow_1' })
  })

  it('is disabled to prevent using legacy placeholder executor path', async () => {
    const { POST } = await import('@/app/api/workflows/[workflowId]/execute/route')

    const request = new NextRequest('http://localhost:3000/api/workflows/workflow_1/execute', {
      method: 'POST',
    })

    await expect(POST(request, { params: Promise.resolve({ workflowId: 'workflow_1' }) }))
      .rejects
      .toThrow('disabled for launch safety')
  })
})

