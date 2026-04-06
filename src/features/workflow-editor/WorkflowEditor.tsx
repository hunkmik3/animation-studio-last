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
import { WorkflowOutputPanel } from './components/WorkflowOutputPanel'
import { WorkflowToolbar } from './components/WorkflowToolbar'
import { WorkflowList } from './components/WorkflowList'
import { fetchExecutionOutputs, fetchPanel, fetchVoiceLine, fetchWorkflow, persistNodeOutput } from './api'
import { useTaskTargetStateMap } from '@/lib/query/hooks/useTaskTargetStateMap'
import type { NodeExecutionState } from '@/lib/workflow-engine/types'
import {
    isUsableNodeOutput,
    normalizeMediaOutputsForNode,
    normalizeVoiceOutputsForNode,
    resolvePanelIdFromNode,
    resolveVoiceLineTargetFromNode,
    toNodeInitialOutput,
} from './execution-contract'

// Register custom node types
const nodeTypes = {
    workflowNode: WorkflowNode,
    workflowGroup: WorkflowGroupNode,
}

function toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

function configSnapshot(config: Record<string, unknown>): string {
    try { return JSON.stringify(config, Object.keys(config).sort()) }
    catch { return '' }
}

type WorkflowMonitoredTarget = {
    nodeId: string
    targetType: 'NovelPromotionPanel' | 'NovelPromotionVoiceLine'
    targetId: string
    panelId?: string
    lineId?: string
}

/**
 * 🛰️ Workflow Task Monitor
 * Listens for real-time task updates from the backend (SSE)
 * and syncs them to the node execution states in the store.
 */
