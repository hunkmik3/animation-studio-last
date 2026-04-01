// =============================================
// Workflow Editor — Zustand Store
// Manages the full state of the node-based editor
// Phase 2: Output Persistence + Resume support
// =============================================
'use client'

import { create } from 'zustand'
import {
    type Node,
    type Edge,
    type OnNodesChange,
    type OnEdgesChange,
    type OnConnect,
    applyNodeChanges,
    applyEdgeChanges,
    addEdge,
} from '@xyflow/react'
import { NODE_TYPE_REGISTRY } from '@/lib/workflow-engine/registry'
import {
    getUnsupportedNodeExecutionMessage,
    isNodeTypeExecutionSupported,
    usesWorkspaceExecutionContext,
} from '@/lib/workflow-engine/execution-support'
import type { ExecutionStatus, NodeExecutionState } from '@/lib/workflow-engine/types'
import type { WorkflowContinuationMarker } from '@/lib/workflow-engine/continuation'
import type { WorkflowExecutionCursor, WorkflowExecutionLease } from '@/lib/workflow-engine/execution-authority'
import { isWorkflowExecutionLeaseExpired } from '@/lib/workflow-engine/execution-authority'
import { acquireExecutionResumeLease, persistNodeOutput, startWorkflowExecution, updateExecutionStatus } from './api'
import { isUsableNodeOutput, resolvePanelIdFromNode } from './execution-contract'
import { buildWorkflowGraphSignature } from './execution-signature'
import { collectUnsupportedExecutionNodes, sanitizeWorkflowGraph } from './graph-contract'
import {
    collectWorkflowExecutionContextIssues,
    resolveWorkflowNodeContextIssue,
} from './workspace-boundary'
import {
    buildStoryboardPanelGraph,
    collectStoryboardDerivedNodeIds,
    extractCharacterReferenceSeeds,
    extractStoryboardPanelsFromOutputs,
    extractStoryboardSceneReferenceSeeds,
} from './storyboard-materialization'
import { collectWorkflowNodeInputs } from '@/lib/workflow-engine/input-collection'
import { normalizeWorkflowArtStyle } from '@/lib/workflow-engine/art-style'

// ── Topological sort for workflow execution order ──
function topologicalSort(nodes: Node[], edges: Edge[]): string[] {
    const execNodes = nodes.filter(n => n.type !== 'workflowGroup' && !n.hidden)
    const nodeIds = new Set(execNodes.map(n => n.id))
    const adj: Record<string, string[]> = {}
    const inDegree: Record<string, number> = {}
    for (const node of execNodes) { adj[node.id] = []; inDegree[node.id] = 0 }
    for (const edge of edges) {
        if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
            adj[edge.source].push(edge.target)
            inDegree[edge.target]++
        }
    }
    const queue = execNodes.filter(n => inDegree[n.id] === 0).map(n => n.id)
    const result: string[] = []
    while (queue.length > 0) {
        const curr = queue.shift()!
        result.push(curr)
        for (const next of (adj[curr] || [])) { inDegree[next]--; if (inDegree[next] === 0) queue.push(next) }
    }
    const visited = new Set(result)
    for (const node of execNodes) { if (!visited.has(node.id)) result.push(node.id) }
    return result
}

/** Stable snapshot of a node's config for staleness detection */
function configSnapshot(config: Record<string, unknown>): string {
    try { return JSON.stringify(config, Object.keys(config).sort()) }
    catch { return '' }
}

function toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

function readStringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function resolveNodeOutputsForMaterialization(params: {
    nodeId: string
    nodes: Node[]
    nodeExecutionStates: Record<string, NodeExecutionState>
    nodeOutputs: Record<string, Record<string, unknown>>
}): Record<string, unknown> {
    const executionOutputs = toRecord(params.nodeExecutionStates[params.nodeId]?.outputs)
    if (Object.keys(executionOutputs).length > 0) return executionOutputs

    const storeOutputs = toRecord(params.nodeOutputs[params.nodeId])
    if (Object.keys(storeOutputs).length > 0) return storeOutputs

    const node = params.nodes.find((item) => item.id === params.nodeId)
    return toRecord(toRecord(node?.data).initialOutput)
}

function resolveConnectedMaterializationValue(params: {
    targetNodeId: string
    targetHandle: string
    nodes: Node[]
    edges: Edge[]
    nodeExecutionStates: Record<string, NodeExecutionState>
    nodeOutputs: Record<string, Record<string, unknown>>
}): unknown {
    const matches = params.edges.filter((edge) =>
        edge.target === params.targetNodeId
        && (typeof edge.targetHandle === 'string' ? edge.targetHandle : '') === params.targetHandle,
    )

    for (const edge of matches) {
        const sourceHandle = typeof edge.sourceHandle === 'string' ? edge.sourceHandle : ''
        if (!sourceHandle) continue
        const outputs = resolveNodeOutputsForMaterialization({
            nodeId: edge.source,
            nodes: params.nodes,
            nodeExecutionStates: params.nodeExecutionStates,
            nodeOutputs: params.nodeOutputs,
        })
        const value = outputs[sourceHandle]
        if (value !== undefined) return value
    }

    return undefined
}

function enrichOutputsWithExecutionMeta(params: {
    outputs: Record<string, unknown>
    temporaryImplementation: boolean
    parityNotes: string
    metadata: Record<string, unknown>
}): Record<string, unknown> {
    const nextOutputs: Record<string, unknown> = { ...params.outputs }
    if (params.temporaryImplementation) {
        nextOutputs._temporaryImplementation = true
    }
    if (params.parityNotes) {
        nextOutputs._parityNotes = params.parityNotes
    }
    if (Object.keys(params.metadata).length > 0) {
        nextOutputs._metadata = params.metadata
    }
    return nextOutputs
}

interface PersistedNodeOutput {
    outputs: Record<string, unknown>
    configSnapshot: string | null
    completedAt: string
}

interface PendingWorkflowContinuation {
    runToken: string
    order: string[]
    nextIndex: number
    pausedNodeId: string
    freshlyExecutedNodeIds: string[]
    graphSignature: string
}

type ContinuationRecoveryStatus = 'idle' | 'waiting' | 'ready' | 'stale'

interface ContinuationRecoveryState {
    status: ContinuationRecoveryStatus
    reason: string | null
}

interface WorkflowMeta {
    id: string | null
    projectId: string | null
    name: string
    description: string
    isSaved: boolean
}

interface WorkflowStore {
    // ── Graph state ──
    nodes: Node[]
    edges: Edge[]
    onNodesChange: OnNodesChange
    onEdgesChange: OnEdgesChange
    onConnect: OnConnect

    // ── Meta ──
    meta: WorkflowMeta
    setMeta: (patch: Partial<WorkflowMeta>) => void

    // ── Node operations ──
    addNode: (type: string, position: { x: number; y: number }) => void
    removeNode: (id: string) => void
    updateNodeConfig: (id: string, config: Record<string, unknown>) => void
    updateNodeData: (id: string, data: Record<string, unknown>) => void

    // ── Selection ──
    selectedNodeId: string | null
    selectNode: (id: string | null) => void

