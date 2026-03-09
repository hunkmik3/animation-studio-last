/* eslint-disable */
// =============================================
// Workflow Toolbar — Top bar with actions
// Connected to real API for save/load/execute
// =============================================
'use client'

import { useCallback, useState } from 'react'
import { useWorkflowStore } from '../useWorkflowStore'
import { useSearchParams } from 'next/navigation'
import {
    createWorkflow,
    updateWorkflow,
    executeWorkflow as executeWorkflowAPI,
    pushWorkflowToProject,
} from '../api'
import {
    Save, Play, Trash2, Download, Upload,
    Zap, LayoutTemplate, Workflow,
    CheckCircle2, AlertCircle, UploadCloud
} from 'lucide-react'

// Pre-built classic pipeline template
const CLASSIC_PIPELINE_TEMPLATE = {
    nodes: [
        { id: 'n1', type: 'workflowNode', position: { x: 50, y: 250 }, data: { nodeType: 'text-input', label: 'Novel / Script', config: { content: '' } } },
        { id: 'n2', type: 'workflowNode', position: { x: 350, y: 100 }, data: { nodeType: 'character-extract', label: 'Extract Characters', config: { prompt: 'Analyze the following text and extract all characters with their name, age, gender, appearance, and personality.\n\nText:\n{input}', model: '', maxCharacters: 20 } } },
        { id: 'n3', type: 'workflowNode', position: { x: 350, y: 400 }, data: { nodeType: 'scene-extract', label: 'Extract Scenes', config: { prompt: 'Analyze the following text and extract all scenes/locations with name, description, atmosphere.\n\nText:\n{input}', model: '' } } },
        { id: 'n4', type: 'workflowNode', position: { x: 700, y: 250 }, data: { nodeType: 'storyboard', label: 'Storyboard', config: { prompt: 'Create a storyboard from the script with panel descriptions, shot types, and camera moves.\n\nScript: {input}\nCharacters: {characters}\nScenes: {scenes}', model: '', panelCount: 10, style: 'anime' } } },
        { id: 'n5', type: 'workflowNode', position: { x: 1050, y: 150 }, data: { nodeType: 'image-generate', label: 'Generate Images', config: { provider: 'flux', model: '', negativePrompt: '', aspectRatio: '16:9', resolution: '2K' } } },
        { id: 'n6', type: 'workflowNode', position: { x: 1050, y: 400 }, data: { nodeType: 'voice-synthesis', label: 'Voice Over', config: { provider: 'cosyvoice', voice: '', speed: 1.0 } } },
        { id: 'n7', type: 'workflowNode', position: { x: 1400, y: 250 }, data: { nodeType: 'video-generate', label: 'Generate Video', config: { provider: 'kling', model: '', duration: 5, aspectRatio: '16:9' } } },
        { id: 'n8', type: 'workflowNode', position: { x: 1750, y: 250 }, data: { nodeType: 'output', label: 'Final Output', config: { label: 'Anime Video', autoDownload: false } } },
    ],
    edges: [
        { id: 'e1', source: 'n1', sourceHandle: 'text', target: 'n2', targetHandle: 'text', animated: true, style: { strokeWidth: 2 } },
        { id: 'e2', source: 'n1', sourceHandle: 'text', target: 'n3', targetHandle: 'text', animated: true, style: { strokeWidth: 2 } },
        { id: 'e3', source: 'n1', sourceHandle: 'text', target: 'n4', targetHandle: 'text', animated: true, style: { strokeWidth: 2 } },
        { id: 'e4', source: 'n2', sourceHandle: 'characters', target: 'n4', targetHandle: 'characters', animated: true, style: { strokeWidth: 2 } },
        { id: 'e5', source: 'n3', sourceHandle: 'scenes', target: 'n4', targetHandle: 'scenes', animated: true, style: { strokeWidth: 2 } },
        { id: 'e6', source: 'n4', sourceHandle: 'panels', target: 'n5', targetHandle: 'prompt', animated: true, style: { strokeWidth: 2 } },
        { id: 'e7', source: 'n4', sourceHandle: 'panels', target: 'n6', targetHandle: 'text', animated: true, style: { strokeWidth: 2 } },
        { id: 'e8', source: 'n5', sourceHandle: 'image', target: 'n7', targetHandle: 'image', animated: true, style: { strokeWidth: 2 } },
        { id: 'e9', source: 'n7', sourceHandle: 'video', target: 'n8', targetHandle: 'content', animated: true, style: { strokeWidth: 2 } },
    ],
}

