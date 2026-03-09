/* eslint-disable */
// =============================================
// Workflow Editor — Main Canvas Component
// Combines React Flow canvas + Palette + Config
// Supports loading from DB via URL params
// =============================================
'use client'

import { useCallback, useRef, useEffect, useMemo, type DragEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    ReactFlowProvider,
    type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useWorkflowStore } from './useWorkflowStore'
import { WorkflowNode } from './components/WorkflowNode'
import { WorkflowGroupNode } from './components/WorkflowGroupNode'
import { NodePalette } from './components/NodePalette'
import { NodeConfigPanel } from './components/NodeConfigPanel'
import { WorkflowToolbar } from './components/WorkflowToolbar'
import { WorkflowList } from './components/WorkflowList'
import { fetchWorkflow } from './api'
import { useTaskTargetStateMap } from '@/lib/query/hooks/useTaskTargetStateMap'

// Register custom node types
const nodeTypes = {
    workflowNode: WorkflowNode,
    workflowGroup: WorkflowGroupNode,
}

/**
 * 🛰️ Workflow Task Monitor
 * Listens for real-time task updates from the backend (SSE)
 * and syncs them to the node execution states in the store.
 */
import { fetchPanel } from './api'

function WorkflowTaskMonitor() {
    const nodes = useWorkflowStore((s) => s.nodes)
    const projectId = useWorkflowStore((s) => s.meta.projectId)
    const nodeExecutionStates = useWorkflowStore((s) => s.nodeExecutionStates)
    const setNodeExecutionState = useWorkflowStore((s) => s.setNodeExecutionState)
    const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

    const targets = useMemo(() => {
        return nodes
            .map(n => {
                const data = n.data as any
                const panelId = data?.panelId || (n.id.startsWith('img_') || n.id.startsWith('vid_') ? n.id.replace(/^(img_|vid_)/, '') : null)
                if (panelId) {
                    return { targetType: 'NovelPromotionPanel', targetId: panelId }
                }
                return null
            })
            .filter(Boolean) as { targetType: string; targetId: string }[]
    }, [nodes])

    const { byKey } = useTaskTargetStateMap(projectId, targets)

    useEffect(() => {
        if (!projectId || targets.length === 0) return

        nodes.forEach(node => {
            const data = node.data as any
            const panelId = data?.panelId || (node.id.startsWith('img_') || node.id.startsWith('vid_') ? node.id.replace(/^(img_|vid_)/, '') : null)
            if (!panelId) return

            const taskState = byKey.get(`NovelPromotionPanel:${panelId}`)
            if (!taskState) return

            const currentState = nodeExecutionStates[node.id]

            if (taskState.phase === 'queued' || taskState.phase === 'processing') {
                const status = 'running'
                const progress = taskState.progress || 0
                const message = taskState.stageLabel || (taskState.phase === 'queued' ? 'Queued...' : 'Processing...')

                if (!currentState || currentState.status !== status || currentState.progress !== progress || currentState.message !== message) {
                    setNodeExecutionState(node.id, {
                        status: 'running',
                        progress,
                        message,
                    })
                }
            }
            else if (taskState.phase === 'completed' && currentState?.status === 'running') {
                setNodeExecutionState(node.id, {
                    status: 'completed',
                    progress: 100,
                    message: 'Done',
                    completedAt: new Date().toISOString(),
                })

                // Fetch updated panel data to show new image/video
                fetchPanel(projectId, panelId).then(({ panel }) => {
                    updateNodeData(node.id, {
                        initialOutput: {
                            imageUrl: panel.imageUrl,
                            videoUrl: panel.videoUrl
                        }
                    })
                }).catch(err => console.error('Failed to update node after task completion:', err))
            }
            else if (taskState.phase === 'failed' && currentState?.status === 'running') {
                setNodeExecutionState(node.id, {
                    status: 'failed',
                    progress: 0,
                    message: taskState.lastError?.message || 'Execution failed',
                    error: taskState.lastError?.message,
                })
            }
        });
    }, [byKey, nodes, projectId, nodeExecutionStates, setNodeExecutionState, updateNodeData, targets.length])

    return null
}

