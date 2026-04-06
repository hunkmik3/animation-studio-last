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

function buildGetRequest() {
  return new NextRequest('http://localhost:3000/api/workflows/workflow_1/executions', {
    method: 'GET',
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

  it('persists workflow continuity memory patch when lease matches', async () => {
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
        continuityMemory: {
          version: 1,
          updatedAt: '2026-04-01T12:00:00.000Z',
          characters: {
            'name:clara queen': {
              canonicalName: 'Clara Queen',
              characterAssetId: '',
              identityTokens: ['queen'],
              appearanceLockTokens: ['deep blue royal gown'],
              preferredReferenceImage: '/m/clara-ref',
              latestGoodImage: '/m/clara-panel-1',
              sourceNodeId: 'panel_1_image',
              sourcePanelId: 'panel_1_image',
              sourcePanelIndex: 0,
              sourcePanelNumber: 1,
              continuityStrength: 'strong',
              continuitySourceKinds: ['character-reference'],
              updatedAt: '2026-04-01T12:00:00.000Z',
            },
          },
          locations: {},
        },
        leaseId: 'lease_active',
      }),
      { params: Promise.resolve({ workflowId: 'workflow_1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.saved).toBe(true)
    expect(mockExecutionUpdate).toHaveBeenCalledTimes(1)
    const updateInput = mockExecutionUpdate.mock.calls[0]?.[0]
    const persistedNodeStates = JSON.parse(updateInput.data.nodeStates)
    expect(persistedNodeStates.__workflowContinuityMemory).toEqual(expect.objectContaining({
      version: 1,
      characters: expect.objectContaining({
        'name:clara queen': expect.objectContaining({
          canonicalName: 'Clara Queen',
          preferredReferenceImage: '/m/clara-ref',
        }),
      }),
    }))
    expect(persistedNodeStates.__workflowExecutionLease.leaseId).toBe('lease_active')
  })

  it('returns continuity memory in GET payload and strips reserved nodeStates key', async () => {
    mockExecutionFindFirst.mockResolvedValue({
      id: 'exec_latest',
      status: 'running',
      outputData: JSON.stringify({
        node_1: {
          outputs: { image: '/m/panel-1' },
          configSnapshot: '{}',
          completedAt: '2026-04-01T12:01:00.000Z',
        },
      }),
      nodeStates: JSON.stringify({
        node_1: {
          status: 'completed',
          progress: 100,
          outputs: { image: '/m/panel-1' },
        },
        __workflowContinuityMemory: {
          version: 1,
          updatedAt: '2026-04-01T12:02:00.000Z',
          characters: {
            'name:clara queen': {
              canonicalName: 'Clara Queen',
              characterAssetId: '',
              identityTokens: ['queen'],
              appearanceLockTokens: ['deep blue royal gown'],
              preferredReferenceImage: '/m/clara-ref',
              latestGoodImage: '/m/panel-1',
              sourceNodeId: 'panel_1_image',
              sourcePanelId: 'panel_1_image',
              sourcePanelIndex: 0,
              sourcePanelNumber: 1,
              continuityStrength: 'strong',
              continuitySourceKinds: ['character-reference'],
              updatedAt: '2026-04-01T12:02:00.000Z',
            },
          },
          locations: {},
        },
      }),
      startedAt: new Date('2026-04-01T12:00:00.000Z'),
      completedAt: null,
      createdAt: new Date('2026-04-01T12:00:00.000Z'),
    })

    const { GET } = await import('@/app/api/workflows/[workflowId]/executions/route')
    const response = await GET(
      buildGetRequest(),
      { params: Promise.resolve({ workflowId: 'workflow_1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.continuityMemory).toEqual(expect.objectContaining({
      version: 1,
      characters: expect.objectContaining({
        'name:clara queen': expect.objectContaining({
          latestGoodImage: '/m/panel-1',
        }),
      }),
    }))
    expect(payload.nodeStates).toEqual(expect.objectContaining({
      node_1: expect.objectContaining({
        status: 'completed',
      }),
    }))
    expect(payload.nodeStates.__workflowContinuityMemory).toBeUndefined()
  })
})
