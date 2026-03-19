import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireUserAuth = vi.fn()
const mockIsErrorResponse = vi.fn()
const mockWorkflowFindFirst = vi.fn()
const mockExecutionFindFirst = vi.fn()
const mockExecutionCreate = vi.fn()
const mockExecutionUpdate = vi.fn()

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
    workflowExecution: {
      findFirst: mockExecutionFindFirst,
      create: mockExecutionCreate,
      update: mockExecutionUpdate,
    },
  },
}))

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/workflows/workflow_1/executions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/workflows/[workflowId]/executions authority checks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUserAuth.mockResolvedValue({
      session: { user: { id: 'user_1' } },
    })
    mockIsErrorResponse.mockReturnValue(false)
    mockWorkflowFindFirst.mockResolvedValue({ id: 'workflow_1' })
    mockExecutionCreate.mockResolvedValue({ id: 'exec_created' })
    mockExecutionUpdate.mockResolvedValue({ id: 'exec_1' })
  })

  it('rejects mutation when request lease does not match active execution lease', async () => {
    mockExecutionFindFirst.mockResolvedValue({
      id: 'exec_1',
      outputData: '{}',
      nodeStates: JSON.stringify({
        __workflowExecutionLease: {
          leaseId: 'lease_active',
          runToken: 'run_1',
          holderClientId: 'tab_a',
          acquiredAt: '2026-03-17T00:00:00.000Z',
          updatedAt: '2026-03-17T00:00:00.000Z',
          expiresAt: '2099-03-17T00:10:00.000Z',
        },
      }),
    })

    const { POST } = await import('@/app/api/workflows/[workflowId]/executions/route')

    await expect(
      POST(
        buildRequest({
          executionId: 'exec_1',
          nodeId: 'node_1',
          nodeState: { status: 'running', progress: 50 },
          leaseId: 'lease_stale_client',
        }),
        { params: Promise.resolve({ workflowId: 'workflow_1' }) },
      ),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Execution lease is held by another session',
    })

    expect(mockExecutionUpdate).not.toHaveBeenCalled()
  })

  it('allows mutation with matching lease and refreshes lease in persisted nodeStates', async () => {
    mockExecutionFindFirst.mockResolvedValue({
      id: 'exec_1',
      outputData: '{}',
      nodeStates: JSON.stringify({
        __workflowExecutionLease: {
          leaseId: 'lease_active',
          runToken: 'run_1',
          holderClientId: 'tab_a',
          acquiredAt: '2026-03-17T00:00:00.000Z',
          updatedAt: '2026-03-17T00:00:00.000Z',
          expiresAt: '2099-03-17T00:10:00.000Z',
        },
      }),
    })

    const { POST } = await import('@/app/api/workflows/[workflowId]/executions/route')
    const response = await POST(
      buildRequest({
        executionId: 'exec_1',
        nodeId: 'node_1',
        nodeState: { status: 'running', progress: 80, message: 'Still running' },
        leaseId: 'lease_active',
      }),
      { params: Promise.resolve({ workflowId: 'workflow_1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.executionId).toBe('exec_1')
    expect(mockExecutionUpdate).toHaveBeenCalledTimes(1)
    const updateInput = mockExecutionUpdate.mock.calls[0]?.[0]
    const persistedNodeStates = JSON.parse(updateInput.data.nodeStates)
    expect(persistedNodeStates.node_1).toEqual({
      status: 'running',
      progress: 80,
      message: 'Still running',
    })
    expect(persistedNodeStates.__workflowExecutionLease.leaseId).toBe('lease_active')
    expect(persistedNodeStates.__workflowExecutionLease.holderClientId).toBe('tab_a')
    expect(persistedNodeStates.__workflowExecutionLease.runToken).toBe('run_1')
    expect(typeof persistedNodeStates.__workflowExecutionLease.updatedAt).toBe('string')
    expect(typeof persistedNodeStates.__workflowExecutionLease.expiresAt).toBe('string')
  })
})
