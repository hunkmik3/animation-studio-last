/* eslint-disable */
// @ts-nocheck
// Custom Workflow Node — React Flow Node Component
// Renders each node with ports, status, and branding
// =============================================
'use client'

import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { NODE_TYPE_REGISTRY } from '@/lib/workflow-engine/registry'
import { useWorkflowStore } from '../useWorkflowStore'
import {
    FileText, Bot, Users, MapPin, LayoutGrid, ImageIcon,
    Video, Mic, ZoomIn, Film, GitBranch, Download,
    Trash2, Loader2, CheckCircle2, XCircle, Clock, Play
} from 'lucide-react'
import type { ExecutionStatus } from '@/lib/workflow-engine/types'

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    FileText, Bot, Users, MapPin, LayoutGrid, Image: ImageIcon,
    Video, Mic, ZoomIn, Film, GitBranch, Download,
}

interface WorkflowNodeData {
    nodeType: string
    label: string
    config: Record<string, unknown>
    [key: string]: unknown
}

function StatusBadge({ status }: { status: ExecutionStatus }) {
    switch (status) {
        case 'running':
            return <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
        case 'completed':
            return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
        case 'failed':
            return <XCircle className="w-3.5 h-3.5 text-red-400" />
        case 'pending':
            return <Clock className="w-3.5 h-3.5 text-amber-400" />
        default:
            return null
    }
}

