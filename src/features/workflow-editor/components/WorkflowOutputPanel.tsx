'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react'
import type { Node } from '@xyflow/react'
import { NODE_TYPE_REGISTRY } from '@/lib/workflow-engine/registry'
import type { ExecutionStatus, NodeExecutionState } from '@/lib/workflow-engine/types'
import { useWorkflowStore } from '@/features/workflow-editor/useWorkflowStore'
import { AppIcon } from '@/components/ui/icons'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import {
  readNodeLabel,
  resolveMediaUrl,
  readNodeSummary,
  readNodeType,
  resolveNodeErrors,
  resolveNodeOutputs,
  resolveNodeWarnings,
  resolveOutputSourceTag,
  resolveParityInfo,
} from '@/features/workflow-editor/output-panel-helpers'
import {
  getWorkspaceContextActionHint,
  resolveWorkflowNodeContextIssue,
} from '@/features/workflow-editor/workspace-boundary'

type OutputPanelTab = 'output' | 'logs' | 'errors'

const PANEL_MIN_HEIGHT = 220
const PANEL_MAX_HEIGHT = 560
const PANEL_DEFAULT_HEIGHT = 300

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is Record<string, unknown> => {
    return Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
  })
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function formatDateTime(value: string | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function statusLabel(status: ExecutionStatus): string {
  if (status === 'idle') return 'Idle'
  if (status === 'pending') return 'Pending'
  if (status === 'running') return 'Running'
  if (status === 'completed') return 'Completed'
  if (status === 'failed') return 'Failed'
  return 'Skipped'
}

function StatusPill({ status }: { status: ExecutionStatus }) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2 py-0.5 text-[11px] font-medium text-blue-300">
        <AppIcon name="loader" className="h-3 w-3 animate-spin" />
        Running
      </span>
    )
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
        <AppIcon name="check" className="h-3 w-3" />
        Completed
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] font-medium text-red-300">
        <AppIcon name="alert" className="h-3 w-3" />
        Failed
      </span>
    )
  }
  if (status === 'skipped') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/20 px-2 py-0.5 text-[11px] font-medium text-cyan-300">
        <AppIcon name="arrowRight" className="h-3 w-3" />
        Skipped
      </span>
    )
  }
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-300">
        <AppIcon name="clock" className="h-3 w-3" />
        Pending
      </span>
    )
  }
  return <span className="inline-flex items-center rounded-full bg-slate-700 px-2 py-0.5 text-[11px] text-slate-300">Idle</span>
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-lg border border-slate-700 bg-slate-950/80 p-3 text-[11px] leading-relaxed text-slate-200">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function TextBlock({ title, content }: { title: string; content: string }) {
  return (
    <section className="space-y-1 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</h4>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{content}</p>
    </section>
  )
}

