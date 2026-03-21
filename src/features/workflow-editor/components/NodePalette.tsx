/* eslint-disable */
// @ts-nocheck
// Node Palette — Sidebar with draggable node types
// =============================================
'use client'

import { useState, useCallback, type DragEvent } from 'react'
import { NODE_TYPES_BY_CATEGORY, CATEGORY_LABELS, NODE_TYPE_REGISTRY } from '@/lib/workflow-engine/registry'
import { isNodeTypeExecutionSupported } from '@/lib/workflow-engine/execution-support'
import { getWorkflowBoundaryDescriptor } from '@/features/workflow-editor/workspace-boundary'
import {
    FileText, Bot, Users, MapPin, LayoutGrid, ImageIcon,
    Video, Mic, ZoomIn, Film, GitBranch, Download,
    ChevronDown, ChevronRight, Search,
} from 'lucide-react'

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    FileText, Bot, Users, MapPin, LayoutGrid, Image: ImageIcon,
    Video, Mic, ZoomIn, Film, GitBranch, Download,
}

export function NodePalette() {
    const [search, setSearch] = useState('')
    const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
        input: true, ai: true, media: true, transform: true, output: true,
    })

    const toggleCategory = useCallback((cat: string) => {
        setExpandedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }))
    }, [])

    const onDragStart = useCallback((e: DragEvent, nodeType: string) => {
        e.dataTransfer.setData('application/workflow-node-type', nodeType)
        e.dataTransfer.effectAllowed = 'move'
    }, [])

    const allNodeTypes = Object.values(NODE_TYPE_REGISTRY).filter((node) =>
        isNodeTypeExecutionSupported(node.type),
    )
    const filteredTypes = search
        ? allNodeTypes.filter(
            (n) =>
                n.title.toLowerCase().includes(search.toLowerCase()) ||
                n.description.toLowerCase().includes(search.toLowerCase()),
        )
        : null

    return (
        <div className="h-full flex flex-col" style={{ background: '#0f172a', borderRight: '1px solid #1e293b' }}>
            {/* Header */}
            <div className="p-3 border-b border-slate-800">
                <h3 className="text-sm font-semibold text-slate-200 mb-2">Node Library</h3>
                <p className="text-[10px] text-slate-500 mb-2">Launch-safe nodes only</p>
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search nodes..."
                        className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                </div>
            </div>

            {/* Node list */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {filteredTypes ? (
                    // Search results
                    filteredTypes.map((def) => {
                        const Icon = ICON_MAP[def.icon]
                        return (
                            <div
                                key={def.type}
                                draggable
                                onDragStart={(e) => onDragStart(e, def.type)}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-grab active:cursor-grabbing hover:bg-slate-800 transition-colors group"
                            >
                                {Icon && (
                                    <div
                                        className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                                        style={{ background: def.color + '22' }}
                                    >
                                        <Icon className="w-3.5 h-3.5" style={{ color: def.color }} />
                                    </div>
                                )}
                                <div className="min-w-0">
                                    <div className="text-xs font-medium text-slate-200 truncate">{def.title}</div>
                                    <div className="text-[10px] text-slate-500 truncate">{def.description}</div>
                                    <div className="mt-1">
                                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${getWorkflowBoundaryDescriptor(def.type).kind === 'workspace-linked'
                                            ? 'bg-amber-500/15 text-amber-300'
                                            : getWorkflowBoundaryDescriptor(def.type).kind === 'hybrid'
                                                ? 'bg-sky-500/15 text-sky-300'
                                                : 'bg-emerald-500/15 text-emerald-300'
                                            }`}>
                                            {getWorkflowBoundaryDescriptor(def.type).kind === 'workspace-linked'
                                                ? 'Workspace Context'
                                                : getWorkflowBoundaryDescriptor(def.type).kind === 'hybrid'
                                                    ? 'Hybrid'
                                                : 'Workflow Native'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )
                    })
                ) : (
                    // Category view
                    Object.entries(NODE_TYPES_BY_CATEGORY).map(([category, nodes]) => {
                        const launchReadyNodes = nodes.filter((node) => isNodeTypeExecutionSupported(node.type))
                        if (launchReadyNodes.length === 0) return null

                        return (
                        <div key={category}>
                            <button
                                onClick={() => toggleCategory(category)}
                                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider hover:text-slate-300 transition-colors"
                            >
                                {expandedCategories[category] ? (
                                    <ChevronDown className="w-3 h-3" />
                                ) : (
                                    <ChevronRight className="w-3 h-3" />
                                )}
                                {CATEGORY_LABELS[category] || category}
                            </button>

                            {expandedCategories[category] && (
                                <div className="space-y-0.5 ml-1">
                                    {launchReadyNodes.map((def) => {
                                        const Icon = ICON_MAP[def.icon]
                                        return (
                                            <div
                                                key={def.type}
                                                draggable
                                                onDragStart={(e) => onDragStart(e, def.type)}
                                                className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-grab active:cursor-grabbing hover:bg-slate-800/80 transition-colors group"
                                            >
                                                {Icon && (
                                                    <div
                                                        className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                                                        style={{ background: def.color + '22' }}
                                                    >
                                                        <Icon className="w-3 h-3" style={{ color: def.color }} />
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <div className="text-[11px] font-medium text-slate-300 truncate">{def.title}</div>
                                                    <div className="mt-0.5">
                                                        <span className={`text-[9px] px-1 py-0.5 rounded ${getWorkflowBoundaryDescriptor(def.type).kind === 'workspace-linked'
                                                            ? 'bg-amber-500/15 text-amber-300'
                                                            : getWorkflowBoundaryDescriptor(def.type).kind === 'hybrid'
                                                                ? 'bg-sky-500/15 text-sky-300'
                                                                : 'bg-emerald-500/15 text-emerald-300'
                                                            }`}>
                                                            {getWorkflowBoundaryDescriptor(def.type).kind === 'workspace-linked'
                                                                ? 'Workspace'
                                                                : getWorkflowBoundaryDescriptor(def.type).kind === 'hybrid'
                                                                    ? 'Hybrid'
                                                                : 'Native'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )})
                )}
            </div>

            {/* Footer hint */}
            <div className="p-3 border-t border-slate-800">
                <p className="text-[10px] text-slate-600 text-center">
                    Green: native • Blue: hybrid • Amber: workspace-only
                </p>
            </div>
        </div>
    )
}
