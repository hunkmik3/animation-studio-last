// =============================================
// Workflow Editor — Zustand Store
// Manages the full state of the node-based editor
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
    setExecutionStatus: (status: ExecutionStatus) => void
    setNodeExecutionState: (nodeId: string, state: NodeExecutionState) => void
    resetExecution: () => void
    executeSingleNode: (nodeId: string) => Promise<void>

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

    // ── Selection ──
    selectedNodeId: null,
    selectNode: (id) => set({ selectedNodeId: id }),

    // ── Execution ──
    executionStatus: 'idle',
    nodeExecutionStates: {},
    setExecutionStatus: (status) => set({ executionStatus: status }),
    setNodeExecutionState: (nodeId, state) =>
        set((s) => ({ nodeExecutionStates: { ...s.nodeExecutionStates, [nodeId]: state } })),
    resetExecution: () => set({ executionStatus: 'idle', nodeExecutionStates: {} }),
    executeSingleNode: async (nodeId: string) => {
        const node = get().nodes.find(n => n.id === nodeId)
        if (!node) return

        const data = node.data as any
        const nodeType = data?.nodeType
        const config = data?.config || {}

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

            // If the API returned outputs directly (text-input, mock results)
            if (result.outputs) {
                set((s) => ({
                    nodeExecutionStates: {
                        ...s.nodeExecutionStates,
                        [nodeId]: {
                            status: 'completed',
                            progress: 100,
                            message: 'Done',
                            completedAt: new Date().toISOString(),
                            outputs: result.outputs
                        }
                    }
                }))
                return
            }

            // If a real task was submitted, mark as completed
            // (In Phase 5, this will poll SSE for real-time progress)
            if (result.taskId) {
                // For now, simulate a brief wait then mark completed
                await new Promise((r) => setTimeout(r, 1500))

                set((s) => ({
                    nodeExecutionStates: {
                        ...s.nodeExecutionStates,
                        [nodeId]: {
                            status: 'completed',
                            progress: 100,
                            message: `Task submitted: ${result.taskId.slice(0, 8)}...`,
                            completedAt: new Date().toISOString(),
                        }
                    }
                }))
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

            set((s) => ({
                nodeExecutionStates: {
                    ...s.nodeExecutionStates,
                    [nodeId]: {
                        status: 'completed',
                        progress: 100,
                        message: result.message || 'Done (mock)',
                        completedAt: new Date().toISOString(),
                        outputs: generatedOutputs
                    }
                }
            }))
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

    // ── Serialization ──
    toJSON: () => {
        const { nodes, edges } = get()
        return { nodes, edges }
    },

    loadFromJSON: (data) => {
        set({ nodes: data.nodes, edges: data.edges })
        set((s) => ({ meta: { ...s.meta, isSaved: true } }))
    },

    clear: () => {
        set({ nodes: [], edges: [], selectedNodeId: null })
        set((s) => ({ meta: { ...s.meta, isSaved: false } }))
    },
}))
