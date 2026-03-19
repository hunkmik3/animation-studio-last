export const WORKFLOW_EXECUTION_LEASE_STATE_KEY = '__workflowExecutionLease'
export const WORKFLOW_EXECUTION_CURSOR_STATE_KEY = '__workflowExecutionCursor'
export const WORKFLOW_EXECUTION_LEASE_TTL_MS = 10 * 60 * 1000

export interface WorkflowExecutionLease {
  leaseId: string
  runToken: string
  holderClientId: string
  acquiredAt: string
  updatedAt: string
  expiresAt: string
}

export type WorkflowExecutionPhase = 'running' | 'paused' | 'completed' | 'failed'

export interface WorkflowExecutionCursor {
  runToken: string
  graphSignature: string
  phase: WorkflowExecutionPhase
  nextIndex: number
  currentNodeId: string | null
  pausedNodeId: string | null
  updatedAt: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isWorkflowExecutionLease(value: unknown): value is WorkflowExecutionLease {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (!isNonEmptyString(record.leaseId)) return false
  if (!isNonEmptyString(record.runToken)) return false
  if (!isNonEmptyString(record.holderClientId)) return false
  if (typeof record.acquiredAt !== 'string' || Number.isNaN(Date.parse(record.acquiredAt))) return false
  if (typeof record.updatedAt !== 'string' || Number.isNaN(Date.parse(record.updatedAt))) return false
  if (typeof record.expiresAt !== 'string' || Number.isNaN(Date.parse(record.expiresAt))) return false
  return true
}

export function isWorkflowExecutionCursor(value: unknown): value is WorkflowExecutionCursor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (!isNonEmptyString(record.runToken)) return false
  if (!isNonEmptyString(record.graphSignature)) return false
  const phase = record.phase
  if (phase !== 'running' && phase !== 'paused' && phase !== 'completed' && phase !== 'failed') return false
  if (typeof record.nextIndex !== 'number' || !Number.isInteger(record.nextIndex) || record.nextIndex < 0) return false
  if (record.currentNodeId !== null && record.currentNodeId !== undefined && !isNonEmptyString(record.currentNodeId)) return false
  if (record.pausedNodeId !== null && record.pausedNodeId !== undefined && !isNonEmptyString(record.pausedNodeId)) return false
  if (typeof record.updatedAt !== 'string' || Number.isNaN(Date.parse(record.updatedAt))) return false
  return true
}

export function createWorkflowExecutionCursor(params: {
  runToken: string
  graphSignature: string
  phase: WorkflowExecutionPhase
  nextIndex: number
  currentNodeId?: string | null
  pausedNodeId?: string | null
  now?: Date
}): WorkflowExecutionCursor {
  const now = params.now || new Date()
  return {
    runToken: params.runToken,
    graphSignature: params.graphSignature,
    phase: params.phase,
    nextIndex: params.nextIndex,
    currentNodeId: params.currentNodeId || null,
    pausedNodeId: params.pausedNodeId || null,
    updatedAt: now.toISOString(),
  }
}

export function isWorkflowExecutionLeaseExpired(
  lease: WorkflowExecutionLease,
  now: Date = new Date(),
): boolean {
  return Date.parse(lease.expiresAt) <= now.getTime()
}

function createLeaseId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `lease_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function createWorkflowExecutionLease(params: {
  runToken: string
  holderClientId: string
  now?: Date
  leaseId?: string
}): WorkflowExecutionLease {
  const now = params.now || new Date()
  return {
    leaseId: params.leaseId || createLeaseId(),
    runToken: params.runToken,
    holderClientId: params.holderClientId,
    acquiredAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + WORKFLOW_EXECUTION_LEASE_TTL_MS).toISOString(),
  }
}

export function refreshWorkflowExecutionLease(
  lease: WorkflowExecutionLease,
  now: Date = new Date(),
): WorkflowExecutionLease {
  return {
    ...lease,
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + WORKFLOW_EXECUTION_LEASE_TTL_MS).toISOString(),
  }
}
