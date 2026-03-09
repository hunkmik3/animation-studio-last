/* eslint-disable */
// @ts-nocheck
// Saved Workflows List — Browse & manage workflows
// =============================================
'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { fetchWorkflows, deleteWorkflow } from '../api'
import {
    Workflow, Plus, Trash2, Clock, Play, ChevronRight,
    FolderOpen, Loader2, AlertCircle,
} from 'lucide-react'

interface WorkflowItem {
    id: string
    name: string
    description: string | null
    isTemplate: boolean
    status: string
    createdAt: string
    updatedAt: string
    _count: { executions: number }
}

export function WorkflowList() {
    const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const loadWorkflows = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await fetchWorkflows()
            setWorkflows(data.workflows)
        } catch (err) {
            setError('Failed to load workflows')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        loadWorkflows()
    }, [loadWorkflows])

    const handleDelete = useCallback(async (id: string, name: string) => {
        if (!confirm(`Delete workflow "${name}"?`)) return
        try {
            await deleteWorkflow(id)
            setWorkflows((prev) => prev.filter((w) => w.id !== id))
        } catch {
            alert('Failed to delete workflow')
        }
    }, [])

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex items-center justify-center py-20 text-red-400 gap-2">
                <AlertCircle className="w-5 h-5" />
                <span className="text-sm">{error}</span>
            </div>
        )
    }

    return (
        <div className="space-y-3">
            {workflows.length === 0 ? (
                <div className="text-center py-12">
                    <FolderOpen className="w-12 h-12 text-slate-700 mx-auto mb-3" />
                    <p className="text-sm text-slate-500">No saved workflows yet</p>
                    <p className="text-xs text-slate-600 mt-1">Create and save a workflow to see it here</p>
                </div>
            ) : (
                workflows.map((w) => (
                    <div
                        key={w.id}
                        className="flex items-center gap-4 px-4 py-3 rounded-xl transition-colors hover:bg-slate-800/50"
                        style={{ border: '1px solid #1e293b' }}
                    >
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-blue-500/10">
                            <Workflow className="w-5 h-5 text-blue-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <Link
                                href={`/workspace/workflow?id=${w.id}`}
                                className="text-sm font-medium text-slate-200 hover:text-blue-400 transition-colors"
                            >
                                {w.name}
                            </Link>
                            <div className="flex items-center gap-3 mt-0.5">
                                <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {new Date(w.updatedAt).toLocaleDateString()}
                                </span>
                                <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                    <Play className="w-3 h-3" />
                                    {w._count.executions} runs
                                </span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${w.status === 'published'
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : 'bg-slate-700/50 text-slate-400'
                                    }`}>
                                    {w.status}
                                </span>
                            </div>
                        </div>
                        <button
                            onClick={() => handleDelete(w.id, w.name)}
                            className="p-2 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                        <Link
                            href={`/workspace/workflow?id=${w.id}`}
                            className="p-2 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </Link>
                    </div>
                ))
            )}
        </div>
    )
}
