import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireUserAuth = vi.fn()
const mockIsErrorResponse = vi.fn()
const mockWorkflowFindFirst = vi.fn()
const mockExecutionFindFirst = vi.fn()
const mockExecutionUpdateMany = vi.fn()

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
      updateMany: mockExecutionUpdateMany,
    },
  },
}))

function buildContinuation(runToken: string) {
  return {
    runToken,
    order: ['img_1', 'txt_2'],
    nextIndex: 1,
    pausedNodeId: 'img_1',
    freshlyExecutedNodeIds: ['img_1'],
    graphSignature: '{"nodes":[],"edges":[]}',
    updatedAt: '2026-03-17T00:00:00.000Z',
  }
}

describe('POST /api/workflows/[workflowId]/executions/resume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUserAuth.mockResolvedValue({
      session: { user: { id: 'user_1' } },
    })
    mockIsErrorResponse.mockReturnValue(false)
    mockWorkflowFindFirst.mockResolvedValue({ id: 'workflow_1' })
    mockExecutionUpdateMany.mockResolvedValue({ count: 1 })
  })

  it('grants continuation lease for a valid paused execution', async () => {
    const continuation = buildContinuation('run_1')
    mockExecutionFindFirst.mockResolvedValue({
      id: 'exec_1',
      status: 'running',
      nodeStates: JSON.stringify({
        __workflowContinuation: continuation,
      }),
      updatedAt: new Date('2026-03-17T00:00:00.000Z'),
    })

    const { POST } = await import('@/app/api/workflows/[workflowId]/executions/resume/route')
    const request = new NextRequest('http://localhost:3000/api/workflows/workflow_1/executions/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        executionId: 'exec_1',
        continuation,
        clientInstanceId: 'tab_a',
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ workflowId: 'workflow_1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.granted).toBe(true)
    expect(payload.lease.holderClientId).toBe('tab_a')
    expect(payload.lease.runToken).toBe('run_1')
    expect(mockExecutionUpdateMany).toHaveBeenCalledTimes(1)
    const updateCall = mockExecutionUpdateMany.mock.calls[0]?.[0]
    const nodeStates = JSON.parse(updateCall.data.nodeStates)
    expect(nodeStates.__workflowExecutionLease.runToken).toBe('run_1')
    expect(nodeStates.__workflowExecutionLease.holderClientId).toBe('tab_a')
  })

  it('denies duplicate resume request from another context while lease is active', async () => {
    const continuation = buildContinuation('run_1')
    mockExecutionFindFirst.mockResolvedValue({
      id: 'exec_1',
      status: 'running',
      nodeStates: JSON.stringify({
        __workflowContinuation: continuation,
        __workflowExecutionLease: {
          leaseId: 'lease_1',
          runToken: 'run_1',
          holderClientId: 'tab_a',
          acquiredAt: '2026-03-17T00:00:00.000Z',
          updatedAt: '2026-03-17T00:00:00.000Z',
          expiresAt: '2099-03-17T00:10:00.000Z',
        },
      }),
      updatedAt: new Date('2026-03-17T00:00:00.000Z'),
    })

    const { POST } = await import('@/app/api/workflows/[workflowId]/executions/resume/route')
    const request = new NextRequest('http://localhost:3000/api/workflows/workflow_1/executions/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        executionId: 'exec_1',
        continuation,
        clientInstanceId: 'tab_b',
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ workflowId: 'workflow_1' }) })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.reason).toBe('lease_held')
    expect(mockExecutionUpdateMany).not.toHaveBeenCalled()
  })

  it('rejects stale continuation payload when run token no longer matches execution state', async () => {
    const persisted = buildContinuation('run_new')
    const stale = buildContinuation('run_old')
    mockExecutionFindFirst.mockResolvedValue({
      id: 'exec_1',
      status: 'running',
      nodeStates: JSON.stringify({
        __workflowContinuation: persisted,
      }),
      updatedAt: new Date('2026-03-17T00:00:00.000Z'),
    })

    const { POST } = await import('@/app/api/workflows/[workflowId]/executions/resume/route')
    const request = new NextRequest('http://localhost:3000/api/workflows/workflow_1/executions/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        executionId: 'exec_1',
        continuation: stale,
        clientInstanceId: 'tab_a',
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ workflowId: 'workflow_1' }) })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.reason).toBe('continuation_stale')
    expect(mockExecutionUpdateMany).not.toHaveBeenCalled()
  })

  it('returns conflict when optimistic update loses race during lease acquisition', async () => {
    const continuation = buildContinuation('run_1')
    mockExecutionFindFirst.mockResolvedValue({
      id: 'exec_1',
      status: 'running',
      nodeStates: JSON.stringify({
        __workflowContinuation: continuation,
      }),
      updatedAt: new Date('2026-03-17T00:00:00.000Z'),
    })
    mockExecutionUpdateMany.mockResolvedValueOnce({ count: 0 })

    const { POST } = await import('@/app/api/workflows/[workflowId]/executions/resume/route')
    const request = new NextRequest('http://localhost:3000/api/workflows/workflow_1/executions/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        executionId: 'exec_1',
        continuation,
        clientInstanceId: 'tab_a',
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ workflowId: 'workflow_1' }) })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.reason).toBe('lease_race')
  })
})
