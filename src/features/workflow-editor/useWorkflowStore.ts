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
import type { ExecutionStatus, NodeExecutionState } from '@/lib/workflow-engine/types'
import { persistNodeOutput, updateExecutionStatus } from './api'

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

interface PersistedNodeOutput {
    outputs: Record<string, unknown>
    configSnapshot: string | null
    completedAt: string
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
    setExecutionStatus: (status: ExecutionStatus) => void
    setNodeExecutionState: (nodeId: string, state: NodeExecutionState) => void
    setNodeOutput: (nodeId: string, outputs: Record<string, unknown>) => void
    resetExecution: () => void
    executeSingleNode: (nodeId: string) => Promise<void>
    executeWorkflow: () => Promise<void>

    // ── Persistence (Phase 2) ──
    currentExecutionId: string | null
    persistedOutputs: Record<string, PersistedNodeOutput> | null
    hydrateFromExecution: (data: {
        executionId: string | null
        outputData: Record<string, PersistedNodeOutput> | null
        nodeStates: Record<string, NodeExecutionState> | null
    }) => void
    forceRerunNode: (nodeId: string) => Promise<void>
    forceRerunAll: () => Promise<void>

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

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
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
    },

    onEdgesChange: (changes) => {
        set({ edges: applyEdgeChanges(changes, get().edges) })
        set((s) => ({ meta: { ...s.meta, isSaved: false } }))
    },

    onConnect: (connection) => {
        set({ edges: addEdge({ ...connection, animated: true, style: { strokeWidth: 2 } }, get().edges) })
        set((s) => ({ meta: { ...s.meta, isSaved: false } }))
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
    },

    removeNode: (id) => {
        set((s) => ({
            nodes: s.nodes.filter((n) => n.id !== id),
            edges: s.edges.filter((e) => e.source !== id && e.target !== id),
            selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
            meta: { ...s.meta, isSaved: false },
        }))
    },

    updateNodeConfig: (id, config) => {
        set((s) => ({
            nodes: s.nodes.map((n) =>
                n.id === id ? { ...n, data: { ...n.data, config: { ...((n.data as Record<string, unknown>).config as Record<string, unknown>), ...config } } } : n,
            ),
            meta: { ...s.meta, isSaved: false },
        }))
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
    setExecutionStatus: (status) => set({ executionStatus: status }),
    setNodeExecutionState: (nodeId, state) =>
        set((s) => ({ nodeExecutionStates: { ...s.nodeExecutionStates, [nodeId]: state } })),
    setNodeOutput: (nodeId, outputs) =>
        set((s) => ({ nodeOutputs: { ...s.nodeOutputs, [nodeId]: outputs } })),
    resetExecution: () => set({ executionStatus: 'idle', nodeExecutionStates: {}, nodeOutputs: {}, currentExecutionId: null }),

    // ── Persistence (Phase 2) ──
    currentExecutionId: null,
    persistedOutputs: null,

    hydrateFromExecution: (data) => {
        if (!data.outputData) return
        const hydrated: Record<string, Record<string, unknown>> = {}
        const hydratedStates: Record<string, NodeExecutionState> = {}

        for (const [nodeId, entry] of Object.entries(data.outputData)) {
            if (entry.outputs && Object.keys(entry.outputs).length > 0) {
                hydrated[nodeId] = entry.outputs
                hydratedStates[nodeId] = {
                    status: 'completed',
                    progress: 100,
                    message: 'Restored from previous run',
                    completedAt: entry.completedAt,
                    outputs: entry.outputs,
                }
            }
        }

        // Merge with initialOutput-based preloads (initialOutput takes lower priority)
        const currentOutputs = get().nodeOutputs
        const mergedOutputs = { ...currentOutputs }
        for (const [nodeId, outputs] of Object.entries(hydrated)) {
            mergedOutputs[nodeId] = { ...(currentOutputs[nodeId] || {}), ...outputs }
        }

        set({
            currentExecutionId: data.executionId,
            persistedOutputs: data.outputData,
            nodeOutputs: mergedOutputs,
            nodeExecutionStates: { ...get().nodeExecutionStates, ...hydratedStates },
        })
    },

    executeSingleNode: async (nodeId: string) => {
        const node = get().nodes.find(n => n.id === nodeId)
        if (!node) return

        const data = node.data as any
        const nodeType = data?.nodeType
        const config = data?.config || {}

        // ── Collect inputs from connected upstream nodes ──
        const inputs: Record<string, unknown> = {}
        const incomingEdges = get().edges.filter(e => e.target === nodeId)
        const currentOutputs = get().nodeOutputs
        for (const edge of incomingEdges) {
            const sourceOutputs = currentOutputs[edge.source]
            if (sourceOutputs && edge.sourceHandle) {
                const targetKey = (edge.targetHandle as string) || (edge.sourceHandle as string)
                const value = sourceOutputs[edge.sourceHandle as string]
                if (value !== undefined) inputs[targetKey] = value
            }
        }

        // Mark running
        set((s) => ({
            nodeExecutionStates: {
                ...s.nodeExecutionStates,
                [nodeId]: { status: 'running', progress: 10, message: 'Preparing...' }
            }
        }))

        try {
            // Extract projectId from URL search params
            const searchParams = new URLSearchParams(window.location.search)
            const projectId = get().meta?.projectId || searchParams.get('projectId') || ''

            // Try to extract panelId if this node is linked to a workspace panel
            const panelId = data?.panelId || (nodeId.startsWith('img_') || nodeId.startsWith('vid_')
                ? nodeId.replace(/^(img_|vid_)/, '')
                : null)

            set((s) => ({
                nodeExecutionStates: {
                    ...s.nodeExecutionStates,
                    [nodeId]: { status: 'running', progress: 30, message: 'Submitting task...' }
                }
            }))

            const res = await fetch('/api/workflows/execute-node', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nodeType,
                    nodeId,
                    projectId,
                    config,
                    inputs,
                    panelId,
                }),
            })

            const result = await res.json()

            if (!res.ok) {
                throw new Error(result.message || result.error || 'Execution failed')
            }

            set((s) => ({
                nodeExecutionStates: {
                    ...s.nodeExecutionStates,
                    [nodeId]: { status: 'running', progress: 60, message: result.mock ? 'Mock execution...' : 'Task submitted, waiting...' }
                }
            }))

            // Helper: persist outputs to DB (fire-and-forget)
            const workflowId = get().meta?.id
            const doPersist = (outputs: Record<string, unknown>, nodeState: NodeExecutionState) => {
                if (!workflowId) return
                persistNodeOutput(workflowId, {
                    executionId: get().currentExecutionId || undefined,
                    nodeId,
                    outputs,
                    configSnapshot: configSnapshot(config),
                    nodeState,
                }).then(resp => {
                    if (resp?.executionId && !get().currentExecutionId) {
                        set({ currentExecutionId: resp.executionId })
                    }
                }).catch(() => { /* persistence failure is non-blocking */ })
            }

            // If the API returned outputs directly — store them for downstream nodes
            // Merge with initialOutput so typed data (characters/scenes) is preserved
            if (result.outputs) {
                const mergedOutputs = { ...(data?.initialOutput || {}), ...result.outputs }
                const nodeState: NodeExecutionState = {
                    status: 'completed',
                    progress: 100,
                    message: 'Done',
                    completedAt: new Date().toISOString(),
                    outputs: mergedOutputs
                }
                set((s) => ({
                    nodeOutputs: { ...s.nodeOutputs, [nodeId]: mergedOutputs },
                    nodeExecutionStates: { ...s.nodeExecutionStates, [nodeId]: nodeState }
                }))
                doPersist(mergedOutputs, nodeState)
                return
            }

            // If a real task was submitted, mark as completed
            // (In Phase 5, this will poll SSE for real-time progress)
            if (result.taskId) {
                // For now, simulate a brief wait then mark completed
                await new Promise((r) => setTimeout(r, 1500))

                const nodeState: NodeExecutionState = {
                    status: 'completed',
                    progress: 100,
                    message: `Task submitted: ${result.taskId.slice(0, 8)}...`,
                    completedAt: new Date().toISOString(),
                }
                set((s) => ({
                    nodeExecutionStates: { ...s.nodeExecutionStates, [nodeId]: nodeState }
                }))
                doPersist({ _taskId: result.taskId, _async: true }, nodeState)
                return
            }

            // Mock fallback — use initialOutput or generate placeholder
            const initialOutput = data?.initialOutput || null
            let generatedOutputs: Record<string, unknown> = initialOutput || {}

            if (!initialOutput) {
                if (nodeType === 'image-generate') {
                    generatedOutputs = { image: 'https://images.unsplash.com/photo-1541562232579-512a21360020' }
                } else if (nodeType === 'video-generate') {
                    generatedOutputs = { video: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4' }
                } else if (nodeType === 'text-input') {
                    generatedOutputs = { text: config?.content || '' }
                }
            }

            const nodeState: NodeExecutionState = {
                status: 'completed',
                progress: 100,
                message: result.message || 'Done (mock)',
                completedAt: new Date().toISOString(),
                outputs: generatedOutputs
            }
            set((s) => ({
                nodeOutputs: { ...s.nodeOutputs, [nodeId]: generatedOutputs },
                nodeExecutionStates: { ...s.nodeExecutionStates, [nodeId]: nodeState }
            }))
            doPersist(generatedOutputs, nodeState)
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'Unknown error'
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
        }
    },

    // ── Execute full workflow in topological order (with resume) ──
    executeWorkflow: async () => {
        const { nodes, edges, persistedOutputs } = get()
        const execOrder = topologicalSort(nodes, edges)

        // Track which nodes were freshly executed (not skipped) — used to invalidate downstream
        const freshlyExecuted = new Set<string>()

        // Don't wipe outputs — preserve persisted ones for resume
        set({ executionStatus: 'running' })

        // Mark all as pending initially
        const pendingStates: Record<string, NodeExecutionState> = {}
        for (const nodeId of execOrder) {
            pendingStates[nodeId] = { status: 'pending', progress: 0 }
        }
        set({ nodeExecutionStates: pendingStates })

        // Execute each node in topological order
        for (const nodeId of execOrder) {
            if (get().executionStatus !== 'running') break

            const node = nodes.find(n => n.id === nodeId)
            const nodeData = node?.data as any
            const config = nodeData?.config || {}

            // ── Resume logic: check if node can be skipped ──
            const persisted = persistedOutputs?.[nodeId]
            if (persisted && persisted.outputs && Object.keys(persisted.outputs).length > 0) {
                // Check config staleness
                const currentSnap = configSnapshot(config)
                const isConfigFresh = persisted.configSnapshot === currentSnap

                // Check if all upstream nodes were skipped (not freshly executed)
                const upstreamEdges = edges.filter(e => e.target === nodeId)
                const allUpstreamSkipped = upstreamEdges.every(e => !freshlyExecuted.has(e.source))

                if (isConfigFresh && allUpstreamSkipped) {
                    // Skip — reuse persisted output
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

            // ── Execute node ──
            freshlyExecuted.add(nodeId)
            await get().executeSingleNode(nodeId)
            const state = get().nodeExecutionStates[nodeId]
            if (state?.status === 'failed') {
                set({ executionStatus: 'failed' })
                // Update execution status in DB
                const workflowId = get().meta?.id
                const execId = get().currentExecutionId
                if (workflowId && execId) {
                    updateExecutionStatus(workflowId, execId, 'failed').catch(() => {})
                }
                return
            }
        }

        set({ executionStatus: 'completed' })

        // Update execution status in DB
        const workflowId = get().meta?.id
        const execId = get().currentExecutionId
        if (workflowId && execId) {
            updateExecutionStatus(workflowId, execId, 'completed').catch(() => {})
        }
    },

    // ── Force re-run a single node (clear persisted output first) ──
    forceRerunNode: async (nodeId: string) => {
        // Clear this node's persisted output from local state
        set((s) => {
            const updated = { ...s.persistedOutputs }
            delete updated[nodeId]
            return { persistedOutputs: updated }
        })
        await get().executeSingleNode(nodeId)
    },

    // ── Force re-run entire workflow (clear all persisted outputs) ──
    forceRerunAll: async () => {
        set({ persistedOutputs: null, nodeOutputs: {}, nodeExecutionStates: {}, currentExecutionId: null })
        await get().executeWorkflow()
    },

    // ── Serialization ──
    toJSON: () => {
        const { nodes, edges } = get()
        return { nodes, edges }
    },

    loadFromJSON: (data) => {
        // Pre-populate nodeOutputs from nodes that have initialOutput (e.g., Characters/Locations from workspace)
        const preloadedOutputs: Record<string, Record<string, unknown>> = {}
        for (const node of data.nodes) {
            const nd = node.data as any
            if (nd?.initialOutput && typeof nd.initialOutput === 'object') {
                preloadedOutputs[node.id] = nd.initialOutput
            }
        }
        set({ nodes: data.nodes, edges: data.edges, nodeOutputs: preloadedOutputs })
        set((s) => ({ meta: { ...s.meta, isSaved: true } }))
    },

    clear: () => {
        set({ nodes: [], edges: [], selectedNodeId: null, currentExecutionId: null, persistedOutputs: null })
        set((s) => ({ meta: { ...s.meta, isSaved: false } }))
    },
}))