function WorkflowEditorInner() {
    const searchParams = useSearchParams()
    const workflowId = searchParams?.get('id')
    const projectIdFromUrl = searchParams?.get('projectId')

    const nodes = useWorkflowStore((s) => s.nodes)
    const edges = useWorkflowStore((s) => s.edges)
    const onNodesChange = useWorkflowStore((s) => s.onNodesChange)
    const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange)
    const onConnect = useWorkflowStore((s) => s.onConnect)
    const addNode = useWorkflowStore((s) => s.addNode)
    const selectNode = useWorkflowStore((s) => s.selectNode)
    const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
    const loadFromJSON = useWorkflowStore((s) => s.loadFromJSON)
    const setMeta = useWorkflowStore((s) => s.setMeta)

    const reactFlowWrapper = useRef<HTMLDivElement>(null)
    const reactFlowInstance = useRef<ReactFlowInstance | null>(null)
    const loadedRef = useRef<string | null>(null)

    // Sync projectId from URL to store for execution context
    useEffect(() => {
        if (projectIdFromUrl) {
            setMeta({ projectId: projectIdFromUrl })
        }
    }, [projectIdFromUrl, setMeta])

    // Load workflow from DB if ID in URL
    useEffect(() => {
        if (!workflowId || loadedRef.current === workflowId) return
        loadedRef.current = workflowId

        fetchWorkflow(workflowId)
            .then(({ workflow }) => {
                const graphData = JSON.parse(workflow.graphData)
                loadFromJSON(graphData)
                setMeta({
                    id: workflow.id,
                    name: workflow.name,
                    description: workflow.description || '',
                    isSaved: true,
                })
            })
            .catch((err) => {
                console.error('Failed to load workflow:', err)
            })
    }, [workflowId, loadFromJSON, setMeta])

    const onInit = useCallback((instance: ReactFlowInstance) => {
        reactFlowInstance.current = instance
    }, [])

    const onDragOver = useCallback((e: DragEvent) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
    }, [])

    const onDrop = useCallback(
        (e: DragEvent) => {
            e.preventDefault()
            const nodeType = e.dataTransfer.getData('application/workflow-node-type')
            if (!nodeType || !reactFlowInstance.current || !reactFlowWrapper.current) return

            const bounds = reactFlowWrapper.current.getBoundingClientRect()
            const position = reactFlowInstance.current.screenToFlowPosition({
                x: e.clientX - bounds.left,
                y: e.clientY - bounds.top,
            })

            addNode(nodeType, position)
        },
        [addNode],
    )

    const onPaneClick = useCallback(() => {
        selectNode(null)
    }, [selectNode])

    return (
        <div className="flex flex-col h-screen" style={{ background: '#0a0f1e' }}>
            {/* Real-time Task Monitor (Non-visual) */}
            <WorkflowTaskMonitor />

            {/* Toolbar */}
            <WorkflowToolbar />

            {/* Main content */}
            <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar — Node Palette + Saved Workflows */}
                <div className="w-60 flex-shrink-0 flex flex-col" style={{ background: '#0f172a', borderRight: '1px solid #1e293b' }}>
                    <div className="flex-1 overflow-hidden flex flex-col">
                        <div className="flex-1 overflow-y-auto">
                            <NodePalette />
                        </div>
                        <div className="border-t border-slate-800">
                            <details className="group">
                                <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer text-[11px] font-semibold text-slate-400 uppercase tracking-wider hover:text-slate-300">
                                    <svg className="w-3 h-3 transition-transform group-open:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                                    📁 Saved Workflows
                                </summary>
                                <div className="px-2 pb-2 max-h-48 overflow-y-auto">
                                    <WorkflowList />
                                </div>
                            </details>
                        </div>
                    </div>
                </div>

                {/* Canvas */}
                <div className="flex-1 relative" ref={reactFlowWrapper}>
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onInit={onInit}
                        onDrop={onDrop}
                        onDragOver={onDragOver}
                        onPaneClick={onPaneClick}
                        nodeTypes={nodeTypes}
                        fitView
                        snapToGrid
                        snapGrid={[16, 16]}
                        defaultEdgeOptions={{
                            animated: true,
                            style: { strokeWidth: 2, stroke: '#475569' },
                        }}
                        connectionLineStyle={{ strokeWidth: 2, stroke: '#6366f1' }}
                        style={{ background: '#0f172a' }}
                        proOptions={{ hideAttribution: true }}
                    >
                        <Background color="#1e293b" gap={24} size={1} />
                        <Controls
                            showInteractive={false}
                            style={{
                                background: '#1e293b',
                                border: '1px solid #334155',
                                borderRadius: '8px',
                            }}
                        />
                        <MiniMap
                            style={{
                                background: '#0f172a',
                                border: '1px solid #1e293b',
                                borderRadius: '8px',
                            }}
                            nodeColor={(n) => {
                                const data = n.data as { nodeType?: string }
                                if (!data?.nodeType) return '#334155'
                                const colors: Record<string, string> = {
                                    'text-input': '#6366f1',
                                    'llm-prompt': '#8b5cf6',
                                    'character-extract': '#ec4899',
                                    'scene-extract': '#14b8a6',
                                    'storyboard': '#f59e0b',
                                    'image-generate': '#3b82f6',
                                    'video-generate': '#ef4444',
                                    'voice-synthesis': '#a855f7',
                                    'upscale': '#06b6d4',
                                    'video-compose': '#f97316',
                                    'condition': '#84cc16',
                                    'output': '#10b981',
                                }
                                return colors[data.nodeType] || '#334155'
                            }}
                            maskColor="rgba(15, 23, 42, 0.7)"
                        />

                        {/* Empty state */}
                        {nodes.length === 0 && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="text-center">
                                    <div className="text-6xl mb-4">🎬</div>
                                    <h2 className="text-xl font-semibold text-slate-400 mb-2">Start Building Your Workflow</h2>
                                    <p className="text-sm text-slate-600 max-w-md">
                                        Drag nodes from the left palette onto the canvas, then connect them to create
                                        your custom AI anime production pipeline.
                                    </p>
                                    <p className="text-xs text-slate-700 mt-3">
                                        Or try a Template from the toolbar above ↑
                                    </p>
                                </div>
                            </div>
                        )}
                    </ReactFlow>
                </div>

                {/* Right Sidebar — Rich Detail Panel */}
                <div className={`transition-all duration-300 ${selectedNodeId ? 'w-96' : 'w-56'} flex-shrink-0`}>
                    <NodeConfigPanel />
                </div>
            </div>
        </div>
    )
}

export default function WorkflowEditor() {
    return (
        <ReactFlowProvider>
            <WorkflowEditorInner />
        </ReactFlowProvider>
    )
}
