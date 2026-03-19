import type { Node } from '@xyflow/react'
import type { NodeExecutionState } from '@/lib/workflow-engine/types'

export type OutputSourceKind = 'execution' | 'store' | 'initial' | 'none'

export interface ResolvedNodeOutput {
  source: OutputSourceKind
  outputs: Record<string, unknown>
}

export interface WorkflowParityInfo {
  temporaryImplementation: boolean
  parityNotes: string | null
  metadata: Record<string, unknown> | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function hasKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0
}

function toString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveMediaUrl(value: unknown): string {
  const raw = toString(value)
  if (!raw) return ''

  const lower = raw.toLowerCase()
  if (
    lower.startsWith('http://')
    || lower.startsWith('https://')
    || lower.startsWith('blob:')
    || lower.startsWith('data:')
  ) {
    return raw
  }

  if (raw.startsWith('/api/media/')) return raw

  const normalized = raw.startsWith('/') ? raw.slice(1) : raw
  return `/api/media/${normalized}`
}

export function resolveNodeOutputs(params: {
  node?: Node | null
  executionState?: NodeExecutionState | null
  nodeOutput?: Record<string, unknown> | null
}): ResolvedNodeOutput {
  const stateOutputs = toRecord(params.executionState?.outputs)
  if (hasKeys(stateOutputs)) {
    return { source: 'execution', outputs: stateOutputs }
  }

  const storeOutputs = toRecord(params.nodeOutput)
  if (hasKeys(storeOutputs)) {
    return { source: 'store', outputs: storeOutputs }
  }

  const nodeData = toRecord(params.node?.data)
  const initialOutput = toRecord(nodeData.initialOutput)
  if (hasKeys(initialOutput)) {
    return { source: 'initial', outputs: initialOutput }
  }

  return { source: 'none', outputs: {} }
}

function readParityMetaFromOutput(outputs: Record<string, unknown>): WorkflowParityInfo {
  const metadata = toRecord(outputs._metadata)
  return {
    temporaryImplementation: outputs._temporaryImplementation === true,
    parityNotes: toString(outputs._parityNotes) || null,
    metadata: hasKeys(metadata) ? metadata : null,
  }
}

function readParityMetaFromNodeData(nodeData: Record<string, unknown>): WorkflowParityInfo {
  const lastExecutionMeta = toRecord(nodeData.lastExecutionMeta)
  const metadata = toRecord(lastExecutionMeta.metadata)
  return {
    temporaryImplementation: lastExecutionMeta.temporaryImplementation === true,
    parityNotes: toString(lastExecutionMeta.parityNotes) || null,
    metadata: hasKeys(metadata) ? metadata : null,
  }
}

export function resolveParityInfo(params: {
  node?: Node | null
  outputs: Record<string, unknown>
}): WorkflowParityInfo {
  const fromOutput = readParityMetaFromOutput(params.outputs)
  if (fromOutput.temporaryImplementation || fromOutput.parityNotes || fromOutput.metadata) {
    return fromOutput
  }

  const nodeData = toRecord(params.node?.data)
  return readParityMetaFromNodeData(nodeData)
}

function readWarningsFromArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
}

export function resolveNodeWarnings(outputs: Record<string, unknown>): string[] {
  const warningSet = new Set<string>()

  readWarningsFromArray(outputs.warnings).forEach((warning) => warningSet.add(warning))

  const metadata = toRecord(outputs._metadata)
  readWarningsFromArray(metadata.warnings).forEach((warning) => warningSet.add(warning))

  return Array.from(warningSet)
}

export function resolveNodeErrors(params: {
  executionState?: NodeExecutionState | null
  outputs: Record<string, unknown>
}): string[] {
  const errorSet = new Set<string>()
  const stateError = toString(params.executionState?.error)
  if (stateError) errorSet.add(stateError)

  const outputError = toString(params.outputs.error)
  if (outputError) errorSet.add(outputError)

  return Array.from(errorSet)
}

export function resolveOutputSourceTag(params: {
  executionState?: NodeExecutionState | null
  source: OutputSourceKind
}): 'live' | 'cached' | 'initial' | 'none' {
  if (params.source === 'none') return 'none'
  if (params.source === 'initial') return 'initial'

  const state = params.executionState
  if (!state) return params.source === 'store' ? 'cached' : 'live'

  if (state.status === 'skipped') return 'cached'
  const message = toString(state.message).toLowerCase()
  if (message.includes('restored from previous run')) return 'cached'

  return 'live'
}

export function readNodeType(node: Node | null | undefined): string {
  const nodeData = toRecord(node?.data)
  const type = nodeData.nodeType
  return typeof type === 'string' ? type : ''
}

export function readNodeLabel(node: Node | null | undefined): string {
  const nodeData = toRecord(node?.data)
  const label = nodeData.label
  if (typeof label === 'string' && label.trim().length > 0) return label.trim()
  return node?.id || 'Unknown node'
}

export function readNodeSummary(outputs: Record<string, unknown>): string {
  const summary = toString(outputs.summary)
  if (summary) return summary

  const result = toString(outputs.result)
  if (result) {
    return result.length > 160 ? `${result.slice(0, 160)}...` : result
  }

  return ''
}
