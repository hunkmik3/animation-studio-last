import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'

const mockStartWorkflowExecution = vi.fn()
const mockPersistNodeOutput = vi.fn()
const mockUpdateExecutionStatus = vi.fn()
const mockAcquireExecutionResumeLease = vi.fn()

vi.mock('@/features/workflow-editor/api', () => ({
  startWorkflowExecution: mockStartWorkflowExecution,
  persistNodeOutput: mockPersistNodeOutput,
  updateExecutionStatus: mockUpdateExecutionStatus,
  acquireExecutionResumeLease: mockAcquireExecutionResumeLease,
}))

describe('workflow execution context preflight', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockStartWorkflowExecution.mockResolvedValue({
      granted: true,
      executionId: 'exec_1',
      lease: {
        leaseId: 'lease_1',
        runToken: 'run_1',
        holderClientId: 'wf_client_test',
        acquiredAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:00.000Z',
        expiresAt: '2026-03-18T00:10:00.000Z',
      },
      cursor: null,
      alreadyRunning: false,
      reason: null,
      message: null,
    })

    const { useWorkflowStore } = await import('@/features/workflow-editor/useWorkflowStore')
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      executionStatus: 'idle',
      nodeExecutionStates: {},
      nodeOutputs: {},
      clientInstanceId: 'wf_client_test',
      activeRunToken: null,
      activeExecutionLeaseId: null,
      executionCursor: null,
      pendingContinuation: null,
      recoverableContinuation: null,
      continuationRecovery: { status: 'idle', reason: null },
      continuationInFlightKey: null,
      currentExecutionId: null,
      persistedOutputs: null,
      meta: {
        id: 'workflow_test',
        projectId: 'project_1',
        name: 'Workflow Test',
        description: '',
        isSaved: true,
      },
    })
  })

  it('fails fast when workspace-linked nodes are missing required context', async () => {
    const { useWorkflowStore } = await import('@/features/workflow-editor/useWorkflowStore')
    const nodes: Node[] = [
      {
        id: 'node_image_1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'image-generate',
          label: 'Image Node',
          config: {},
        },
      },
    ]
    useWorkflowStore.setState({
      nodes,
      edges: [],
    })

    await expect(useWorkflowStore.getState().executeWorkflow()).rejects.toThrow('missing required workspace context')
    expect(mockStartWorkflowExecution).not.toHaveBeenCalled()
  })
})
