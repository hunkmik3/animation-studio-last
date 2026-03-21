'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createWorkflow, deleteWorkflow, fetchWorkflows, type WorkflowListItem } from '@/features/workflow-editor/api'
import {
  ArrowRight,
  Clock3,
  FilePlus2,
  FolderOpen,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Workflow,
} from 'lucide-react'
import { buildWorkflowDashboardStats, filterWorkflows } from '@/features/workflow-editor/workflow-home-helpers'
import { BLANK_WORKFLOW_TEMPLATE, CLASSIC_PIPELINE_TEMPLATE, type WorkflowGraphTemplate } from '@/features/workflow-editor/workflow-templates'

interface CreateWorkflowPreset {
  key: 'blank' | 'classic'
  title: string
  description: string
  template: WorkflowGraphTemplate
}

const CREATE_WORKFLOW_PRESETS: CreateWorkflowPreset[] = [
  {
    key: 'classic',
    title: 'Create Story Pipeline',
    description: 'Start with the built-in story -> characters/scenes -> storyboard -> voice pipeline.',
    template: CLASSIC_PIPELINE_TEMPLATE,
  },
  {
    key: 'blank',
    title: 'Create Blank Workflow',
    description: 'Open a clean canvas and build every step exactly the way you want.',
    template: BLANK_WORKFLOW_TEMPLATE,
  },
]

function buildWorkflowDraftName(kind: CreateWorkflowPreset['key']): string {
  const timestamp = new Date().toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  if (kind === 'classic') return `Story Pipeline ${timestamp}`
  return `Untitled Workflow ${timestamp}`
}