    // ── Execution ──
    executionStatus: ExecutionStatus
    nodeExecutionStates: Record<string, NodeExecutionState>
    nodeOutputs: Record<string, Record<string, unknown>>
    clientInstanceId: string
    activeRunToken: string | null
    activeExecutionLeaseId: string | null
    executionCursor: WorkflowExecutionCursor | null
    pendingContinuation: PendingWorkflowContinuation | null
    recoverableContinuation: PendingWorkflowContinuation | null
    continuationRecovery: ContinuationRecoveryState
    continuationInFlightKey: string | null
    setExecutionStatus: (status: ExecutionStatus) => void
    setNodeExecutionState: (nodeId: string, state: NodeExecutionState) => void
    setNodeOutput: (nodeId: string, outputs: Record<string, unknown>) => void
    resetExecution: () => void
    executeSingleNode: (nodeId: string) => Promise<void>
    executeWorkflow: () => Promise<void>
    resumeWorkflowAfterAsync: (completedNodeId: string) => Promise<void>
    resumeRecoverableContinuation: () => Promise<void>
    failWorkflowRun: () => Promise<void>
    setContinuationRecovery: (status: ContinuationRecoveryStatus, reason?: string | null) => void
    invalidateRecoverableContinuation: (reason: string) => Promise<void>

    // ── Persistence (Phase 2) ──
    currentExecutionId: string | null
    persistedOutputs: Record<string, PersistedNodeOutput> | null
    setCurrentExecutionId: (executionId: string | null) => void
    upsertPersistedOutput: (nodeId: string, entry: PersistedNodeOutput) => void
    hydrateFromExecution: (data: {
        executionId: string | null
        outputData: Record<string, PersistedNodeOutput> | null
        nodeStates: Record<string, NodeExecutionState> | null
        continuation: WorkflowContinuationMarker | null
        cursor: WorkflowExecutionCursor | null
        lease: WorkflowExecutionLease | null
    }) => void
    forceRerunNode: (nodeId: string) => Promise<void>
    forceRerunAll: () => Promise<void>
    materializeStoryboardNode: (nodeId: string) => void

    // ── Serialization ──
    toJSON: () => { nodes: Node[]; edges: Edge[] }
    loadFromJSON: (data: { nodes: Node[]; edges: Edge[] }) => void
    clear: () => void

    // ── UI Actions ──
    toggleGroupCollapse: (id: string) => void
}

let nodeIdCounter = 0

function generateNodeId(): string {
    nodeIdCounter += 1
    return `node_${Date.now()}_${nodeIdCounter}`
}

