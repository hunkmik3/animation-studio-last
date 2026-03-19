export const WORKFLOW_CONTINUATION_STATE_KEY = '__workflowContinuation'

export interface WorkflowContinuationMarker {
  runToken: string
  order: string[]
  nextIndex: number
  pausedNodeId: string
  freshlyExecutedNodeIds: string[]
  graphSignature: string
  updatedAt: string
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isWorkflowContinuationMarker(value: unknown): value is WorkflowContinuationMarker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (typeof record.runToken !== 'string' || record.runToken.trim().length === 0) return false
  if (!isStringArray(record.order) || record.order.length === 0) return false
  if (typeof record.nextIndex !== 'number' || !Number.isInteger(record.nextIndex) || record.nextIndex < 0) return false
  if (typeof record.pausedNodeId !== 'string' || record.pausedNodeId.trim().length === 0) return false
  if (!isStringArray(record.freshlyExecutedNodeIds)) return false
  if (typeof record.graphSignature !== 'string' || record.graphSignature.trim().length === 0) return false
  if (typeof record.updatedAt !== 'string' || Number.isNaN(Date.parse(record.updatedAt))) return false
  return true
}