export function WorkflowToolbar() {
    const meta = useWorkflowStore((s) => s.meta)
    const setMeta = useWorkflowStore((s) => s.setMeta)
    const clear = useWorkflowStore((s) => s.clear)
    const loadFromJSON = useWorkflowStore((s) => s.loadFromJSON)
    const toJSON = useWorkflowStore((s) => s.toJSON)
    const executionStatus = useWorkflowStore((s) => s.executionStatus)
    const setExecutionStatus = useWorkflowStore((s) => s.setExecutionStatus)
    const resetExecution = useWorkflowStore((s) => s.resetExecution)
    const nodes = useWorkflowStore((s) => s.nodes)
    const setNodeExecutionState = useWorkflowStore((s) => s.setNodeExecutionState)
    const [showTemplates, setShowTemplates] = useState(false)
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
    const searchParams = useSearchParams()
    const projectId = searchParams?.get('projectId')

    const showToast = useCallback((message: string, type: 'success' | 'error') => {
        setToast({ message, type })
        setTimeout(() => setToast(null), 3000)
    }, [])

    // ── Save to Database ──
    const handleSaveToDB = useCallback(async () => {
        if (nodes.length === 0) return
        setSaveStatus('saving')
        try {
            const data = toJSON()
            if (meta.id) {
                // Update existing
                await updateWorkflow(meta.id, {
                    name: meta.name,
                    description: meta.description,
                    graphData: data,
                })
            } else {
                // Create new
                const result = await createWorkflow({
                    name: meta.name,
                    graphData: data,
                })
                setMeta({ id: result.workflow.id })
            }
            setMeta({ isSaved: true })
            setSaveStatus('saved')
            showToast('Workflow saved to database!', 'success')
            setTimeout(() => setSaveStatus('idle'), 2000)
        } catch {
            setSaveStatus('error')
            showToast('Failed to save workflow', 'error')
            setTimeout(() => setSaveStatus('idle'), 2000)
        }
    }, [nodes, toJSON, meta, setMeta, showToast])

    // ── Export as JSON file ──
    const handleExportJSON = useCallback(() => {
        const data = toJSON()
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${meta.name.replace(/\s+/g, '_')}.json`
        a.click()
        URL.revokeObjectURL(url)
    }, [toJSON, meta.name])

    // ── Import from JSON file ──
    const handleImportJSON = useCallback(() => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json'
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target?.result as string)
                    loadFromJSON(data)
                    setMeta({ name: file.name.replace('.json', ''), isSaved: false, id: null })
                    showToast('Workflow loaded from file!', 'success')
                } catch {
                    showToast('Invalid workflow file', 'error')
                }
            }
            reader.readAsText(file)
        }
        input.click()
    }, [loadFromJSON, setMeta, showToast])

    // ── Execute via API ──
    const handleRun = useCallback(async () => {
        if (nodes.length === 0) return
        resetExecution()
        setExecutionStatus('running')

        // Mark all nodes as pending
        for (const node of nodes) {
            setNodeExecutionState(node.id, { status: 'pending', progress: 0 })
        }

        // If saved to DB, execute via API
        if (meta.id) {
            try {
                const result = await executeWorkflowAPI(meta.id)
                // Apply result states
                for (const [nodeId, state] of Object.entries(result.execution.nodeStates)) {
                    setNodeExecutionState(nodeId, state)
                }
                setExecutionStatus(result.execution.status as 'completed' | 'failed')
                showToast(
                    result.execution.status === 'completed'
                        ? '✅ Workflow executed successfully!'
                        : '⚠️ Workflow completed with errors',
                    result.execution.status === 'completed' ? 'success' : 'error',
                )
            } catch {
                setExecutionStatus('failed')
                showToast('Execution failed', 'error')
            }
        } else {
            // Not saved — run local simulation
            for (const node of nodes) {
                setNodeExecutionState(node.id, { status: 'running', progress: 0, message: 'Processing...' })
                await new Promise((r) => setTimeout(r, 200))
                for (let p = 0; p <= 100; p += 25) {
                    setNodeExecutionState(node.id, { status: 'running', progress: p, message: `Step ${p}%...` })
                    await new Promise((r) => setTimeout(r, 100))
                }
                setNodeExecutionState(node.id, { status: 'completed', progress: 100, message: 'Done', completedAt: new Date().toISOString() })
            }
            setExecutionStatus('completed')
            showToast('✅ Simulation complete! Save workflow to run with real AI.', 'success')
        }
    }, [nodes, meta.id, resetExecution, setExecutionStatus, setNodeExecutionState, showToast])

    const handleLoadTemplate = useCallback(() => {
        loadFromJSON(CLASSIC_PIPELINE_TEMPLATE)
        setMeta({ name: 'Classic Anime Pipeline', isSaved: false, id: null })
        setShowTemplates(false)
    }, [loadFromJSON, setMeta])

    const handleSyncProject = useCallback(async () => {
        if (!projectId) {
            showToast('No Project ID provided to sync from', 'error')
            return
        }
        try {
            showToast('Syncing project data...', 'success')
            const res = await fetch(`/api/workflows/sync-project?projectId=${projectId}`)
            if (!res.ok) throw new Error('Failed to fetch project data')
            const data = await res.json()
            if (data.graphData) {
                loadFromJSON(data.graphData)
                setMeta({ name: `${data.projectName} Sync`, isSaved: false, id: null })
                showToast('Successfully synced project workflow!', 'success')
            }
        } catch (err: any) {
            console.error(err)
            showToast('Failed to sync project data', 'error')
        }
    }, [projectId, loadFromJSON, setMeta, showToast])

    const handlePushToProject = useCallback(async () => {
        if (!projectId) {
            showToast('No Project ID provided to push to', 'error')
            return
        }
        try {
            showToast('Pushing updates to workspace...', 'success')
            const res = await pushWorkflowToProject(projectId, nodes)
            if (res.success) {
                showToast(`Successfully updated ${res.updatedCount || 0} panels in workspace!`, 'success')
            } else {
                showToast(res.message || 'No updates required', 'success')
            }
        } catch (err: any) {
            console.error(err)
            showToast('Failed to push to workspace', 'error')
        }
    }, [projectId, nodes, showToast])

    return (
        <>
            <div
                className="flex items-center justify-between px-4 py-2"
                style={{ background: '#0f172a', borderBottom: '1px solid #1e293b' }}
            >
                {/* Left — workflow name */}
                <div className="flex items-center gap-3">
                    <Workflow className="w-5 h-5 text-blue-400" />
                    <input
                        type="text"
                        value={meta.name}
                        onChange={(e) => setMeta({ name: e.target.value })}
                        className="bg-transparent text-sm font-semibold text-slate-200 border-none outline-none focus:bg-slate-800 px-2 py-1 rounded transition-colors"
                    />
                    {!meta.isSaved && (
                        <span className="text-[10px] text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                            Unsaved
                        </span>
                    )}
                    {meta.id && (
                        <span className="text-[10px] text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                            Synced
                        </span>
                    )}
                </div>

                {/* Right — actions */}
                <div className="flex items-center gap-1.5">
                    {/* Sync Project Data & Push */}
                    {projectId && (
                        <div className="flex items-center gap-1.5 px-1">
                            <button
                                onClick={handleSyncProject}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 transition-colors border border-indigo-500/30"
                                title="Pull workflow from current project storyboard"
                            >
                                <Zap className="w-3.5 h-3.5" />
                                Pull from Workspace
                            </button>
                            <button
                                onClick={handlePushToProject}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 transition-colors border border-emerald-500/30"
                                title="Push prompt edits back to project storyboard"
                            >
                                <UploadCloud className="w-3.5 h-3.5" />
                                Push to Workspace
                            </button>
                            <div className="w-px h-6 bg-slate-700 mx-1" />
                        </div>
                    )}

                    {/* Templates */}
                    <div className="relative">
                        <button
                            onClick={() => setShowTemplates(!showTemplates)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                        >
                            <LayoutTemplate className="w-3.5 h-3.5" />
                            Templates
                        </button>
                        {showTemplates && (
                            <div className="absolute right-0 top-full mt-1 w-56 rounded-lg overflow-hidden shadow-xl z-50" style={{ background: '#1e293b', border: '1px solid #334155' }}>
                                <button
                                    onClick={handleLoadTemplate}
                                    className="w-full text-left px-4 py-3 text-xs text-slate-300 hover:bg-slate-700/50 transition-colors"
                                >
                                    <div className="font-medium text-slate-200">🎬 Classic Anime Pipeline</div>
                                    <div className="text-[10px] text-slate-500 mt-0.5">Novel → Characters → Storyboard → Image → Video</div>
                                </button>
                                <button
                                    onClick={() => { clear(); setShowTemplates(false); }}
                                    className="w-full text-left px-4 py-3 text-xs text-slate-300 hover:bg-slate-700/50 transition-colors border-t border-slate-700"
                                >
                                    <div className="font-medium text-slate-200">📝 Blank Canvas</div>
                                    <div className="text-[10px] text-slate-500 mt-0.5">Start from scratch</div>
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="w-px h-6 bg-slate-700 mx-1" />

                    {/* File operations */}
                    <button
                        onClick={handleImportJSON}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                        title="Import from JSON"
                    >
                        <Upload className="w-3.5 h-3.5" />
                        Import
                    </button>

                    <button
                        onClick={handleExportJSON}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                        title="Export as JSON"
                    >
                        <Download className="w-3.5 h-3.5" />
                        Export
                    </button>

                    <div className="w-px h-6 bg-slate-700 mx-1" />

                    {/* Database operations */}
                    <button
                        onClick={handleSaveToDB}
                        disabled={saveStatus === 'saving' || nodes.length === 0}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${saveStatus === 'saved'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : saveStatus === 'error'
                                ? 'bg-red-500/20 text-red-300'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                            }`}
                        title="Save to database"
                    >
                        {saveStatus === 'saving' ? (
                            <><div className="w-3.5 h-3.5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" /> Saving...</>
                        ) : saveStatus === 'saved' ? (
                            <><CheckCircle2 className="w-3.5 h-3.5" /> Saved!</>
                        ) : (
                            <><Save className="w-3.5 h-3.5" /> Save</>
                        )}
                    </button>

                    <button
                        onClick={clear}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-red-900/30 text-slate-300 hover:text-red-300 transition-colors"
                        title="Clear canvas"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    <div className="w-px h-6 bg-slate-700 mx-1" />

                    {/* Run */}
                    <button
                        onClick={handleRun}
                        disabled={executionStatus === 'running' || nodes.length === 0}
                        className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg transition-all ${executionStatus === 'running'
                            ? 'bg-blue-500/20 text-blue-300 cursor-not-allowed'
                            : executionStatus === 'completed'
                                ? 'bg-emerald-500/20 text-emerald-300 hover:bg-gradient-to-r hover:from-blue-500 hover:to-purple-500 hover:text-white'
                                : 'bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white shadow-lg shadow-blue-500/20'
                            }`}
                    >
                        {executionStatus === 'running' ? (
                            <><Zap className="w-3.5 h-3.5 animate-pulse" /> Running...</>
                        ) : (
                            <><Play className="w-3.5 h-3.5" /> Run Workflow</>
                        )}
                    </button>
                </div>
            </div>

            {/* Toast notification */}
            {toast && (
                <div
                    className={`fixed top-4 right-4 z-[100] flex items-center gap-2 px-4 py-3 rounded-lg shadow-xl text-sm font-medium animate-slide-up ${toast.type === 'success'
                        ? 'bg-emerald-500/90 text-white'
                        : 'bg-red-500/90 text-white'
                        }`}
                >
                    {toast.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4" />
                    ) : (
                        <AlertCircle className="w-4 h-4" />
                    )}
                    {toast.message}
                </div>
            )}
        </>
    )
}