function WorkflowTaskMonitor() {
    const nodes = useWorkflowStore((s) => s.nodes)
    const workflowId = useWorkflowStore((s) => s.meta.id)
    const projectId = useWorkflowStore((s) => s.meta.projectId)
    const executionStatus = useWorkflowStore((s) => s.executionStatus)
    const activeRunToken = useWorkflowStore((s) => s.activeRunToken)
    const pendingContinuation = useWorkflowStore((s) => s.pendingContinuation)
    const recoverableContinuation = useWorkflowStore((s) => s.recoverableContinuation)
    const continuationRecovery = useWorkflowStore((s) => s.continuationRecovery)
    const activeExecutionLeaseId = useWorkflowStore((s) => s.activeExecutionLeaseId)
    const currentExecutionId = useWorkflowStore((s) => s.currentExecutionId)
    const setCurrentExecutionId = useWorkflowStore((s) => s.setCurrentExecutionId)
    const upsertPersistedOutput = useWorkflowStore((s) => s.upsertPersistedOutput)
    const resumeWorkflowAfterAsync = useWorkflowStore((s) => s.resumeWorkflowAfterAsync)
    const failWorkflowRun = useWorkflowStore((s) => s.failWorkflowRun)
    const setContinuationRecovery = useWorkflowStore((s) => s.setContinuationRecovery)
    const invalidateRecoverableContinuation = useWorkflowStore((s) => s.invalidateRecoverableContinuation)
    const nodeExecutionStates = useWorkflowStore((s) => s.nodeExecutionStates)
    const nodeOutputs = useWorkflowStore((s) => s.nodeOutputs)
    const setNodeOutput = useWorkflowStore((s) => s.setNodeOutput)
    const setNodeExecutionState = useWorkflowStore((s) => s.setNodeExecutionState)
    const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
    const completionSyncingRef = useRef<Set<string>>(new Set())

    const monitoredTargets = useMemo<WorkflowMonitoredTarget[]>(() => {
        const monitored: WorkflowMonitoredTarget[] = []

        nodes.forEach((node) => {
            const nodeData = toRecord(node.data)
            const nodeType = typeof nodeData.nodeType === 'string' ? nodeData.nodeType : ''

            const panelId = resolvePanelIdFromNode(node.id, nodeData)
            if (panelId) {
                monitored.push({
                    nodeId: node.id,
                    targetType: 'NovelPromotionPanel',
                    targetId: panelId,
                    panelId,
                })
                return
            }

            if (nodeType === 'voice-synthesis') {
                const voiceTarget = resolveVoiceLineTargetFromNode(nodeData)
                if (!voiceTarget) return
                monitored.push({
                    nodeId: node.id,
                    targetType: 'NovelPromotionVoiceLine',
                    targetId: voiceTarget.lineId,
                    lineId: voiceTarget.lineId,
                })
            }
        })

        return monitored
    }, [nodes])

    const nodeById = useMemo(() => {
        const map = new Map<string, Record<string, unknown>>()
        nodes.forEach((node) => {
            map.set(node.id, toRecord(node.data))
        })
        return map
    }, [nodes])

    const targets = useMemo(
        () => monitoredTargets.map((target) => ({ targetType: target.targetType, targetId: target.targetId })),
        [monitoredTargets],
    )

    const { byKey } = useTaskTargetStateMap(projectId, targets)

    useEffect(() => {
        if (!projectId || monitoredTargets.length === 0) return

        monitoredTargets.forEach((target) => {
            const nodeData = nodeById.get(target.nodeId)
            if (!nodeData) return

            const taskState = byKey.get(`${target.targetType}:${target.targetId}`)
            if (!taskState) return

            const nodeType = typeof nodeData.nodeType === 'string' ? nodeData.nodeType : ''
            const currentState = nodeExecutionStates[target.nodeId]
            const outputCandidate = currentState?.outputs || nodeOutputs[target.nodeId]
            const hasUsableOutput = isUsableNodeOutput(nodeType, outputCandidate)
            const isPausedOnThisNode = pendingContinuation?.pausedNodeId === target.nodeId
                && pendingContinuation.runToken === activeRunToken
            const isRecoverableOnThisNode = recoverableContinuation?.pausedNodeId === target.nodeId
                && continuationRecovery.status !== 'stale'
            const isNodeActivelyWaiting = currentState?.status === 'running' || isPausedOnThisNode || isRecoverableOnThisNode

            if (taskState.phase === 'queued' || taskState.phase === 'processing') {
                if (!isNodeActivelyWaiting) return
                if ((currentState?.status === 'completed' || currentState?.status === 'skipped') && hasUsableOutput) {
                    return
                }
                if (isRecoverableOnThisNode && continuationRecovery.status !== 'waiting') {
                    setContinuationRecovery('waiting', 'Waiting for async task output to become available.')
                }

                const progress = taskState.progress ?? (taskState.phase === 'queued' ? 10 : 50)
                const message = taskState.stageLabel || (taskState.phase === 'queued' ? 'Queued...' : 'Processing...')

                if (!currentState || currentState.status !== 'running' || currentState.progress !== progress || currentState.message !== message) {
                    setNodeExecutionState(target.nodeId, {
                        status: 'running',
                        progress,
                        message,
                        startedAt: currentState?.startedAt || new Date().toISOString(),
                    })
                }
            }
            else if (taskState.phase === 'completed') {
                if (!isNodeActivelyWaiting && !(currentState?.status === 'completed' && hasUsableOutput)) return
                if (currentState?.status === 'completed' && hasUsableOutput) {
                    if (isPausedOnThisNode) {
                        void resumeWorkflowAfterAsync(target.nodeId)
                    } else if (isRecoverableOnThisNode && continuationRecovery.status !== 'ready') {
                        setContinuationRecovery('ready')
                    }
                    return
                }
                if (completionSyncingRef.current.has(target.nodeId)) return

                completionSyncingRef.current.add(target.nodeId)
                const completedTaskId = taskState.runningTaskId
                void (async () => {
                    try {
                        let outputs: Record<string, unknown> = {}
                        if (target.targetType === 'NovelPromotionPanel' && target.panelId) {
                            const { panel } = await fetchPanel(projectId, target.panelId)
                            outputs = normalizeMediaOutputsForNode(nodeType, {
                                imageUrl: panel.imageUrl,
                                videoUrl: panel.videoUrl,
                            })
                            // Fetch task result to get usedPrompt
                            if (completedTaskId) {
                                try {
                                    const taskRes = await fetch(`/api/tasks/${encodeURIComponent(completedTaskId)}`)
                                    if (taskRes.ok) {
                                        const taskData = await taskRes.json()
                                        const taskResult = toRecord(taskData?.task?.result)
                                        if (typeof taskResult.usedPrompt === 'string') {
                                            outputs.usedPrompt = taskResult.usedPrompt
                                        }
                                    }
                                } catch { /* non-critical: prompt display is optional */ }
                            }
                        } else if (target.targetType === 'NovelPromotionVoiceLine' && target.lineId) {
                            const { voiceLine } = await fetchVoiceLine(projectId, target.lineId)
                            outputs = normalizeVoiceOutputsForNode(nodeType, {
                                id: voiceLine.id,
                                audioUrl: voiceLine.audioUrl,
                                speaker: voiceLine.speaker,
                                content: voiceLine.content,
                                audioDuration: voiceLine.audioDuration,
                            })
                        }

                        if (!isUsableNodeOutput(nodeType, outputs)) {
                            const waitingMessage = nodeType === 'voice-synthesis'
                                ? 'Task completed, waiting for audio output...'
                                : 'Task completed, waiting for media output...'
                            setNodeExecutionState(target.nodeId, {
                                status: 'running',
                                progress: 95,
                                message: waitingMessage,
                                startedAt: currentState?.startedAt || new Date().toISOString(),
                            })
                            if (isRecoverableOnThisNode && continuationRecovery.status !== 'waiting') {
                                setContinuationRecovery('waiting', waitingMessage)
                            }
                            return
                        }

                        const previousOutputs = toRecord(nodeOutputs[target.nodeId])
                        const outputMetadataEntries = Object.fromEntries(
                            Object.entries(previousOutputs).filter(([key]) => key.startsWith('_')),
                        )
                        const mergedOutputs = {
                            ...outputMetadataEntries,
                            ...outputs,
                        }

                        const completedAt = new Date().toISOString()
                        const completedState: NodeExecutionState = {
                            status: 'completed',
                            progress: 100,
                            message: 'Done',
                            completedAt,
                            outputs: mergedOutputs,
                        }

                        setNodeOutput(target.nodeId, mergedOutputs)
                        setNodeExecutionState(target.nodeId, completedState)
                        updateNodeData(target.nodeId, {
                            initialOutput: toNodeInitialOutput(toRecord(nodeData.initialOutput), outputs),
                        })

                        if (!workflowId) return
                        const response = await persistNodeOutput(workflowId, {
                            executionId: currentExecutionId || undefined,
                            nodeId: target.nodeId,
                            outputs: mergedOutputs,
                            configSnapshot: configSnapshot(toRecord(nodeData.config)),
                            nodeState: completedState,
                            leaseId: activeExecutionLeaseId || undefined,
                        })
                        if (response?.executionId) {
                            setCurrentExecutionId(response.executionId)
                        }
                        upsertPersistedOutput(target.nodeId, {
                            outputs: mergedOutputs,
                            configSnapshot: configSnapshot(toRecord(nodeData.config)),
                            completedAt,
                        })
                        if (isPausedOnThisNode) {
                            await resumeWorkflowAfterAsync(target.nodeId)
                        } else if (isRecoverableOnThisNode && continuationRecovery.status !== 'ready') {
                            setContinuationRecovery('ready')
                        }
                    } catch (err) {
                        console.error('Failed to sync completed task output:', err)
                    } finally {
                        completionSyncingRef.current.delete(target.nodeId)
                    }
                })()
            }
            else if (taskState.phase === 'failed') {
                if (!isNodeActivelyWaiting) return
                const failedMessage = taskState.lastError?.message || 'Execution failed'
                if (currentState?.status === 'failed' && currentState.error === failedMessage) return

                const failedState: NodeExecutionState = {
                    status: 'failed',
                    progress: 0,
                    message: failedMessage,
                    error: failedMessage,
                }
                setNodeExecutionState(target.nodeId, failedState)
                if (!workflowId) return
                void persistNodeOutput(workflowId, {
                    executionId: currentExecutionId || undefined,
                    nodeId: target.nodeId,
                    nodeState: failedState,
                    leaseId: activeExecutionLeaseId || undefined,
                })
                if (executionStatus === 'running' && activeRunToken) {
                    void failWorkflowRun()
                } else if (isRecoverableOnThisNode) {
                    void invalidateRecoverableContinuation(failedMessage)
                }
            }
        });
    }, [
        activeRunToken,
        byKey,
        continuationRecovery.status,
        activeExecutionLeaseId,
        currentExecutionId,
        executionStatus,
        failWorkflowRun,
        invalidateRecoverableContinuation,
        nodeExecutionStates,
        nodeOutputs,
        nodeById,
        monitoredTargets,
        pendingContinuation,
        projectId,
        recoverableContinuation,
        resumeWorkflowAfterAsync,
        setCurrentExecutionId,
        setContinuationRecovery,
        setNodeExecutionState,
        setNodeOutput,
        updateNodeData,
        upsertPersistedOutput,
        workflowId,
    ])

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
    const hydrateFromExecution = useWorkflowStore((s) => s.hydrateFromExecution)

    const reactFlowWrapper = useRef<HTMLDivElement>(null)
    const reactFlowInstance = useRef<ReactFlowInstance | null>(null)
    const loadedRef = useRef<string | null>(null)

    // Sync projectId from URL to store for execution context
    useEffect(() => {
        if (projectIdFromUrl) {
            setMeta({ projectId: projectIdFromUrl })
        }
    }, [projectIdFromUrl, setMeta])

    // Load workflow from DB if ID in URL, then hydrate persisted outputs
    useEffect(() => {
        if (!workflowId || loadedRef.current === workflowId) return
        loadedRef.current = workflowId

        fetchWorkflow(workflowId)
            .then(async ({ workflow }) => {
                const graphData = JSON.parse(workflow.graphData)
                loadFromJSON(graphData)
                setMeta({
                    id: workflow.id,
                    name: workflow.name,
                    description: workflow.description || '',
                    isSaved: true,
                })

                // Hydrate persisted outputs from latest execution
                const execData = await fetchExecutionOutputs(workflowId)
                if (
                    execData
                    && (
                        Boolean(execData.outputData)
                        || Boolean(execData.nodeStates)
                        || Boolean(execData.continuation)
                        || Boolean(execData.continuityMemory)
                    )
                ) {
                    hydrateFromExecution(execData)
                }
            })
            .catch((err) => {
                console.error('Failed to load workflow:', err)
            })
    }, [workflowId, loadFromJSON, setMeta, hydrateFromExecution])

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

                <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                    <div className="flex-1 min-h-0 flex overflow-hidden">
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

                    {/* Bottom Output Panel */}
                    <WorkflowOutputPanel />
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
