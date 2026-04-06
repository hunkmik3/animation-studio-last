import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import type { NodeExecutionState } from '@/lib/workflow-engine/types'
import { useWorkflowStore } from '@/features/workflow-editor/useWorkflowStore'
import { buildWorkflowGraphSignature } from '@/features/workflow-editor/execution-signature'

type ExecuteSingleNodeFn = ReturnType<typeof useWorkflowStore.getState>['executeSingleNode']
const originalFetch = global.fetch

function createWorkflowNodes(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    {
      id: 'img_panel_1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'image-generate',
        label: 'Image',
        config: {},
      },
    },
    {
      id: 'node_text_2',
      type: 'workflowNode',
      position: { x: 200, y: 0 },
      data: {
        nodeType: 'text-input',
        label: 'Text',
        config: { content: 'hello' },
      },
    },
  ]
  const edges: Edge[] = [
    {
      id: 'edge_1',
      source: 'img_panel_1',
      sourceHandle: 'image',
      target: 'node_text_2',
      targetHandle: 'text',
    },
  ]
  return { nodes, edges }
}

function resetStoreState() {
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
    continuityMemory: {
      version: 1,
      updatedAt: '2026-04-01T00:00:00.000Z',
      characters: {},
      locations: {},
    },
    meta: {
      id: 'workflow_test',
      projectId: null,
      name: 'Untitled Workflow',
      description: '',
      isSaved: true,
    },
  })
}

function setPendingAsyncState(runToken: string) {
  const { nodes, edges } = createWorkflowNodes()
  const graphSignature = buildWorkflowGraphSignature(nodes, edges)
  const pendingNodeStates: Record<string, NodeExecutionState> = {
    img_panel_1: {
      status: 'completed',
      progress: 100,
      outputs: { image: 'https://cdn.example/image.png' },
    },
    node_text_2: {
      status: 'pending',
      progress: 0,
    },
  }

  useWorkflowStore.setState({
    nodes,
    edges,
    executionStatus: 'running',
    activeRunToken: runToken,
    pendingContinuation: {
      runToken,
      order: ['img_panel_1', 'node_text_2'],
      nextIndex: 1,
      pausedNodeId: 'img_panel_1',
      freshlyExecutedNodeIds: ['img_panel_1'],
      graphSignature,
    },
    nodeExecutionStates: pendingNodeStates,
    nodeOutputs: {
      img_panel_1: { image: 'https://cdn.example/image.png' },
    },
  })
}

