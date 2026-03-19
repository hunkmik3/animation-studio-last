import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireUserAuth = vi.fn()
const mockIsErrorResponse = vi.fn()
const mockWorkflowFindFirst = vi.fn()
const mockWorkflowUpdateMany = vi.fn()
const mockExecutionFindMany = vi.fn()
const mockExecutionUpdateMany = vi.fn()
const mockExecutionCreate = vi.fn()

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
      updateMany: mockWorkflowUpdateMany,
    },
    workflowExecution: {
      findMany: mockExecutionFindMany,
      updateMany: mockExecutionUpdateMany,
      create: mockExecutionCreate,
    },
  },
}))

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/workflows/workflow_1/executions/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/workflows/[workflowId]/executions/start', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUserAuth.mockResolvedValue({
      session: { user: { id: 'user_1' } },
    })
    mockIsErrorResponse.mockReturnValue(false)
    mockWorkflowFindFirst.mockResolvedValue({
      id: 'workflow_1',
      updatedAt: new Date('2026-03-17T00:00:00.000Z'),
    })
    mockWorkflowUpdateMany.mockResolvedValue({ count: 1 })
    mockExecutionFindMany.mockResolvedValue([])
    mockExecutionUpdateMany.mockResolvedValue({ count: 0 })
    mockExecutionCreate.mockResolvedValue({ id: 'exec_1' })
  })

  it('acquires lease and creates execution cursor at start-run', async () => {
    const { POST } = await import('@/app/api/workflows/[workflowId]/executions/start/route')
    const response = await POST(
      buildRequest({
        runToken: 'run_1',
        graphSignature: '{"nodes":[1]}',
        clientInstanceId: 'tab_a',
      }),
      { params: Promise.resolve({ workflowId: 'workflow_1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.granted).toBe(true)
    expect(payload.executionId).toBe('exec_1')
    expect(payload.lease.runToken).toBe('run_1')
    expect(payload.lease.holderClientId).toBe('tab_a')
    expect(payload.cursor.runToken).toBe('run_1')
    expect(payload.cursor.graphSignature).toBe('{"nodes":[1]}')
    expect(payload.cursor.phase).toBe('running')
    expect(payload.cursor.nextIndex).toBe(0)

    expect(mockExecutionCreate).toHaveBeenCalledTimes(1)
    const createInput = mockExecutionCreate.mock.calls[0]?.[0]
    const nodeStates = JSON.parse(createInput.data.nodeStates)
    expect(nodeStates.__workflowExecutionLease.runToken).toBe('run_1')
    expect(nodeStates.__workflowExecutionLease.holderClientId).toBe('tab_a')
    expect(nodeStates.__workflowExecutionCursor.graphSignature).toBe('{"nodes":[1]}')
  })

  it('rejects duplicate start from another tab when active lease is held', async () => {
    mockExecutionFindMany.mockResolvedValue([
      {
        id: 'exec_active',
        nodeStates: JSON.stringify({
          __workflowExecutionLease: {
            leaseId: 'lease_1',
            runToken: 'run_1',
            holderClientId: 'tab_a',
            acquiredAt: '2026-03-17T00:00:00.000Z',
            updatedAt: '2026-03-17T00:00:00.000Z',
            expiresAt: '2099-03-17T00:10:00.000Z',
          },
        }),
      },
    ])

    const { POST } = await import('@/app/api/workflows/[workflowId]/executions/start/route')
    const response = await POST(
      buildRequest({
        runToken: 'run_2',
        graphSignature: '{"nodes":[2]}',
        clientInstanceId: 'tab_b',
      }),
      { params: Promise.resolve({ workflowId: 'workflow_1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.reason).toBe('start_lease_held')
    expect(mockExecutionCreate).not.toHaveBeenCalled()
  })

  it('rejects second start from same tab when another run token is already active', async () => {
    mockExecutionFindMany.mockResolvedValue([
      {
        id: 'exec_active',
        nodeStates: JSON.stringify({
          __workflowExecutionLease: {
            leaseId: 'lease_1',
            runToken: 'run_existing',
            holderClientId: 'tab_a',
            acquiredAt: '2026-03-17T00:00:00.000Z',
            updatedAt: '2026-03-17T00:00:00.000Z',
            expiresAt: '2099-03-17T00:10:00.000Z',
          },
        }),
      },
    ])

    const { POST } = await import('@/app/api/workflows/[workflowId]/executions/start/route')
    const response = await POST(
      buildRequest({
        runToken: 'run_new',
        graphSignature: '{"nodes":[3]}',
        clientInstanceId: 'tab_a',
      }),
      { params: Promise.resolve({ workflowId: 'workflow_1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.reason).toBe('start_active')
    expect(mockExecutionCreate).not.toHaveBeenCalled()
  })

  it('returns idempotent success when same tab retries the same run token', async () => {
    mockExecutionFindMany.mockResolvedValue([
      {
        id: 'exec_active',
        nodeStates: JSON.stringify({
          __workflowExecutionLease: {
            leaseId: 'lease_1',
            runToken: 'run_same',
            holderClientId: 'tab_a',
            acquiredAt: '2026-03-17T00:00:00.000Z',
            updatedAt: '2026-03-17T00:00:00.000Z',
            expiresAt: '2099-03-17T00:10:00.000Z',
          },
          __workflowExecutionCursor: {
            runToken: 'run_same',
            graphSignature: '{"nodes":[4]}',
            phase: 'running',
            nextIndex: 2,
            currentNodeId: 'node_2',
            pausedNodeId: null,
            updatedAt: '2026-03-17T00:00:00.000Z',
          },
        }),
      },
    ])

    const { POST } = await import('@/app/api/workflows/[workflowId]/executions/start/route')
    const response = await POST(
      buildRequest({
        runToken: 'run_same',
        graphSignature: '{"nodes":[4]}',
        clientInstanceId: 'tab_a',
      }),
      { params: Promise.resolve({ workflowId: 'workflow_1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.granted).toBe(true)
    expect(payload.alreadyRunning).toBe(true)
    expect(payload.executionId).toBe('exec_active')
    expect(payload.cursor.nextIndex).toBe(2)
    expect(mockExecutionCreate).not.toHaveBeenCalled()
  })
})