function WorkflowNodeComponent({ id, data, selected }: NodeProps) {
    const nodeData = data as WorkflowNodeData
    const { nodeType } = nodeData
    const def = NODE_TYPE_REGISTRY[nodeType]
    const selectNode = useWorkflowStore((s) => s.selectNode)
    const removeNode = useWorkflowStore((s) => s.removeNode)
    const executeSingleNode = useWorkflowStore((s) => s.executeSingleNode)
    const executionState = useWorkflowStore((s) => s.nodeExecutionStates[id])

    const handleClick = useCallback(() => {
        selectNode(id)
    }, [id, selectNode])

    const handleDelete = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        removeNode(id)
    }, [id, removeNode])

    const handleRunSingle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        executeSingleNode(id)
    }, [id, executeSingleNode])

    if (!def) return null

    const Icon = ICON_MAP[def.icon]
    const status = executionState?.status || 'idle'

    return (
        <div
            onClick={handleClick}
            className="relative group"
            style={{ minWidth: 220 }}
        >
            {/* Input Handles */}
            {def.inputs.map((input, i) => (
                <Handle
                    key={input.id}
                    type="target"
                    position={Position.Left}
                    id={input.id}
                    style={{
                        top: `${((i + 1) / (def.inputs.length + 1)) * 100}%`,
                        width: 12,
                        height: 12,
                        background: '#64748b',
                        border: '2px solid #1e293b',
                    }}
                    title={`${input.name} (${input.type})`}
                />
            ))}

            {/* Node body */}
            <div
                className={`
          rounded-xl overflow-hidden shadow-lg transition-all duration-200
          ${selected ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-[#0f172a]' : ''}
          ${status === 'running' ? 'ring-2 ring-blue-400/50 animate-pulse' : ''}
        `}
                style={{ background: '#1e293b', border: '1px solid #334155' }}
            >
                {/* Header */}
                <div
                    className="flex items-center gap-2 px-3 py-2"
                    style={{ background: def.color + '22', borderBottom: `2px solid ${def.color}` }}
                >
                    {Icon && <Icon className="w-4 h-4" style={{ color: def.color }} />}
                    <span className="text-xs font-semibold text-slate-200 flex-1 truncate">
                        {nodeData.label || def.title}
                    </span>
                    <StatusBadge status={status} />
                    <button
                        onClick={handleRunSingle}
                        disabled={status === 'running'}
                        className={`opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-emerald-500/20 ${status === 'running' ? 'cursor-not-allowed opacity-50' : ''}`}
                        title="Run this node"
                    >
                        <Play className="w-3 h-3 text-emerald-400" />
                    </button>
                    <button
                        onClick={handleDelete}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/20"
                        title="Delete node"
                    >
                        <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                </div>

                {/* Body - port labels */}
                <div className="px-3 py-2 space-y-1">
                    {/* Input labels */}
                    {def.inputs.map((input) => (
                        <div key={input.id} className="flex items-center gap-1.5 text-[10px] text-slate-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                            <span>{input.name}</span>
                            <span className="text-slate-600">({input.type})</span>
                        </div>
                    ))}

                    {def.inputs.length > 0 && def.outputs.length > 0 && (
                        <div className="border-t border-slate-700 my-1" />
                    )}

                    {/* Output labels */}
                    {def.outputs.map((output) => (
                        <div key={output.id} className="flex items-center justify-end gap-1.5 text-[10px] text-slate-400">
                            <span className="text-slate-600">({output.type})</span>
                            <span>{output.name}</span>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: def.color }} />
                        </div>
                    ))}

                    {/* Config preview */}
                    {nodeType === 'text-input' && nodeData.config?.content && (
                        <div className="mt-1 p-1.5 rounded bg-slate-800/50 text-[10px] text-slate-400 truncate max-w-[180px]" title={String(nodeData.config.content)}>
                            {String(nodeData.config.content).slice(0, 50)}...
                        </div>
                    )}

                    {nodeType === 'llm-prompt' && nodeData.config?.model && (
                        <div className="mt-1 p-1.5 rounded bg-slate-800/50 text-[10px] text-violet-400 truncate max-w-[180px]">
                            Model: {String(nodeData.config.model)}
                        </div>
                    )}

                    {nodeType === 'image-generate' && (
                        <div className="mt-1 p-1.5 rounded bg-slate-800/50 text-[9px] text-slate-400 flex flex-col gap-0.5 max-w-[180px]">
                            <span className="truncate text-blue-300">Provider: {String(nodeData.config?.provider || 'flux')}</span>
                            {nodeData.config?.model && <span className="truncate">Model: {String(nodeData.config.model)}</span>}
                            <div className="flex justify-between items-center text-slate-500 mt-0.5">
                                <span>{String(nodeData.config?.aspectRatio || '16:9')}</span>
                                <span>{String(nodeData.config?.resolution || '2K')}</span>
                            </div>
                        </div>
                    )}

                    {nodeType === 'video-generate' && (
                        <div className="mt-1 p-1.5 rounded bg-slate-800/50 text-[9px] text-slate-400 flex flex-col gap-0.5 max-w-[180px]">
                            <span className="truncate text-red-300">Provider: {String(nodeData.config?.provider || 'kling')}</span>
                            {nodeData.config?.model && <span className="truncate">Model: {String(nodeData.config.model)}</span>}
                            <div className="flex justify-between items-center text-slate-500 mt-0.5">
                                <span>{String(nodeData.config?.aspectRatio || '16:9')}</span>
                                <span>{String(nodeData.config?.duration || 5)}s</span>
                            </div>
                        </div>
                    )}

                    {/* Execution progress */}
                    {executionState && status === 'running' && (
                        <div className="mt-1">
                            <div className="w-full h-1 rounded-full bg-slate-700 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-blue-500 transition-all duration-300"
                                    style={{ width: `${executionState.progress}%` }}
                                />
                            </div>
                            {executionState.message && (
                                <div className="text-[9px] text-blue-400 mt-0.5 truncate">{executionState.message}</div>
                            )}
                        </div>
                    )}

                    {executionState && status === 'failed' && (
                        <div className="mt-1 p-1 rounded bg-red-500/10 text-[9px] text-red-400 truncate">
                            {executionState.error || 'Error'}
                        </div>
                    )}
                </div>
            </div>

            {/* Output Handles */}
            {def.outputs.map((output, i) => (
                <Handle
                    key={output.id}
                    type="source"
                    position={Position.Right}
                    id={output.id}
                    style={{
                        top: `${((i + 1) / (def.outputs.length + 1)) * 100}%`,
                        width: 12,
                        height: 12,
                        background: def.color,
                        border: '2px solid #1e293b',
                    }}
                    title={`${output.name} (${output.type})`}
                />
            ))}
        </div>
    )
}

export const WorkflowNode = memo(WorkflowNodeComponent)