function generateWorkflowRunToken(): string {
    return `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

const WORKFLOW_CLIENT_INSTANCE_STORAGE_KEY = 'workflow-editor-client-instance-id'

function generateClientInstanceId(): string {
    return `wf_client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function getWorkflowClientInstanceId(): string {
    if (typeof window === 'undefined') {
        return 'wf_client_server'
    }
    try {
        const existing = window.sessionStorage.getItem(WORKFLOW_CLIENT_INSTANCE_STORAGE_KEY)
        if (existing && existing.trim().length > 0) {
            return existing
        }
        const next = generateClientInstanceId()
        window.sessionStorage.setItem(WORKFLOW_CLIENT_INSTANCE_STORAGE_KEY, next)
        return next
    } catch {
        return generateClientInstanceId()
    }
}

function buildExecutionCursor(params: {
    runToken: string
    graphSignature: string
    phase: WorkflowExecutionCursor['phase']
    nextIndex: number
    currentNodeId?: string | null
    pausedNodeId?: string | null
}): WorkflowExecutionCursor {
    return {
        runToken: params.runToken,
        graphSignature: params.graphSignature,
        phase: params.phase,
        nextIndex: params.nextIndex,
        currentNodeId: params.currentNodeId || null,
        pausedNodeId: params.pausedNodeId || null,
        updatedAt: new Date().toISOString(),
    }
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => {
    const setContinuationRecoveryState = (
        status: ContinuationRecoveryStatus,
        reason: string | null = null,
    ) => {
        set({ continuationRecovery: { status, reason } })
    }

    const isExecutionAuthorityConflict = (error: unknown): boolean => {
        if (!(error instanceof Error)) return false
        return error.message.includes('EXECUTION_AUTHORITY_CONFLICT')
    }

    const handleExecutionAuthorityConflict = (message: string) => {
        set({
            executionStatus: 'failed',
            activeRunToken: null,
            activeExecutionLeaseId: null,
            executionCursor: null,
            pendingContinuation: null,
            recoverableContinuation: null,
            continuationInFlightKey: null,
        })
        setContinuationRecoveryState('stale', message)
    }

    const persistExecutionCursor = async (
        cursor: WorkflowExecutionCursor | null,
        options?: { allowCreateExecution?: boolean }
    ) => {
        const workflowId = get().meta?.id
        if (!workflowId) return
        const executionId = get().currentExecutionId
        const leaseId = get().activeExecutionLeaseId
        const allowCreateExecution = options?.allowCreateExecution === true
        if (!executionId && !allowCreateExecution) return

        try {
            await persistNodeOutput(workflowId, {
                executionId: executionId || undefined,
                nodeId: '',
                cursor,
                leaseId: leaseId || undefined,
            })
        } catch (error) {
            if (isExecutionAuthorityConflict(error)) {
                handleExecutionAuthorityConflict('Execution authority conflict detected. Please rerun workflow.')
                return
            }
            // non-authority failures are non-blocking
        }
    }

    const persistContinuationMarker = async (
        continuation: WorkflowContinuationMarker | null,
        options?: { allowCreateExecution?: boolean },
    ) => {
        const workflowId = get().meta?.id
        if (!workflowId) return

        const executionId = get().currentExecutionId
        const leaseId = get().activeExecutionLeaseId
        const allowCreateExecution = options?.allowCreateExecution === true
        if (!executionId && !allowCreateExecution) return

        try {
            const response = await persistNodeOutput(workflowId, {
                executionId: executionId || undefined,
                nodeId: '',
                continuation,
                leaseId: leaseId || undefined,
            })
            if (response?.executionId && !get().currentExecutionId) {
                set({ currentExecutionId: response.executionId })
            }
        } catch (error) {
            if (isExecutionAuthorityConflict(error)) {
                handleExecutionAuthorityConflict('Execution authority conflict detected. Please rerun workflow.')
                return
            }
            // continuation persistence is best-effort
        }
    }

    const invalidateRecoverableContinuationInternal = async (reason: string) => {
        const recoverable = get().recoverableContinuation
        if (!recoverable) return

        set({
            recoverableContinuation: null,
            continuationInFlightKey: null,
        })
        setContinuationRecoveryState('stale', reason)
        await persistContinuationMarker(null, { allowCreateExecution: false })
        set({ activeExecutionLeaseId: null, executionCursor: null })
    }

    const finalizeWorkflowStatus = (status: 'completed' | 'failed') => {
        const state = get()
        const workflowId = state.meta?.id
        const execId = state.currentExecutionId
        const leaseId = state.activeExecutionLeaseId
        const runToken = state.activeRunToken
        const priorCursor = state.executionCursor
        const finalCursor = runToken && priorCursor
            ? buildExecutionCursor({
                runToken,
                graphSignature: priorCursor.graphSignature,
                phase: status,
                nextIndex: priorCursor.nextIndex,
                currentNodeId: null,
                pausedNodeId: null,
            })
            : null

        set({
            executionStatus: status,
            activeRunToken: null,
            activeExecutionLeaseId: null,
            executionCursor: finalCursor,
            pendingContinuation: null,
            recoverableContinuation: null,
            continuationInFlightKey: null,
        })
        setContinuationRecoveryState('idle')

        if (workflowId && execId) {
            updateExecutionStatus(
                workflowId,
                execId,
                status,
                null,
                finalCursor,
                leaseId || undefined,
            ).catch((error) => {
                if (isExecutionAuthorityConflict(error)) {
                    handleExecutionAuthorityConflict('Execution authority conflict detected while finalizing run.')
                }
            })
        }
    }

    const closeOpenExecutionContext = async (state: {
        meta: WorkflowMeta
        currentExecutionId: string | null
        executionStatus: ExecutionStatus
        pendingContinuation: PendingWorkflowContinuation | null
        recoverableContinuation: PendingWorkflowContinuation | null
        activeExecutionLeaseId: string | null
    }) => {
        if (!state.meta.id || !state.currentExecutionId) return
        const hasOpenExecutionContext = (
            state.executionStatus === 'running'
            || Boolean(state.pendingContinuation)
            || Boolean(state.recoverableContinuation)
            || Boolean(state.activeExecutionLeaseId)
        )
        if (!hasOpenExecutionContext) return

        try {
            await updateExecutionStatus(
                state.meta.id,
                state.currentExecutionId,
                'failed',
                null,
                null,
                state.activeExecutionLeaseId || undefined,
            )
        } catch (error) {
            if (isExecutionAuthorityConflict(error)) {
                handleExecutionAuthorityConflict('Execution authority conflict detected while starting a new run.')
                throw error
            }
            throw new Error('Failed to close previous workflow run before starting a new run.')
        }

        set({
            activeRunToken: null,
            activeExecutionLeaseId: null,
            executionCursor: null,
            pendingContinuation: null,
            recoverableContinuation: null,
            continuationRecovery: { status: 'idle', reason: null },
            continuationInFlightKey: null,
        })
    }

    const continueWorkflowExecution = async (params: {
        runToken: string
        order: string[]
        startIndex: number
        freshlyExecutedNodeIds: string[]
        graphSignature: string
    }) => {
        const freshlyExecuted = new Set(params.freshlyExecutedNodeIds)

        for (let index = params.startIndex; index < params.order.length; index++) {
            const before = get()
            if (before.executionStatus !== 'running') return
            if (before.activeRunToken !== params.runToken) return

            const nodeId = params.order[index]
            const node = before.nodes.find(n => n.id === nodeId)
            const nodeData = toRecord(node?.data)
            const nodeType = typeof nodeData.nodeType === 'string' ? nodeData.nodeType : ''
            const config = toRecord(nodeData.config)

            const runningCursor = buildExecutionCursor({
                runToken: params.runToken,
                graphSignature: params.graphSignature,
                phase: 'running',
                nextIndex: index,
                currentNodeId: nodeId,
                pausedNodeId: null,
            })
            set({ executionCursor: runningCursor })
            void persistExecutionCursor(runningCursor, { allowCreateExecution: false })

            const persisted = before.persistedOutputs?.[nodeId]
            if (persisted && isUsableNodeOutput(nodeType, persisted.outputs)) {
                const currentSnap = configSnapshot(config)
                const isConfigFresh = persisted.configSnapshot === currentSnap
                const upstreamEdges = before.edges.filter(e => e.target === nodeId)
                const allUpstreamSkipped = upstreamEdges.every(e => !freshlyExecuted.has(e.source))

                if (isConfigFresh && allUpstreamSkipped) {
                    set((s) => ({
                        nodeOutputs: { ...s.nodeOutputs, [nodeId]: persisted.outputs },
                        nodeExecutionStates: {
                            ...s.nodeExecutionStates,
                            [nodeId]: {
                                status: 'skipped',
                                progress: 100,
                                message: 'Reused from previous run',
                                completedAt: persisted.completedAt,
                                outputs: persisted.outputs,
                            }
                        }
                    }))
                    continue
                }
            }

            freshlyExecuted.add(nodeId)
            await before.executeSingleNode(nodeId)

            const after = get()
            if (after.executionStatus !== 'running') return
            if (after.activeRunToken !== params.runToken) return

            const nodeState = after.nodeExecutionStates[nodeId]
            if (nodeState?.status === 'failed') {
                finalizeWorkflowStatus('failed')
                return
            }

            if (nodeState?.status === 'running') {
                const continuation: PendingWorkflowContinuation = {
                    runToken: params.runToken,
                    order: params.order,
                    nextIndex: index + 1,
                    pausedNodeId: nodeId,
                    freshlyExecutedNodeIds: Array.from(freshlyExecuted),
                    graphSignature: params.graphSignature,
                }
                const pausedCursor = buildExecutionCursor({
                    runToken: params.runToken,
                    graphSignature: params.graphSignature,
                    phase: 'paused',
                    nextIndex: continuation.nextIndex,
                    currentNodeId: continuation.pausedNodeId,
                    pausedNodeId: continuation.pausedNodeId,
                })
                set({
                    pendingContinuation: continuation,
                    recoverableContinuation: null,
                    executionCursor: pausedCursor,
                })
                setContinuationRecoveryState('idle')
                void persistExecutionCursor(pausedCursor, { allowCreateExecution: false })
                void persistContinuationMarker({
                    runToken: continuation.runToken,
                    order: continuation.order,
                    nextIndex: continuation.nextIndex,
                    pausedNodeId: continuation.pausedNodeId,
                    freshlyExecutedNodeIds: continuation.freshlyExecutedNodeIds,
                    graphSignature: continuation.graphSignature,
                    updatedAt: new Date().toISOString(),
                }, { allowCreateExecution: true })
                return
            }
        }

        finalizeWorkflowStatus('completed')
    }

    return ({
    // ── UI Actions ──
    toggleGroupCollapse: (id) => {
        set((s) => {
            // 1. First, map over nodes to toggle the targeted group and hide/show its children
            const toggledNodes = s.nodes.map(n => {
                if (n.id === id) {
                    const isNowCollapsed = !n.data?.isCollapsed
                    return {
                        ...n,
                        data: { ...n.data, isCollapsed: isNowCollapsed },
                        style: {
                            ...n.style,
                            height: isNowCollapsed ? 50 : (n.data?.height as number || 400),
                            width: isNowCollapsed ? 280 : (n.data?.width as number || 800)
                        }
                    }
                }
                if (n.parentId === id) {
                    const parent = s.nodes.find(p => p.id === id)
                    const willCollapse = !parent?.data?.isCollapsed
                    return { ...n, hidden: willCollapse }
                }
                return n
            })

            // 2. Identify all groups and sort them by their old Y position to maintain sequence
            const groups = toggledNodes
                .filter(n => n.type === 'workflowGroup')
                .sort((a, b) => a.position.y - b.position.y)

            // 3. Recalculate Y positions for a perfect layout alignment
            let currentGlobalY = 50
            const updatedNodes = toggledNodes.map(n => ({ ...n })) // Clone array

            for (const group of groups) {
                const isCollapsed = group.data?.isCollapsed
                const currentHeight = isCollapsed ? 50 : ((group.data?.height as number) || 400)

                // Update Group Y
                const groupIdx = updatedNodes.findIndex(n => n.id === group.id)
                if (groupIdx > -1) {
                    updatedNodes[groupIdx].position = { ...updatedNodes[groupIdx].position, y: currentGlobalY }
                }

                // Update tied Clip Script Y
                const clipIdx = updatedNodes.findIndex(n => n.data?.tiedToGroup === group.id)
                if (clipIdx > -1) {
                    updatedNodes[clipIdx].position = {
                        ...updatedNodes[clipIdx].position,
                        y: currentGlobalY + currentHeight / 2 - 50
                    }
                }

                currentGlobalY += currentHeight + 60 // 60 is the spacing between groups
            }

            // 4. Update Root Story Y to center with the new total height
            const rootIdx = updatedNodes.findIndex(n => n.data?.isRootStory)
            if (rootIdx > -1) {
                updatedNodes[rootIdx].position = {
                    ...updatedNodes[rootIdx].position,
                    y: (currentGlobalY / 2) - 100
                }
            }

            return { nodes: updatedNodes }
        })
    },

    // ── Graph state ──
    nodes: [],
    edges: [],

    onNodesChange: (changes) => {
        set({ nodes: applyNodeChanges(changes, get().nodes) })
        set((s) => ({ meta: { ...s.meta, isSaved: false } }))
        void invalidateRecoverableContinuationInternal('Workflow graph changed. Saved continuation is stale.')
    },

    onEdgesChange: (changes) => {
        set({ edges: applyEdgeChanges(changes, get().edges) })
        set((s) => ({ meta: { ...s.meta, isSaved: false } }))
        void invalidateRecoverableContinuationInternal('Workflow connections changed. Saved continuation is stale.')
    },

    onConnect: (connection) => {
        set({ edges: addEdge({ ...connection, animated: true, style: { strokeWidth: 2 } }, get().edges) })
        set((s) => ({ meta: { ...s.meta, isSaved: false } }))
        void invalidateRecoverableContinuationInternal('Workflow connections changed. Saved continuation is stale.')
    },

    // ── Meta ──
    meta: { id: null, projectId: null, name: 'Untitled Workflow', description: '', isSaved: true },
    setMeta: (patch) => set((s) => ({ meta: { ...s.meta, ...patch } })),

    // ── Node operations ──
    addNode: (type, position) => {
        const def = NODE_TYPE_REGISTRY[type]
        if (!def) return

        const newNode: Node = {
            id: generateNodeId(),
            type: 'workflowNode',
            position,
            data: {
                nodeType: type,
                label: def.title,
                config: { ...def.defaultConfig },
            },
        }

        set((s) => ({
            nodes: [...s.nodes, newNode],
            meta: { ...s.meta, isSaved: false },
        }))
        void invalidateRecoverableContinuationInternal('Workflow graph changed. Saved continuation is stale.')
    },

    removeNode: (id) => {
        set((s) => ({
            nodes: s.nodes.filter((n) => n.id !== id),
            edges: s.edges.filter((e) => e.source !== id && e.target !== id),
            selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
            meta: { ...s.meta, isSaved: false },
        }))
        void invalidateRecoverableContinuationInternal('Workflow graph changed. Saved continuation is stale.')
    },

    updateNodeConfig: (id, config) => {
        set((s) => ({
            nodes: s.nodes.map((n) =>
                n.id === id ? { ...n, data: { ...n.data, config: { ...((n.data as Record<string, unknown>).config as Record<string, unknown>), ...config } } } : n,
            ),
            meta: { ...s.meta, isSaved: false },
        }))
        void invalidateRecoverableContinuationInternal('Node configuration changed. Saved continuation is stale.')
    },

    updateNodeData: (id, data) => {
        set((s) => ({
            nodes: s.nodes.map((n) =>
                n.id === id ? { ...n, data: { ...n.data, ...data } } : n,
            ),
        }))
    },

    // ── Selection ──
    selectedNodeId: null,
    selectNode: (id) => set({ selectedNodeId: id }),

    // ── Execution ──
    executionStatus: 'idle',
    nodeExecutionStates: {},
    nodeOutputs: {},
    clientInstanceId: getWorkflowClientInstanceId(),
    activeRunToken: null,
    activeExecutionLeaseId: null,
    executionCursor: null,
    pendingContinuation: null,
    recoverableContinuation: null,
    continuationRecovery: { status: 'idle', reason: null },
    continuationInFlightKey: null,
    setExecutionStatus: (status) => set({ executionStatus: status }),
    setNodeExecutionState: (nodeId, state) =>
        set((s) => ({ nodeExecutionStates: { ...s.nodeExecutionStates, [nodeId]: state } })),
    setNodeOutput: (nodeId, outputs) =>
        set((s) => ({ nodeOutputs: { ...s.nodeOutputs, [nodeId]: outputs } })),
    resetExecution: () => set({
        executionStatus: 'idle',
        nodeExecutionStates: {},
        nodeOutputs: {},
        currentExecutionId: null,
        activeRunToken: null,
        activeExecutionLeaseId: null,
        executionCursor: null,
        pendingContinuation: null,
        recoverableContinuation: null,
        continuationRecovery: { status: 'idle', reason: null },
        continuationInFlightKey: null,
    }),

    // ── Persistence (Phase 2) ──
    currentExecutionId: null,
    persistedOutputs: null,
    setCurrentExecutionId: (executionId) => set({ currentExecutionId: executionId }),
    upsertPersistedOutput: (nodeId, entry) => {
        set((s) => ({
            persistedOutputs: {
                ...(s.persistedOutputs || {}),
                [nodeId]: entry,
            },
        }))
    },

    hydrateFromExecution: (data) => {
        const hydrated: Record<string, Record<string, unknown>> = {}
        const hydratedStates: Record<string, NodeExecutionState> = {}
        const usablePersistedOutputs: Record<string, PersistedNodeOutput> = {}
        const persistedOutputData = data.outputData || {}
        const clientInstanceId = get().clientInstanceId
        const nodeTypeById = new Map(
            get().nodes.map((node) => [node.id, toRecord(node.data).nodeType]).map(([id, nodeType]) => [
                id,
                typeof nodeType === 'string' ? nodeType : '',
            ]),
        )

        for (const [nodeId, entry] of Object.entries(persistedOutputData)) {
            const nodeType = nodeTypeById.get(nodeId) || ''
            if (!isUsableNodeOutput(nodeType, entry.outputs)) continue
            hydrated[nodeId] = entry.outputs
            usablePersistedOutputs[nodeId] = entry
            hydratedStates[nodeId] = {
                status: 'completed',
                progress: 100,
                message: 'Restored from previous run',
                completedAt: entry.completedAt,
                outputs: entry.outputs,
            }
        }

        // Merge with initialOutput-based preloads (initialOutput takes lower priority)
        const currentOutputs = get().nodeOutputs
        const mergedOutputs = { ...currentOutputs }
        for (const [nodeId, outputs] of Object.entries(hydrated)) {
            mergedOutputs[nodeId] = { ...(currentOutputs[nodeId] || {}), ...outputs }
        }

        const persistedNodeStates = data.nodeStates || {}
        const graphSignature = buildWorkflowGraphSignature(get().nodes, get().edges)
        const continuation = data.continuation
        const cursorFromServer = data.cursor || null
        const leaseFromServer = data.lease && !isWorkflowExecutionLeaseExpired(data.lease) ? data.lease : null

        let recoverableContinuation: PendingWorkflowContinuation | null = null
        let continuationRecovery: ContinuationRecoveryState = { status: 'idle', reason: null }
        let activeExecutionLeaseId: string | null = null

        if (continuation) {
            const hasValidOrder = continuation.order.includes(continuation.pausedNodeId)
            const hasValidIndex = continuation.nextIndex >= 0 && continuation.nextIndex <= continuation.order.length
            if (!hasValidOrder || !hasValidIndex) {
                continuationRecovery = {
                    status: 'stale',
                    reason: 'Saved async continuation context is invalid. Please rerun the workflow.',
                }
            } else if (continuation.graphSignature !== graphSignature) {
                continuationRecovery = {
                    status: 'stale',
                    reason: 'Workflow graph changed since async pause. Please rerun the workflow.',
                }
            } else if (
                leaseFromServer
                && leaseFromServer.runToken === continuation.runToken
                && leaseFromServer.holderClientId !== clientInstanceId
            ) {
                continuationRecovery = {
                    status: 'stale',
                    reason: 'Another session currently owns continuation authority for this run.',
                }
            } else {
                recoverableContinuation = {
                    runToken: continuation.runToken,
                    order: continuation.order,
                    nextIndex: continuation.nextIndex,
                    pausedNodeId: continuation.pausedNodeId,
                    freshlyExecutedNodeIds: continuation.freshlyExecutedNodeIds,
                    graphSignature: continuation.graphSignature,
                }
                if (
                    leaseFromServer
                    && leaseFromServer.runToken === continuation.runToken
                    && leaseFromServer.holderClientId === clientInstanceId
                ) {
                    activeExecutionLeaseId = leaseFromServer.leaseId
                }

                const pausedNodeType = nodeTypeById.get(continuation.pausedNodeId) || ''
                const pausedState = persistedNodeStates[continuation.pausedNodeId]
                const pausedOutputCandidate = (pausedState?.outputs as Record<string, unknown> | undefined)
                    || hydrated[continuation.pausedNodeId]
                    || mergedOutputs[continuation.pausedNodeId]
                const pausedHasUsableOutput = isUsableNodeOutput(pausedNodeType, pausedOutputCandidate)

                continuationRecovery = pausedHasUsableOutput
                    ? { status: 'ready', reason: null }
                    : { status: 'waiting', reason: 'Waiting for async task output to become available.' }
            }
        }
        if (continuation && continuationRecovery.status === 'stale' && !leaseFromServer) {
            const workflowId = get().meta?.id
            if (workflowId && data.executionId) {
                void persistNodeOutput(workflowId, {
                    executionId: data.executionId,
                    nodeId: '',
                    continuation: null,
                })
            } else {
                void persistContinuationMarker(null, { allowCreateExecution: false })
            }
        }

        set({
            executionStatus: 'idle',
            currentExecutionId: data.executionId,
            persistedOutputs: Object.keys(usablePersistedOutputs).length > 0 ? usablePersistedOutputs : null,
            nodeOutputs: mergedOutputs,
            activeRunToken: null,
            activeExecutionLeaseId,
            executionCursor: cursorFromServer,
            pendingContinuation: null,
            recoverableContinuation,
            continuationRecovery,
            continuationInFlightKey: null,
            nodeExecutionStates: {
                ...get().nodeExecutionStates,
                ...persistedNodeStates,
                ...hydratedStates,
            },
        })
    },

    executeSingleNode: async (nodeId: string) => {
        const node = get().nodes.find(n => n.id === nodeId)
        if (!node) return

        const nodeData = toRecord(node.data)
        const nodeType = typeof nodeData.nodeType === 'string' ? nodeData.nodeType : ''
        const config = toRecord(nodeData.config)
        const initialOutput = toRecord(nodeData.initialOutput)
        const workflowId = get().meta?.id

        if (!nodeType) {
            const errMsg = 'Node type is missing'
            set((s) => ({
                nodeExecutionStates: {
                    ...s.nodeExecutionStates,
                    [nodeId]: {
                        status: 'failed',
                        progress: 0,
                        message: errMsg,
                        error: errMsg,
                    }
                }
            }))
            return
        }

        // ── Collect inputs from connected upstream nodes ──
        const incomingEdges = get().edges.filter(e => e.target === nodeId)
        const currentOutputs = get().nodeOutputs
        const inputs = collectWorkflowNodeInputs({
            nodeId,
            nodeType,
            edges: incomingEdges,
            nodeOutputs: currentOutputs,
        })

        const persistState = (nodeState: NodeExecutionState, outputs?: Record<string, unknown>) => {
            if (!workflowId) return

            const payload = {
                executionId: get().currentExecutionId || undefined,
                nodeId,
                nodeState,
                leaseId: get().activeExecutionLeaseId || undefined,
                ...(outputs ? {
                    outputs,
                    configSnapshot: configSnapshot(config),
                } : {}),
            }

            persistNodeOutput(workflowId, payload)
                .then((resp) => {
                    if (resp?.executionId && !get().currentExecutionId) {
                        set({ currentExecutionId: resp.executionId })
                    }
                    if (!outputs || !isUsableNodeOutput(nodeType, outputs)) return
                    get().upsertPersistedOutput(nodeId, {
                        outputs,
                        configSnapshot: configSnapshot(config),
                        completedAt: nodeState.completedAt || new Date().toISOString(),
                    })
                })
                .catch((error) => {
                    if (isExecutionAuthorityConflict(error)) {
                        handleExecutionAuthorityConflict('Execution authority conflict detected while updating node state.')
                    }
                })
        }

        if (!isNodeTypeExecutionSupported(nodeType)) {
            const errMsg = getUnsupportedNodeExecutionMessage(nodeType)
            const failedState: NodeExecutionState = {
                status: 'failed',
                progress: 0,
                message: errMsg,
                error: errMsg,
            }
            set((s) => ({
                nodeExecutionStates: {
                    ...s.nodeExecutionStates,
                    [nodeId]: failedState,
                },
            }))
            persistState(failedState)
            return
        }

        const contextIssue = resolveWorkflowNodeContextIssue({
            nodeId,
            nodeType,
            nodeData,
            label: typeof nodeData.label === 'string' ? nodeData.label : nodeId,
        })
        if (contextIssue) {
            const failedState: NodeExecutionState = {
                status: 'failed',
                progress: 0,
                message: contextIssue.message,
                error: contextIssue.message,
            }
            set((s) => ({
                nodeExecutionStates: {
                    ...s.nodeExecutionStates,
                    [nodeId]: failedState,
                },
            }))
            persistState(failedState)
            return
        }

        // Mark running
        set((s) => ({
            nodeExecutionStates: {
                ...s.nodeExecutionStates,
                [nodeId]: { status: 'running', progress: 10, message: 'Preparing...', startedAt: new Date().toISOString() }
            }
        }))

        try {
            // Try to extract panelId if this node is linked to a workspace panel
            const panelId = resolvePanelIdFromNode(nodeId, nodeData)
            const searchParams = new URLSearchParams(window.location.search)
            const projectId = get().meta?.projectId || searchParams.get('projectId') || ''
            const usesWorkspaceContext = usesWorkspaceExecutionContext({
                nodeType,
                panelId,
                config,
            })

            set((s) => ({
                nodeExecutionStates: {
                    ...s.nodeExecutionStates,
                    [nodeId]: { status: 'running', progress: 30, message: 'Submitting task...', startedAt: s.nodeExecutionStates[nodeId]?.startedAt || new Date().toISOString() }
                }
            }))

            const requestBody: Record<string, unknown> = {
                nodeType,
                nodeId,
                config,
                inputs,
            }
            if (projectId && usesWorkspaceContext) {
                requestBody.projectId = projectId
            }
            if (panelId) {
                requestBody.panelId = panelId
            }

            const res = await fetch('/api/workflows/execute-node', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            })

            const result = toRecord(await res.json())

            if (!res.ok) {
                const message = typeof result.message === 'string'
                    ? result.message
                    : typeof result.error === 'string'
                        ? result.error
                        : 'Execution failed'
                throw new Error(message)
            }

            if (result.mock === true) {
                throw new Error(
                    typeof result.message === 'string' && result.message.trim().length > 0
                        ? result.message
                        : `Node "${nodeType}" is currently unsupported.`,
                )
            }

            const parityNotes = readStringValue(result.parityNotes)
            const temporaryImplementation = result.temporaryImplementation === true
            const metadata = toRecord(result.metadata)
            if (parityNotes || temporaryImplementation || Object.keys(metadata).length > 0) {
                get().updateNodeData(nodeId, {
                    lastExecutionMeta: {
                        temporaryImplementation,
                        parityNotes: parityNotes || null,
                        metadata,
                    },
                })
            }

            const resultOutputs = enrichOutputsWithExecutionMeta({
                outputs: toRecord(result.outputs),
                temporaryImplementation,
                parityNotes,
                metadata,
            })
            if (isUsableNodeOutput(nodeType, resultOutputs)) {
                const mergedOutputs = { ...initialOutput, ...resultOutputs }
                const nodeState: NodeExecutionState = {
                    status: 'completed',
                    progress: 100,
                    message: typeof result.message === 'string' && result.message.trim().length > 0
                        ? result.message
                        : 'Done',
                    completedAt: new Date().toISOString(),
                    outputs: mergedOutputs
                }
                set((s) => ({
                    nodeOutputs: { ...s.nodeOutputs, [nodeId]: mergedOutputs },
                    nodeExecutionStates: { ...s.nodeExecutionStates, [nodeId]: nodeState }
                }))
                persistState(nodeState, mergedOutputs)
                return
            }

            const taskId = typeof result.taskId === 'string' ? result.taskId : ''
            if (taskId) {
                const nodeState: NodeExecutionState = {
                    status: 'running',
                    progress: 70,
                    message: typeof result.message === 'string' && result.message.trim().length > 0
                        ? `${result.message} (task ${taskId.slice(0, 8)}...)`
                        : `Task submitted (${taskId.slice(0, 8)}...), waiting for completion`,
                    startedAt: get().nodeExecutionStates[nodeId]?.startedAt || new Date().toISOString(),
                }
                set((s) => ({
                    nodeExecutionStates: { ...s.nodeExecutionStates, [nodeId]: nodeState }
                }))
                persistState(nodeState)
                return
            }

            if (typeof result.message === 'string' && result.message.trim().length > 0) {
                throw new Error(result.message)
            }
            throw new Error(`Node "${nodeType}" returned no usable output and no async task id`)
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'Unknown error'
            const failedState: NodeExecutionState = {
                status: 'failed',
                progress: 0,
                message: errMsg,
                error: errMsg,
            }
            set((s) => ({
                nodeExecutionStates: {
                    ...s.nodeExecutionStates,
                    [nodeId]: failedState
                }
            }))
            persistState(failedState)
        }
    },

    // ── Execute full workflow in topological order (with resume) ──
    executeWorkflow: async () => {
        const currentState = get()
        const workflowId = currentState.meta.id
        if (!workflowId) {
            throw new Error('Please save workflow before running so execution authority can be established.')
        }
        await closeOpenExecutionContext(currentState)
        const stateAfterClose = get()
        const sanitizedGraph = sanitizeWorkflowGraph({
            nodes: stateAfterClose.nodes,
            edges: stateAfterClose.edges,
        })
        if (sanitizedGraph.changed) {
            set({
                nodes: sanitizedGraph.nodes,
                edges: sanitizedGraph.edges,
            })
        }

        const unsupportedNodes = collectUnsupportedExecutionNodes(sanitizedGraph.nodes)
        if (unsupportedNodes.length > 0) {
            const unsupportedSummary = unsupportedNodes
                .map((node) => `${node.label} (${node.nodeType})`)
                .slice(0, 5)
                .join(', ')
            throw new Error(
                `Workflow contains unsupported execution nodes: ${unsupportedSummary}. Remove or replace unsupported nodes before running.`,
            )
        }

        const contextIssues = collectWorkflowExecutionContextIssues(sanitizedGraph.nodes)
        if (contextIssues.length > 0) {
            const contextSummary = contextIssues
                .map((issue) => `${issue.label}: ${issue.missing.join('+')}`)
                .slice(0, 5)
                .join(', ')
            throw new Error(
                `Workflow contains nodes missing required workspace context: ${contextSummary}. Pull from Workspace or complete node settings before running.`,
            )
        }

        const execOrder = topologicalSort(sanitizedGraph.nodes, sanitizedGraph.edges)
        if (execOrder.length === 0) {
            set({ executionStatus: 'idle' })
            return
        }
        const runToken = generateWorkflowRunToken()
        const graphSignature = buildWorkflowGraphSignature(sanitizedGraph.nodes, sanitizedGraph.edges)
        const startResult = await startWorkflowExecution(workflowId, {
            runToken,
            graphSignature,
            clientInstanceId: stateAfterClose.clientInstanceId,
        })
        if (!startResult.granted || !startResult.executionId || !startResult.lease) {
            const message = startResult.message || 'Unable to acquire execution authority for this run.'
            handleExecutionAuthorityConflict(message)
            throw new Error(message)
        }

        const pendingStates: Record<string, NodeExecutionState> = {}
        for (const nodeId of execOrder) {
            pendingStates[nodeId] = { status: 'pending', progress: 0 }
        }
        set({
            executionStatus: 'running',
            activeRunToken: runToken,
            activeExecutionLeaseId: startResult.lease.leaseId,
            executionCursor: startResult.cursor || buildExecutionCursor({
                runToken,
                graphSignature,
                phase: 'running',
                nextIndex: 0,
                currentNodeId: execOrder[0] || null,
                pausedNodeId: null,
            }),
            currentExecutionId: startResult.executionId,
            pendingContinuation: null,
            recoverableContinuation: null,
            continuationRecovery: { status: 'idle', reason: null },
            continuationInFlightKey: null,
            nodeExecutionStates: pendingStates,
        })
        void persistContinuationMarker(null, { allowCreateExecution: false })
        void persistExecutionCursor(buildExecutionCursor({
            runToken,
            graphSignature,
            phase: 'running',
            nextIndex: 0,
            currentNodeId: execOrder[0] || null,
            pausedNodeId: null,
        }), { allowCreateExecution: false })

        await continueWorkflowExecution({
            runToken,
            order: execOrder,
            startIndex: 0,
            freshlyExecutedNodeIds: [],
            graphSignature,
        })
    },

    resumeWorkflowAfterAsync: async (completedNodeId) => {
        const state = get()
        const pending = state.pendingContinuation
        if (!pending) return
        if (state.executionStatus !== 'running') return
        if (state.activeRunToken !== pending.runToken) return
        if (pending.pausedNodeId !== completedNodeId) return

        const lockKey = `${pending.runToken}:${completedNodeId}`
        if (state.continuationInFlightKey === lockKey) return

        const completedNode = state.nodes.find((node) => node.id === completedNodeId)
        const nodeData = toRecord(completedNode?.data)
        const nodeType = typeof nodeData.nodeType === 'string' ? nodeData.nodeType : ''
        const nodeState = state.nodeExecutionStates[completedNodeId]
        const outputCandidate = nodeState?.outputs || state.nodeOutputs[completedNodeId]
        const isNodeCompleted = nodeState?.status === 'completed' || nodeState?.status === 'skipped'
        if (!isNodeCompleted) return
        if (!isUsableNodeOutput(nodeType, outputCandidate)) return

        set({
            continuationInFlightKey: lockKey,
            pendingContinuation: null,
            executionCursor: buildExecutionCursor({
                runToken: pending.runToken,
                graphSignature: pending.graphSignature,
                phase: 'running',
                nextIndex: pending.nextIndex,
                currentNodeId: pending.order[pending.nextIndex] || null,
                pausedNodeId: null,
            }),
        })
        void persistExecutionCursor(buildExecutionCursor({
            runToken: pending.runToken,
            graphSignature: pending.graphSignature,
            phase: 'running',
            nextIndex: pending.nextIndex,
            currentNodeId: pending.order[pending.nextIndex] || null,
            pausedNodeId: null,
        }), { allowCreateExecution: false })
        void persistContinuationMarker(null, { allowCreateExecution: false })

        try {
            await continueWorkflowExecution({
                runToken: pending.runToken,
                order: pending.order,
                startIndex: pending.nextIndex,
                freshlyExecutedNodeIds: pending.freshlyExecutedNodeIds,
                graphSignature: pending.graphSignature,
            })
        } finally {
            if (get().continuationInFlightKey === lockKey) {
                set({ continuationInFlightKey: null })
            }
        }
    },

    resumeRecoverableContinuation: async () => {
        const state = get()
        const continuation = state.recoverableContinuation
        if (!continuation) return
        if (state.continuationRecovery.status !== 'ready') return
        const workflowId = state.meta?.id
        const executionId = state.currentExecutionId
        if (!workflowId || !executionId) {
            await invalidateRecoverableContinuationInternal('Execution context is missing. Please rerun workflow.')
            return
        }

        const pausedNode = state.nodes.find((node) => node.id === continuation.pausedNodeId)
        const pausedNodeData = toRecord(pausedNode?.data)
        const pausedNodeType = typeof pausedNodeData.nodeType === 'string' ? pausedNodeData.nodeType : ''
        const pausedState = state.nodeExecutionStates[continuation.pausedNodeId]
        const pausedOutputCandidate = pausedState?.outputs || state.nodeOutputs[continuation.pausedNodeId]
        if (!isUsableNodeOutput(pausedNodeType, pausedOutputCandidate)) {
            setContinuationRecoveryState('waiting', 'Async output is not ready yet.')
            return
        }

        const currentGraphSignature = buildWorkflowGraphSignature(state.nodes, state.edges)
        if (currentGraphSignature !== continuation.graphSignature) {
            await invalidateRecoverableContinuationInternal('Workflow graph changed since async pause. Please rerun the workflow.')
            return
        }

        const lockKey = `${continuation.runToken}:${continuation.pausedNodeId}:recovered`
        if (state.continuationInFlightKey === lockKey) return
        set({ continuationInFlightKey: lockKey })

        const leaseResult = await acquireExecutionResumeLease(workflowId, {
            executionId,
            continuation: {
                runToken: continuation.runToken,
                order: continuation.order,
                nextIndex: continuation.nextIndex,
                pausedNodeId: continuation.pausedNodeId,
                freshlyExecutedNodeIds: continuation.freshlyExecutedNodeIds,
                graphSignature: continuation.graphSignature,
                updatedAt: new Date().toISOString(),
            },
            clientInstanceId: state.clientInstanceId,
        })
        if (!leaseResult.granted || !leaseResult.lease) {
            if (get().continuationInFlightKey === lockKey) {
                set({ continuationInFlightKey: null })
            }
            await invalidateRecoverableContinuationInternal(
                leaseResult.message || 'Execution continuation lease was denied by server authority.',
            )
            return
        }

        const resumedCursor = buildExecutionCursor({
            runToken: continuation.runToken,
            graphSignature: continuation.graphSignature,
            phase: 'running',
            nextIndex: continuation.nextIndex,
            currentNodeId: continuation.order[continuation.nextIndex] || null,
            pausedNodeId: null,
        })

        set({
            executionStatus: 'running',
            activeRunToken: continuation.runToken,
            activeExecutionLeaseId: leaseResult.lease.leaseId,
            executionCursor: resumedCursor,
            pendingContinuation: null,
            recoverableContinuation: null,
            continuationRecovery: { status: 'idle', reason: null },
            continuationInFlightKey: lockKey,
        })
        await persistContinuationMarker(null, { allowCreateExecution: false })
        await persistExecutionCursor(resumedCursor, { allowCreateExecution: false })

        try {
            await continueWorkflowExecution({
                runToken: continuation.runToken,
                order: continuation.order,
                startIndex: continuation.nextIndex,
                freshlyExecutedNodeIds: continuation.freshlyExecutedNodeIds,
                graphSignature: continuation.graphSignature,
            })
        } finally {
            if (get().continuationInFlightKey === lockKey) {
                set({ continuationInFlightKey: null })
            }
        }
    },

    setContinuationRecovery: (status, reason = null) => {
        setContinuationRecoveryState(status, reason)
    },

    invalidateRecoverableContinuation: async (reason) => {
        await invalidateRecoverableContinuationInternal(reason)
    },

    failWorkflowRun: async () => {
        if (get().executionStatus !== 'running') return
        finalizeWorkflowStatus('failed')
    },

    // ── Force re-run a single node (clear persisted output first) ──
    forceRerunNode: async (nodeId: string) => {
        const shouldClearContinuation = Boolean(get().currentExecutionId)
        // Clear this node's persisted output from local state
        set((s) => {
            const updated = { ...(s.persistedOutputs || {}) }
            delete updated[nodeId]
            return {
                persistedOutputs: updated,
                activeRunToken: null,
                activeExecutionLeaseId: null,
                executionCursor: null,
                pendingContinuation: null,
                recoverableContinuation: null,
                continuationRecovery: { status: 'idle', reason: null },
                continuationInFlightKey: null,
                executionStatus: 'idle',
            }
        })
        if (shouldClearContinuation) {
            void persistContinuationMarker(null, { allowCreateExecution: false })
        }
        await get().executeSingleNode(nodeId)
    },

    // ── Force re-run entire workflow (clear all persisted outputs) ──
    forceRerunAll: async () => {
        const stateBeforeReset = get()
        await closeOpenExecutionContext(stateBeforeReset)
        const shouldClearContinuation = Boolean(get().currentExecutionId)
        if (shouldClearContinuation) {
            void persistContinuationMarker(null, { allowCreateExecution: false })
        }
        set({
            persistedOutputs: null,
            nodeOutputs: {},
            nodeExecutionStates: {},
            executionStatus: 'idle',
            currentExecutionId: null,
            activeRunToken: null,
            activeExecutionLeaseId: null,
            executionCursor: null,
            pendingContinuation: null,
            recoverableContinuation: null,
            continuationRecovery: { status: 'idle', reason: null },
            continuationInFlightKey: null,
        })
        await get().executeWorkflow()
    },

    materializeStoryboardNode: (nodeId: string) => {
        const state = get()
        const storyboardNode = state.nodes.find((node) => node.id === nodeId)
        if (!storyboardNode) return

        const nodeData = toRecord(storyboardNode.data)
        const nodeType = typeof nodeData.nodeType === 'string' ? nodeData.nodeType : ''
        if (nodeType !== 'storyboard' && nodeType !== 'shot-splitter') return

        const executionOutputs = toRecord(state.nodeExecutionStates[nodeId]?.outputs)
        const storeOutputs = toRecord(state.nodeOutputs[nodeId])
        const initialOutput = toRecord(nodeData.initialOutput)
        const outputs = Object.keys(executionOutputs).length > 0
            ? executionOutputs
            : Object.keys(storeOutputs).length > 0
                ? storeOutputs
                : initialOutput
        const panels = extractStoryboardPanelsFromOutputs(outputs)
        if (panels.length === 0) {
            throw new Error(nodeType === 'shot-splitter'
                ? 'Shot splitter node has no materializable shots yet. Run shot splitter first.'
                : 'Storyboard node has no materializable panels yet. Run storyboard first.')
        }
        const characterReferences = extractCharacterReferenceSeeds(
            resolveConnectedMaterializationValue({
                targetNodeId: nodeId,
                targetHandle: 'characters',
                nodes: state.nodes,
                edges: state.edges,
                nodeExecutionStates: state.nodeExecutionStates,
                nodeOutputs: state.nodeOutputs,
            }),
        )
        const sceneReferences = extractStoryboardSceneReferenceSeeds(
            resolveConnectedMaterializationValue({
                targetNodeId: nodeId,
                targetHandle: 'scenes',
                nodes: state.nodes,
                edges: state.edges,
                nodeExecutionStates: state.nodeExecutionStates,
                nodeOutputs: state.nodeOutputs,
            }),
        )

        const derivedNodeIds = collectStoryboardDerivedNodeIds(state.nodes, nodeId)
        const nextNodes = state.nodes.filter((node) => !derivedNodeIds.has(node.id))
        const nextEdges = state.edges.filter((edge) => !derivedNodeIds.has(edge.source) && !derivedNodeIds.has(edge.target))
        const nextNodeOutputs = Object.fromEntries(
            Object.entries(state.nodeOutputs).filter(([candidateNodeId]) => !derivedNodeIds.has(candidateNodeId)),
        )
        const nextNodeExecutionStates = Object.fromEntries(
            Object.entries(state.nodeExecutionStates).filter(([candidateNodeId]) => !derivedNodeIds.has(candidateNodeId)),
        )
        const storyboardConfig = toRecord(nodeData.config)
        const builtGraph = buildStoryboardPanelGraph({
            storyboardNodeId: nodeId,
            storyboardNodeLabel: typeof nodeData.label === 'string' && nodeData.label.trim().length > 0
                ? nodeData.label.trim()
                : nodeId,
            storyboardPosition: storyboardNode.position,
            panels,
            characterReferences,
            sceneReferences,
            artStyle: normalizeWorkflowArtStyle(storyboardConfig.style),
        })

        set((s) => ({
            nodes: [...nextNodes, ...builtGraph.nodes],
            edges: [...nextEdges, ...builtGraph.edges],
            nodeOutputs: { ...nextNodeOutputs, ...builtGraph.preloadedOutputs },
            nodeExecutionStates: nextNodeExecutionStates,
            selectedNodeId: builtGraph.groupId,
            meta: { ...s.meta, isSaved: false },
        }))
        void invalidateRecoverableContinuationInternal('Storyboard panels were materialized into workflow nodes. Saved continuation is stale.')
    },

    // ── Serialization ──
    toJSON: () => {
        const { nodes, edges } = get()
        return { nodes, edges }
    },

    loadFromJSON: (data) => {
        const shouldClearContinuation = Boolean(get().currentExecutionId)
        if (shouldClearContinuation) {
            void persistContinuationMarker(null, { allowCreateExecution: false })
        }
        const sanitizedGraph = sanitizeWorkflowGraph({
            nodes: Array.isArray(data.nodes) ? data.nodes : [],
            edges: Array.isArray(data.edges) ? data.edges : [],
        })

        // Pre-populate nodeOutputs from nodes that have initialOutput (e.g., Characters/Locations from workspace)
        const preloadedOutputs: Record<string, Record<string, unknown>> = {}
        for (const node of sanitizedGraph.nodes) {
            const nodeData = toRecord(node.data)
            const initialOutput = toRecord(nodeData.initialOutput)
            if (Object.keys(initialOutput).length > 0) preloadedOutputs[node.id] = initialOutput
        }
        set({
            nodes: sanitizedGraph.nodes,
            edges: sanitizedGraph.edges,
            nodeOutputs: preloadedOutputs,
            nodeExecutionStates: {},
            currentExecutionId: null,
            persistedOutputs: null,
            activeRunToken: null,
            activeExecutionLeaseId: null,
            executionCursor: null,
            pendingContinuation: null,
            recoverableContinuation: null,
            continuationRecovery: { status: 'idle', reason: null },
            continuationInFlightKey: null,
            executionStatus: 'idle',
        })
        set((s) => ({ meta: { ...s.meta, isSaved: true } }))
    },

    clear: () => {
        const shouldClearContinuation = Boolean(get().currentExecutionId)
        if (shouldClearContinuation) {
            void persistContinuationMarker(null, { allowCreateExecution: false })
        }
        set({
            nodes: [],
            edges: [],
            selectedNodeId: null,
            executionStatus: 'idle',
            nodeExecutionStates: {},
            nodeOutputs: {},
            currentExecutionId: null,
            persistedOutputs: null,
            activeRunToken: null,
            activeExecutionLeaseId: null,
            executionCursor: null,
            pendingContinuation: null,
            recoverableContinuation: null,
            continuationRecovery: { status: 'idle', reason: null },
            continuationInFlightKey: null,
        })
        set((s) => ({ meta: { ...s.meta, isSaved: false } }))
    },
    })
})