function formatWorkflowDate(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getStatusBadgeClass(status: string): string {
  if (status === 'published') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
  if (status === 'archived') return 'bg-slate-600/20 text-slate-300 border-slate-500/20'
  return 'bg-amber-500/15 text-amber-300 border-amber-500/20'
}

function StatCard(props: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{props.label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{props.value}</div>
      <div className="mt-1 text-xs text-slate-400">{props.hint}</div>
    </div>
  )
}

function WorkflowCard(props: {
  workflow: WorkflowListItem
  onDelete: (workflow: WorkflowListItem) => Promise<void>
  deleting: boolean
}) {
  const href = `/workspace/workflow?id=${encodeURIComponent(props.workflow.id)}`

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 shadow-[0_20px_80px_rgba(15,23,42,0.35)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300">
              <Workflow className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <Link href={href} className="block truncate text-base font-semibold text-slate-100 hover:text-blue-300">
                {props.workflow.name}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className={`rounded-full border px-2 py-0.5 ${getStatusBadgeClass(props.workflow.status)}`}>
                  {props.workflow.status}
                </span>
                {props.workflow.isTemplate ? (
                  <span className="rounded-full border border-fuchsia-500/20 bg-fuchsia-500/15 px-2 py-0.5 text-fuchsia-200">
                    Template
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <p className="mt-4 line-clamp-2 min-h-[2.5rem] text-sm leading-6 text-slate-400">
            {props.workflow.description || 'No description yet. Open this workflow and document its intent when you are ready.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void props.onDelete(props.workflow)}
          disabled={props.deleting}
          className="rounded-xl border border-slate-800 bg-slate-950/70 p-2 text-slate-500 transition-colors hover:border-red-500/30 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Delete ${props.workflow.name}`}
        >
          {props.deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5" />
          Updated {formatWorkflowDate(props.workflow.updatedAt)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Layers3 className="h-3.5 w-3.5" />
          {props.workflow._count.executions} runs
        </span>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Link
          href={href}
          className="inline-flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-400"
        >
          Open in Editor
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  )
}

export default function WorkflowHome() {
  const router = useRouter()
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busyCreateKey, setBusyCreateKey] = useState<CreateWorkflowPreset['key'] | null>(null)
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null)

  const loadWorkflows = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const response = await fetchWorkflows(1, 100)
      setWorkflows(response.workflows)
    } catch (loadError) {
      const message = loadError instanceof Error && loadError.message.trim().length > 0
        ? loadError.message
        : 'Failed to load workflows.'
      setError(message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadWorkflows()
  }, [loadWorkflows])

  const filteredWorkflows = useMemo(
    () => filterWorkflows(workflows, searchQuery),
    [workflows, searchQuery],
  )
  const stats = useMemo(
    () => buildWorkflowDashboardStats(workflows),
    [workflows],
  )
  const templateWorkflows = useMemo(
    () => filteredWorkflows.filter((workflow) => workflow.isTemplate),
    [filteredWorkflows],
  )
  const savedWorkflows = useMemo(
    () => filteredWorkflows.filter((workflow) => !workflow.isTemplate),
    [filteredWorkflows],
  )

  const handleCreateWorkflow = useCallback(async (preset: CreateWorkflowPreset) => {
    setBusyCreateKey(preset.key)
    try {
      const result = await createWorkflow({
        name: buildWorkflowDraftName(preset.key),
        description: preset.description,
        graphData: preset.template,
      })
      router.push(`/workspace/workflow?id=${encodeURIComponent(result.workflow.id)}`)
    } catch (createError) {
      const message = createError instanceof Error && createError.message.trim().length > 0
        ? createError.message
        : 'Failed to create workflow.'
      setError(message)
    } finally {
      setBusyCreateKey(null)
    }
  }, [router])

  const handleDeleteWorkflow = useCallback(async (workflow: WorkflowListItem) => {
    const confirmed = window.confirm(`Delete workflow "${workflow.name}"?`)
    if (!confirmed) return

    setBusyDeleteId(workflow.id)
    try {
      await deleteWorkflow(workflow.id)
      setWorkflows((current) => current.filter((item) => item.id !== workflow.id))
    } catch (deleteError) {
      const message = deleteError instanceof Error && deleteError.message.trim().length > 0
        ? deleteError.message
        : 'Failed to delete workflow.'
      setError(message)
    } finally {
      setBusyDeleteId(null)
    }
  }, [])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.16),_transparent_32%),linear-gradient(180deg,#0a0f1e_0%,#0f172a_100%)] px-6 py-8 text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-blue-200">
              <Sparkles className="h-3.5 w-3.5" />
              Workflow Studio
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">Manage saved workflows from one place</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
              This is the workflow home page: create a new workflow, reopen saved drafts, or jump back into the editor with the pipeline you already built.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void loadWorkflows(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
            <Link
              href="/workspace"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800"
            >
              <FolderOpen className="h-4 w-4" />
              Workspace
            </Link>
            <Link
              href="/workspace/workflow?editor=1"
              className="inline-flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-400"
            >
              <Plus className="h-4 w-4" />
              Open Blank Editor
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Workflows" value={String(stats.total)} hint="All saved workflows in your account" />
          <StatCard label="Drafts" value={String(stats.drafts)} hint="Workflows still being shaped" />
          <StatCard label="Published" value={String(stats.published)} hint="Workflows marked ready" />
          <StatCard label="Templates" value={String(stats.templates)} hint="Reusable starter flows" />
          <StatCard label="Runs" value={String(stats.totalRuns)} hint="Total execution history across workflows" />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr,1.8fr]">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <FilePlus2 className="h-4 w-4 text-blue-300" />
              Create a new workflow
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Pick the starting point that matches how you want to work. Both options create a saved draft immediately so you can resume later.
            </p>

            <div className="mt-5 space-y-3">
              {CREATE_WORKFLOW_PRESETS.map((preset) => {
                const isBusy = busyCreateKey === preset.key
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => void handleCreateWorkflow(preset)}
                    disabled={busyCreateKey !== null}
                    className="flex w-full items-start justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-4 text-left transition-colors hover:border-blue-500/30 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-100">{preset.title}</div>
                      <div className="mt-1 text-xs leading-5 text-slate-400">{preset.description}</div>
                    </div>
                    {isBusy ? <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-blue-300" /> : <ArrowRight className="mt-0.5 h-4 w-4 text-slate-500" />}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-200">Saved workflows</div>
                <div className="mt-1 text-xs text-slate-400">Search, reopen, and manage every workflow draft you have saved.</div>
              </div>
              <label className="relative block min-w-[240px] max-w-sm flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search by workflow name, description, or status"
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 py-2.5 pl-10 pr-4 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-blue-500/50"
                />
              </label>
            </div>

            {error ? (
              <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            {loading ? (
              <div className="mt-8 flex items-center justify-center py-16 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <div className="mt-5 space-y-8">
                {templateWorkflows.length > 0 ? (
                  <section className="space-y-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Templates</div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      {templateWorkflows.map((workflow) => (
                        <WorkflowCard
                          key={workflow.id}
                          workflow={workflow}
                          deleting={busyDeleteId === workflow.id}
                          onDelete={handleDeleteWorkflow}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="space-y-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Your workflows</div>
                  {savedWorkflows.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-950/40 px-6 py-14 text-center">
                      <Workflow className="mx-auto h-12 w-12 text-slate-700" />
                      <div className="mt-4 text-base font-medium text-slate-200">No saved workflows match this view</div>
                      <div className="mt-2 text-sm text-slate-500">
                        Create a new workflow from the left, or clear the search box if you filtered too far.
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 lg:grid-cols-2">
                      {savedWorkflows.map((workflow) => (
                        <WorkflowCard
                          key={workflow.id}
                          workflow={workflow}
                          deleting={busyDeleteId === workflow.id}
                          onDelete={handleDeleteWorkflow}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