function CharactersView({ characters }: { characters: Record<string, unknown>[] }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-pink-300">Characters ({characters.length})</h4>
      <div className="grid gap-2 md:grid-cols-2">
        {characters.map((character, index) => {
          const name = asString(character.name) || `Character ${index + 1}`
          const appearance = asString(character.appearance)
          const introduction = asString(character.introduction)
          const roleLevel = asString(character.role_level)
          const archetype = asString(character.archetype)
          const age = asString(character.age_range || character.age)
          const gender = asString(character.gender)
          return (
            <article key={`${name}_${index}`} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
              <h5 className="text-sm font-semibold text-slate-100">{name}</h5>
              <p className="mt-1 text-xs text-slate-400">{[roleLevel, archetype, age, gender].filter(Boolean).join(' • ') || 'No profile metadata'}</p>
              {introduction && <p className="mt-2 text-xs text-slate-200">{introduction}</p>}
              {appearance && <p className="mt-1 text-xs text-slate-300">Appearance: {appearance}</p>}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function ScenesView({ scenes }: { scenes: Record<string, unknown>[] }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-teal-300">Scenes / Locations ({scenes.length})</h4>
      <div className="grid gap-2 md:grid-cols-2">
        {scenes.map((scene, index) => {
          const name = asString(scene.name) || `Scene ${index + 1}`
          const description = asString(scene.description)
          const atmosphere = asString(scene.atmosphere)
          const context = [asString(scene.time_of_day), asString(scene.interior_exterior)].filter(Boolean).join(' • ')
          return (
            <article key={`${name}_${index}`} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
              <h5 className="text-sm font-semibold text-slate-100">{name}</h5>
              {context && <p className="mt-1 text-xs text-slate-400">{context}</p>}
              {description && <p className="mt-2 text-xs text-slate-200">{description}</p>}
              {atmosphere && <p className="mt-1 text-xs text-slate-300">Atmosphere: {atmosphere}</p>}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function StoryboardView({ panels }: { panels: Record<string, unknown>[] }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">Storyboard Panels ({panels.length})</h4>
      <div className="space-y-2">
        {panels.map((panel, index) => {
          const panelNumber = asString(panel.panel_number) || String(index + 1)
          const description = asString(panel.description)
          const location = asString(panel.location)
          const shotType = asString(panel.shot_type || panel.shotType)
          const cameraMove = asString(panel.camera_move)
          return (
            <article key={`panel_${panelNumber}_${index}`} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
              <div className="flex items-center justify-between">
                <h5 className="text-sm font-semibold text-slate-100">Panel {panelNumber}</h5>
                <span className="text-[11px] text-slate-400">{[location, shotType].filter(Boolean).join(' • ') || 'No tags'}</span>
              </div>
              {description && <p className="mt-2 text-xs text-slate-200">{description}</p>}
              {cameraMove && <p className="mt-1 text-xs text-slate-300">Camera: {cameraMove}</p>}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function MediaView({
  imageUrl,
  videoUrl,
  audioUrl,
}: {
  imageUrl: string
  videoUrl: string
  audioUrl: string
}) {
  return (
    <div className="space-y-3">
      {imageUrl && (
        <section className="space-y-1 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-blue-300">Image Output</h4>
          <div className="relative h-72 w-full overflow-hidden rounded-md border border-slate-700 bg-slate-950/40">
            <MediaImageWithLoading
              src={imageUrl}
              alt="Workflow output"
              containerClassName="h-full w-full"
              className="h-full w-full object-contain"
              sizes="(max-width: 1200px) 100vw, 50vw"
            />
          </div>
          <p className="truncate text-[10px] text-slate-500">{imageUrl}</p>
        </section>
      )}

      {videoUrl && (
        <section className="space-y-1 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-red-300">Video Output</h4>
          <video src={videoUrl} controls className="max-h-72 w-full rounded-md border border-slate-700 bg-black" />
          <p className="truncate text-[10px] text-slate-500">{videoUrl}</p>
        </section>
      )}

      {audioUrl && (
        <section className="space-y-1 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
          <h4 className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-violet-300">
            <AppIcon name="audioWave" className="h-3 w-3" />
            Audio Output
          </h4>
          <audio src={audioUrl} controls className="w-full" />
          <p className="truncate text-[10px] text-slate-500">{audioUrl}</p>
        </section>
      )}
    </div>
  )
}

function OutputTabContent({
  nodeType,
  outputs,
  executionState,
  contextIssue,
  nodeLabel,
}: {
  nodeType: string
  outputs: Record<string, unknown>
  executionState: NodeExecutionState | null
  contextIssue: ReturnType<typeof resolveWorkflowNodeContextIssue> | null
  nodeLabel: string
}) {
  const summary = readNodeSummary(outputs)
  const resultText = asString(outputs.result)
  const markdownText = asString(outputs.text)
  const jsonOutput = outputs.json

  const imageUrl = resolveMediaUrl(outputs.image || outputs.imageUrl)
  const videoUrl = resolveMediaUrl(outputs.video || outputs.videoUrl)
  const audioUrl = resolveMediaUrl(outputs.audio || outputs.audioUrl)

  const characters = toRecordArray(outputs.characters)
  const scenes = toRecordArray(outputs.scenes).length > 0 ? toRecordArray(outputs.scenes) : toRecordArray(outputs.locations)
  const panels = toRecordArray(outputs.panels)

  const renderedSections: ReactElement[] = []

  if (summary) {
    renderedSections.push(<TextBlock key="summary" title="Summary" content={summary} />)
  }
  if (resultText) {
    renderedSections.push(<TextBlock key="result" title="Result" content={resultText} />)
  }
  if (markdownText && markdownText !== resultText) {
    renderedSections.push(<TextBlock key="text" title="Text" content={markdownText} />)
  }
  if (characters.length > 0) {
    renderedSections.push(<CharactersView key="characters" characters={characters} />)
  }
  if (scenes.length > 0) {
    renderedSections.push(<ScenesView key="scenes" scenes={scenes} />)
  }
  if (panels.length > 0) {
    renderedSections.push(<StoryboardView key="panels" panels={panels} />)
  }
  if (imageUrl || videoUrl || audioUrl) {
    renderedSections.push(
      <MediaView key="media" imageUrl={imageUrl} videoUrl={videoUrl} audioUrl={audioUrl} />,
    )
  }
  if (jsonOutput !== undefined && jsonOutput !== null) {
    renderedSections.push(
      <section key="json" className="space-y-1 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Structured JSON</h4>
        <JsonBlock value={jsonOutput} />
      </section>,
    )
  }

  const hasStructuredOutput = renderedSections.length > 0

  if (!hasStructuredOutput) {
    if (contextIssue) {
      return (
        <div className="space-y-3">
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            {`${nodeLabel} cannot run because ${contextIssue.missing.join(' + ')} is incomplete.`}
            <div className="mt-2 text-red-100">
              {getWorkspaceContextActionHint(nodeType)}
            </div>
          </div>
          <section className="space-y-1 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Raw Output Payload</h4>
            <JsonBlock value={outputs} />
          </section>
        </div>
      )
    }

    if (executionState?.status === 'running') {
      return (
        <div className="rounded-lg border border-blue-500/40 bg-blue-500/10 p-4 text-sm text-blue-200">
          Node đang chạy và đang chờ output thật từ execution pipeline. Khi output usable xuất hiện, panel sẽ tự cập nhật.
        </div>
      )
    }

    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300">
          Node này chưa có output usable.
        </div>
        <section className="space-y-1 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Raw Output Payload</h4>
          <JsonBlock value={outputs} />
        </section>
      </div>
    )
  }

  const showRawFallback = nodeType === 'llm-prompt' || Object.keys(outputs).some((key) => key.startsWith('_'))

  return (
    <div className="space-y-3">
      {renderedSections}
      {showRawFallback && (
        <section className="space-y-1 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Raw Output Payload</h4>
          <JsonBlock value={outputs} />
        </section>
      )}
    </div>
  )
}

function TabButton({
  active,
  label,
  onClick,
  attention,
}: {
  active: boolean
  label: string
  onClick: () => void
  attention?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-slate-700 text-slate-100'
          : attention
            ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25'
            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  )
}

function clampHeight(value: number): number {
  if (value < PANEL_MIN_HEIGHT) return PANEL_MIN_HEIGHT
  if (value > PANEL_MAX_HEIGHT) return PANEL_MAX_HEIGHT
  return value
}

export function WorkflowOutputPanel() {
  const nodes = useWorkflowStore((s) => s.nodes)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const executionStatus = useWorkflowStore((s) => s.executionStatus)
  const nodeExecutionStates = useWorkflowStore((s) => s.nodeExecutionStates)
  const nodeOutputs = useWorkflowStore((s) => s.nodeOutputs)

  const [open, setOpen] = useState(false)
  const [height, setHeight] = useState(PANEL_DEFAULT_HEIGHT)
  const [activeTab, setActiveTab] = useState<OutputPanelTab>('output')
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [recentNodeIds, setRecentNodeIds] = useState<string[]>([])

  const resizeStartHeightRef = useRef(PANEL_DEFAULT_HEIGHT)
  const resizeStartYRef = useRef(0)
  const resizingRef = useRef(false)
  const prevStatusRef = useRef<Record<string, ExecutionStatus>>({})

  const pushRecentNode = useCallback((nodeId: string) => {
    setRecentNodeIds((previous) => {
      const next = [nodeId, ...previous.filter((id) => id !== nodeId)]
      return next.slice(0, 8)
    })
  }, [])

  useEffect(() => {
    if (!selectedNodeId) return
    setFocusedNodeId(selectedNodeId)
    pushRecentNode(selectedNodeId)
    setOpen(true)
  }, [pushRecentNode, selectedNodeId])

  useEffect(() => {
    if (executionStatus === 'running') {
      setOpen(true)
    }
  }, [executionStatus])

  useEffect(() => {
    const nextStatusMap: Record<string, ExecutionStatus> = {}

    for (const [nodeId, state] of Object.entries(nodeExecutionStates)) {
      nextStatusMap[nodeId] = state.status
      const previousStatus = prevStatusRef.current[nodeId]
      if (previousStatus === state.status) continue
      if (state.status === 'idle' || state.status === 'pending') continue

      pushRecentNode(nodeId)
      setFocusedNodeId(nodeId)
      setOpen(true)

      if (state.status === 'failed') {
        setActiveTab('errors')
      } else if (state.status === 'completed' || state.status === 'skipped') {
        setActiveTab('output')
      } else if (state.status === 'running') {
        setActiveTab((current) => (current === 'errors' ? 'logs' : current))
      }
    }

    prevStatusRef.current = nextStatusMap
  }, [nodeExecutionStates, pushRecentNode])

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!resizingRef.current) return
      const delta = resizeStartYRef.current - event.clientY
      setHeight(clampHeight(resizeStartHeightRef.current + delta))
    }

    const stopResize = () => {
      if (!resizingRef.current) return
      resizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', stopResize)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', stopResize)
    }
  }, [])

  const nodeById = useMemo(() => {
    const map = new Map<string, Node>()
    for (const node of nodes) map.set(node.id, node)
    return map
  }, [nodes])

  const resolvedFocusNodeId = useMemo(() => {
    if (focusedNodeId && nodeById.has(focusedNodeId)) return focusedNodeId
    if (selectedNodeId && nodeById.has(selectedNodeId)) return selectedNodeId
    const firstRecent = recentNodeIds.find((nodeId) => nodeById.has(nodeId))
    if (firstRecent) return firstRecent
    const firstNode = nodes.find((node) => node.type !== 'workflowGroup' && !node.hidden)
    return firstNode?.id || null
  }, [focusedNodeId, nodeById, nodes, recentNodeIds, selectedNodeId])

  const focusedNode = resolvedFocusNodeId ? nodeById.get(resolvedFocusNodeId) || null : null
  const focusedExecutionState = resolvedFocusNodeId ? nodeExecutionStates[resolvedFocusNodeId] || null : null
  const focusedStoreOutput = resolvedFocusNodeId ? nodeOutputs[resolvedFocusNodeId] || null : null

  const resolvedOutput = resolveNodeOutputs({
    node: focusedNode,
    executionState: focusedExecutionState,
    nodeOutput: focusedStoreOutput,
  })
  const sourceTag = resolveOutputSourceTag({ executionState: focusedExecutionState, source: resolvedOutput.source })
  const parityInfo = resolveParityInfo({ node: focusedNode, outputs: resolvedOutput.outputs })
  const warnings = resolveNodeWarnings(resolvedOutput.outputs)
  const errors = resolveNodeErrors({ executionState: focusedExecutionState, outputs: resolvedOutput.outputs })

  const nodeType = readNodeType(focusedNode)
  const nodeLabel = readNodeLabel(focusedNode)
  const focusedContextIssue = focusedNode
    ? resolveWorkflowNodeContextIssue({
      nodeId: focusedNode.id,
      nodeType,
      nodeData: focusedNode.data as Record<string, unknown>,
      label: nodeLabel,
    })
    : null
  const nodeDefinition = nodeType ? NODE_TYPE_REGISTRY[nodeType] : null
  const nodeStatus = focusedExecutionState?.status || 'idle'

  const logs = useMemo(() => {
    if (!focusedNode) return []
    const entries: Array<{ type: 'info' | 'warn' | 'error'; text: string }> = []
    entries.push({
      type: 'info',
      text: `Status: ${statusLabel(nodeStatus)}${typeof focusedExecutionState?.progress === 'number' ? ` (${focusedExecutionState.progress}%)` : ''}`,
    })

    if (focusedExecutionState?.startedAt) {
      entries.push({ type: 'info', text: `Started: ${formatDateTime(focusedExecutionState.startedAt)}` })
    }
    if (focusedExecutionState?.completedAt) {
      entries.push({ type: 'info', text: `Completed: ${formatDateTime(focusedExecutionState.completedAt)}` })
    }
    if (focusedExecutionState?.message) {
      entries.push({ type: 'info', text: focusedExecutionState.message })
    }

    if (nodeStatus === 'running') {
      entries.push({ type: 'info', text: 'Node is waiting for real output from production lifecycle.' })
    }

    if (sourceTag === 'cached') {
      entries.push({ type: 'info', text: 'Output source: cache/resume.' })
    }
    if (sourceTag === 'initial') {
      entries.push({ type: 'info', text: 'Output source: initial node payload.' })
    }

    warnings.forEach((warning) => {
      entries.push({ type: 'warn', text: warning })
    })

    if (parityInfo.parityNotes) {
      entries.push({ type: 'warn', text: `Parity note: ${parityInfo.parityNotes}` })
    }
    if (focusedContextIssue) {
      entries.push({ type: 'error', text: focusedContextIssue.message })
      entries.push({ type: 'warn', text: getWorkspaceContextActionHint(nodeType) })
    }

    return entries
  }, [focusedContextIssue, focusedExecutionState, focusedNode, nodeStatus, nodeType, parityInfo.parityNotes, sourceTag, warnings])

  const startResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    resizingRef.current = true
    resizeStartYRef.current = event.clientY
    resizeStartHeightRef.current = height
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }, [height])

  const focusSelectedNode = useCallback(() => {
    if (!selectedNodeId || !nodeById.has(selectedNodeId)) return
    setFocusedNodeId(selectedNodeId)
    pushRecentNode(selectedNodeId)
    setOpen(true)
  }, [nodeById, pushRecentNode, selectedNodeId])

  if (!open) {
    return (
      <div className="flex h-11 items-center justify-between border-t border-slate-800 bg-slate-950/90 px-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
        >
          <AppIcon name="monitor" className="h-3.5 w-3.5" />
          Open Output Panel
        </button>
        <p className="text-xs text-slate-500">Chọn node để xem output, logs, errors.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col border-t border-slate-800 bg-slate-950/90" style={{ height }}>
      <div
        className="h-2 cursor-row-resize border-b border-slate-800 bg-slate-900/80"
        onMouseDown={startResize}
        title="Resize output panel"
      />

      <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <AppIcon name="monitor" className="h-4 w-4 text-sky-300" />
            <h3 className="truncate text-sm font-semibold text-slate-100">Bottom Output Panel</h3>
            <StatusPill status={nodeStatus} />
            {sourceTag === 'cached' && (
              <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[11px] text-cyan-300">Cached/Resumed</span>
            )}
            {parityInfo.temporaryImplementation && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">Temporary Impl</span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-slate-400">
            {focusedNode
              ? `${nodeLabel} • ${nodeType || 'unknown'}${nodeDefinition ? ` • ${nodeDefinition.title}` : ''}`
              : 'Chọn một node để xem output'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={focusSelectedNode}
            disabled={!selectedNodeId}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <AppIcon name="searchPlus" className="h-3.5 w-3.5" />
            Focus selected
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            <AppIcon name="chevronDown" className="h-3.5 w-3.5" />
            Collapse
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-64 flex-shrink-0 border-r border-slate-800 bg-slate-900/50 p-2">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Recent Nodes</h4>
            <button
              type="button"
              onClick={() => setFocusedNodeId(selectedNodeId)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              <AppIcon name="chevronUp" className="h-3 w-3" />
              Current
            </button>
          </div>

          <div className="space-y-1">
            {recentNodeIds.length === 0 && (
              <p className="rounded-md border border-dashed border-slate-700 p-2 text-xs text-slate-500">
                Chưa có node nào vừa chạy. Click node để focus output.
              </p>
            )}
            {recentNodeIds.map((nodeId) => {
              const node = nodeById.get(nodeId)
              if (!node) return null
              const nodeState = nodeExecutionStates[nodeId]
              const isActive = nodeId === resolvedFocusNodeId
              return (
                <button
                  key={nodeId}
                  type="button"
                  onClick={() => {
                    setFocusedNodeId(nodeId)
                    selectNode(nodeId)
                  }}
                  className={`w-full rounded-md border px-2 py-1.5 text-left transition-colors ${
                    isActive
                      ? 'border-blue-500/70 bg-blue-500/15 text-blue-100'
                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="truncate text-xs font-medium">{readNodeLabel(node)}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{nodeState ? statusLabel(nodeState.status) : 'Idle'}</div>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
            <TabButton active={activeTab === 'output'} label="Output" onClick={() => setActiveTab('output')} />
            <TabButton active={activeTab === 'logs'} label="Logs" onClick={() => setActiveTab('logs')} />
            <TabButton
              active={activeTab === 'errors'}
              label={`Errors${errors.length > 0 ? ` (${errors.length})` : ''}`}
              onClick={() => setActiveTab('errors')}
              attention={errors.length > 0}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
            {!focusedNode && (
              <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/50 p-6 text-center text-sm text-slate-400">
                Chọn một node để xem output.
              </div>
            )}

            {focusedNode && activeTab === 'output' && (
              <OutputTabContent
                nodeType={nodeType}
                outputs={resolvedOutput.outputs}
                executionState={focusedExecutionState}
                contextIssue={focusedContextIssue}
                nodeLabel={nodeLabel}
              />
            )}

            {focusedNode && activeTab === 'logs' && (
              <div className="space-y-2">
                {logs.length === 0 && (
                  <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-400">
                    No logs yet for this node.
                  </div>
                )}
                {logs.map((entry, index) => (
                  <div
                    key={`log_${index}`}
                    className={`rounded-md border px-3 py-2 text-sm ${
                      entry.type === 'error'
                        ? 'border-red-500/40 bg-red-500/10 text-red-200'
                        : entry.type === 'warn'
                          ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                          : 'border-slate-700 bg-slate-900/60 text-slate-200'
                    }`}
                  >
                    {entry.text}
                  </div>
                ))}
              </div>
            )}

            {focusedNode && activeTab === 'errors' && (
              <div className="space-y-2">
                {errors.length === 0 && !focusedContextIssue ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                    Không có lỗi nào cho node này.
                  </div>
                ) : (
                  <>
                  {focusedContextIssue && (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                      <div className="mb-1 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide">
                        <AppIcon name="alert" className="h-3.5 w-3.5" />
                        Missing Workspace Context
                      </div>
                      <p>{focusedContextIssue.message}</p>
                      <p className="mt-2 text-red-100">{getWorkspaceContextActionHint(nodeType)}</p>
                    </div>
                  )}
                  {errors.map((error, index) => (
                    <div key={`err_${index}`} className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                      <div className="mb-1 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide">
                        <AppIcon name="alert" className="h-3.5 w-3.5" />
                        Error {index + 1}
                      </div>
                      <p className="whitespace-pre-wrap">{error}</p>
                    </div>
                  ))}
                  </>
                )}
              </div>
            )}
          </div>

          {focusedNode && (
            <footer className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-400">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>Started: {formatDateTime(focusedExecutionState?.startedAt)}</span>
                <span>Completed: {formatDateTime(focusedExecutionState?.completedAt)}</span>
                <span>Source: {sourceTag}</span>
                {focusedExecutionState?.status === 'running' && (
                  <span className="inline-flex items-center gap-1 text-blue-300">
                    <AppIcon name="playCircle" className="h-3.5 w-3.5" />
                    Waiting for async output
                  </span>
                )}
              </div>
              {parityInfo.parityNotes && (
                <p className="mt-1 text-amber-300">Parity: {parityInfo.parityNotes}</p>
              )}
              {warnings.length > 0 && (
                <p className="mt-1 text-amber-300">Warnings: {warnings.length}</p>
              )}
            </footer>
          )}
        </section>
      </div>
    </div>
  )
}