describe('workflow async continuation', () => {
  const originalExecuteSingleNode = useWorkflowStore.getState().executeSingleNode

  beforeEach(() => {
    resetStoreState()
    useWorkflowStore.setState({ executeSingleNode: originalExecuteSingleNode })
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
      if (url.includes('/executions/resume')) {
        return new Response(JSON.stringify({
          granted: true,
          lease: {
            leaseId: 'lease_test_1',
            runToken: 'run_resume',
            holderClientId: 'wf_client_test',
            acquiredAt: '2026-03-17T00:00:00.000Z',
            updatedAt: '2026-03-17T00:00:00.000Z',
            expiresAt: '2026-03-17T00:10:00.000Z',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ executionId: 'exec_test', saved: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('auto-continues downstream once paused async node has usable output', async () => {
    setPendingAsyncState('run_valid')

    const executeSingleNodeMock: ExecuteSingleNodeFn = vi.fn(async (nodeId: string) => {
      expect(nodeId).toBe('node_text_2')
      useWorkflowStore.setState((state) => ({
        nodeOutputs: {
          ...state.nodeOutputs,
          node_text_2: { text: 'downstream done' },
        },
        nodeExecutionStates: {
          ...state.nodeExecutionStates,
          node_text_2: {
            status: 'completed',
            progress: 100,
            outputs: { text: 'downstream done' },
            completedAt: new Date().toISOString(),
          },
        },
      }))
    })

    useWorkflowStore.setState({ executeSingleNode: executeSingleNodeMock })
    await useWorkflowStore.getState().resumeWorkflowAfterAsync('img_panel_1')

    expect(executeSingleNodeMock).toHaveBeenCalledTimes(1)
    expect(useWorkflowStore.getState().executionStatus).toBe('completed')
    expect(useWorkflowStore.getState().activeRunToken).toBeNull()
    expect(useWorkflowStore.getState().pendingContinuation).toBeNull()
    expect(useWorkflowStore.getState().nodeExecutionStates.node_text_2?.status).toBe('completed')
  })

  it('ignores duplicate resume triggers and avoids double-run', async () => {
    setPendingAsyncState('run_duplicate')

    const executeSingleNodeMock: ExecuteSingleNodeFn = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
      useWorkflowStore.setState((state) => ({
        nodeOutputs: {
          ...state.nodeOutputs,
          node_text_2: { text: 'once' },
        },
        nodeExecutionStates: {
          ...state.nodeExecutionStates,
          node_text_2: {
            status: 'completed',
            progress: 100,
            outputs: { text: 'once' },
            completedAt: new Date().toISOString(),
          },
        },
      }))
    })

    useWorkflowStore.setState({ executeSingleNode: executeSingleNodeMock })

    await Promise.all([
      useWorkflowStore.getState().resumeWorkflowAfterAsync('img_panel_1'),
      useWorkflowStore.getState().resumeWorkflowAfterAsync('img_panel_1'),
    ])

    expect(executeSingleNodeMock).toHaveBeenCalledTimes(1)
    expect(useWorkflowStore.getState().executionStatus).toBe('completed')
  })

  it('hydrates recoverable continuation as ready without auto-starting execution', () => {
    const { nodes, edges } = createWorkflowNodes()
    const graphSignature = buildWorkflowGraphSignature(nodes, edges)

    useWorkflowStore.setState({ nodes, edges })

    useWorkflowStore.getState().hydrateFromExecution({
      executionId: 'exec_1',
      outputData: {
        img_panel_1: {
          outputs: { image: 'https://cdn.example/image.png' },
          configSnapshot: '{}',
          completedAt: '2026-03-17T00:00:00.000Z',
        },
      },
      nodeStates: {
        img_panel_1: {
          status: 'completed',
          progress: 100,
          outputs: { image: 'https://cdn.example/image.png' },
        },
        node_text_2: {
          status: 'pending',
          progress: 0,
        },
      },
      continuation: {
        runToken: 'run_recoverable',
        order: ['img_panel_1', 'node_text_2'],
        nextIndex: 1,
        pausedNodeId: 'img_panel_1',
        freshlyExecutedNodeIds: ['img_panel_1'],
        graphSignature,
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
      cursor: null,
      lease: null,
    })

    expect(useWorkflowStore.getState().executionStatus).toBe('idle')
    expect(useWorkflowStore.getState().activeRunToken).toBeNull()
    expect(useWorkflowStore.getState().pendingContinuation).toBeNull()
    expect(useWorkflowStore.getState().recoverableContinuation?.pausedNodeId).toBe('img_panel_1')
    expect(useWorkflowStore.getState().continuationRecovery.status).toBe('ready')
    expect(useWorkflowStore.getState().continuationInFlightKey).toBeNull()
  })

  it('hydrates paused async continuation as waiting when usable output is not available yet', () => {
    const { nodes, edges } = createWorkflowNodes()
    const graphSignature = buildWorkflowGraphSignature(nodes, edges)
    useWorkflowStore.setState({ nodes, edges })

    useWorkflowStore.getState().hydrateFromExecution({
      executionId: 'exec_waiting',
      outputData: null,
      nodeStates: {
        img_panel_1: {
          status: 'running',
          progress: 70,
          message: 'Task submitted',
        },
      },
      continuation: {
        runToken: 'run_waiting',
        order: ['img_panel_1', 'node_text_2'],
        nextIndex: 1,
        pausedNodeId: 'img_panel_1',
        freshlyExecutedNodeIds: ['img_panel_1'],
        graphSignature,
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
      cursor: null,
      lease: null,
    })

    expect(useWorkflowStore.getState().recoverableContinuation?.pausedNodeId).toBe('img_panel_1')
    expect(useWorkflowStore.getState().continuationRecovery.status).toBe('waiting')
    expect(useWorkflowStore.getState().executionStatus).toBe('idle')
  })

  it('marks continuation stale when graph signature no longer matches after reload', () => {
    const { nodes, edges } = createWorkflowNodes()
    useWorkflowStore.setState({ nodes, edges })

    useWorkflowStore.getState().hydrateFromExecution({
      executionId: 'exec_stale',
      outputData: null,
      nodeStates: {
        img_panel_1: {
          status: 'running',
          progress: 70,
          message: 'Task submitted',
        },
      },
      continuation: {
        runToken: 'run_stale',
        order: ['img_panel_1', 'node_text_2'],
        nextIndex: 1,
        pausedNodeId: 'img_panel_1',
        freshlyExecutedNodeIds: ['img_panel_1'],
        graphSignature: '{"nodes":[],"edges":[]}',
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
      cursor: null,
      lease: null,
    })

    expect(useWorkflowStore.getState().recoverableContinuation).toBeNull()
    expect(useWorkflowStore.getState().continuationRecovery.status).toBe('stale')
  })

  it('hydrates workflow-scoped continuity memory from persisted execution payload', () => {
    useWorkflowStore.getState().hydrateFromExecution({
      executionId: 'exec_memory_1',
      outputData: null,
      nodeStates: null,
      continuation: null,
      cursor: null,
      lease: null,
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
            latestGoodImage: '/m/clara-panel-2',
            sourceNodeId: 'panel_2_image',
            sourcePanelId: 'panel_2_image',
            sourcePanelIndex: 1,
            sourcePanelNumber: 2,
            continuityStrength: 'strong',
            continuitySourceKinds: ['character-reference'],
            updatedAt: '2026-04-01T12:00:00.000Z',
          },
        },
        locations: {},
      },
    })

    const continuityMemory = useWorkflowStore.getState().continuityMemory
    expect(continuityMemory.characters['name:clara queen']).toEqual(expect.objectContaining({
      canonicalName: 'Clara Queen',
      latestGoodImage: '/m/clara-panel-2',
    }))
  })

  it('resumes a valid recoverable continuation exactly once even with duplicate trigger', async () => {
    const { nodes, edges } = createWorkflowNodes()
    const graphSignature = buildWorkflowGraphSignature(nodes, edges)
    useWorkflowStore.setState({ nodes, edges })

    useWorkflowStore.getState().hydrateFromExecution({
      executionId: 'exec_resume',
      outputData: {
        img_panel_1: {
          outputs: { image: 'https://cdn.example/image.png' },
          configSnapshot: '{}',
          completedAt: '2026-03-17T00:00:00.000Z',
        },
      },
      nodeStates: {
        img_panel_1: {
          status: 'completed',
          progress: 100,
          outputs: { image: 'https://cdn.example/image.png' },
        },
        node_text_2: {
          status: 'pending',
          progress: 0,
        },
      },
      continuation: {
        runToken: 'run_resume',
        order: ['img_panel_1', 'node_text_2'],
        nextIndex: 1,
        pausedNodeId: 'img_panel_1',
        freshlyExecutedNodeIds: ['img_panel_1'],
        graphSignature,
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
      cursor: null,
      lease: null,
    })

    const executeSingleNodeMock: ExecuteSingleNodeFn = vi.fn(async (nodeId: string) => {
      expect(nodeId).toBe('node_text_2')
      await new Promise((resolve) => setTimeout(resolve, 25))
      useWorkflowStore.setState((state) => ({
        nodeOutputs: {
          ...state.nodeOutputs,
          node_text_2: { text: 'resumed' },
        },
        nodeExecutionStates: {
          ...state.nodeExecutionStates,
          node_text_2: {
            status: 'completed',
            progress: 100,
            outputs: { text: 'resumed' },
            completedAt: new Date().toISOString(),
          },
        },
      }))
    })

    useWorkflowStore.setState({ executeSingleNode: executeSingleNodeMock })

    await Promise.all([
      useWorkflowStore.getState().resumeRecoverableContinuation(),
      useWorkflowStore.getState().resumeRecoverableContinuation(),
    ])

    expect(executeSingleNodeMock).toHaveBeenCalledTimes(1)
    expect(useWorkflowStore.getState().executionStatus).toBe('completed')
    expect(useWorkflowStore.getState().recoverableContinuation).toBeNull()
    expect(useWorkflowStore.getState().continuationRecovery.status).toBe('idle')
  })
})
