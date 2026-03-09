import { memo, useCallback } from 'react'
import { Position, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronRight, LayoutGrid } from 'lucide-react'
import { useWorkflowStore } from '../useWorkflowStore'

function WorkflowGroupNodeComponent({ id, data, selected }: NodeProps) {
    const { label, isCollapsed, width, height } = data as { label?: string, isCollapsed?: boolean, width?: number, height?: number }
    const toggleGroupCollapse = useWorkflowStore(s => s.toggleGroupCollapse)

    const handleToggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        if (toggleGroupCollapse) toggleGroupCollapse(id)
    }, [id, toggleGroupCollapse])

    return (
        <div
            className={`
                relative rounded-xl overflow-hidden transition-all duration-300
                ${selected ? 'ring-2 ring-indigo-500' : 'ring-1 ring-slate-700/50'}
            `}
            style={{
                width: isCollapsed ? 280 : (width || 800),
                height: isCollapsed ? 50 : (height || 400),
                backgroundColor: 'rgba(30, 41, 59, 0.4)',
                backdropFilter: 'blur(8px)',
            }}
        >
            {/* Header / Draggable Title Bar */}
            <div
                className="absolute top-0 left-0 right-0 h-10 flex items-center justify-between px-3 cursor-grab active:cursor-grabbing border-b border-slate-700/50 bg-slate-800/80 z-10"
                onClick={handleToggle}
            >
                <div className="flex items-center gap-2 pointer-events-none">
                    <LayoutGrid className="w-4 h-4 text-indigo-400" />
                    <span className="text-sm font-semibold tracking-wide text-slate-200">
                        {label || 'Group'}
                    </span>
                </div>
                <button
                    className="p-1 hover:bg-slate-700 rounded transition-colors text-slate-400 hover:text-slate-200"
                    onClick={handleToggle}
                >
                    {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
            </div>

            {/* Content Area overlay when collapsed */}
            {isCollapsed && (
                <div className="absolute inset-0 top-10 flex items-center justify-center bg-slate-800/30 text-xs text-slate-500 font-medium">
                    Collapsed
                </div>
            )}
        </div>
    )
}

export const WorkflowGroupNode = memo(WorkflowGroupNodeComponent)
