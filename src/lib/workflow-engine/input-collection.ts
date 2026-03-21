import type { Edge } from '@xyflow/react'
import { NODE_TYPE_REGISTRY } from '@/lib/workflow-engine/registry'

function appendMultipleInputValue(existing: unknown, next: unknown): unknown[] {
  const existingValues = existing === undefined
    ? []
    : (Array.isArray(existing) ? existing : [existing])
  const nextValues = Array.isArray(next) ? next : [next]
  return [...existingValues, ...nextValues]
}

export function collectWorkflowNodeInputs(params: {
  nodeId: string
  nodeType: string
  edges: ReadonlyArray<Edge>
  nodeOutputs: Record<string, Record<string, unknown> | undefined>
}): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  const nodeDefinition = NODE_TYPE_REGISTRY[params.nodeType]
  const multipleInputHandles = new Set(
    (nodeDefinition?.inputs || [])
      .filter((input) => input.multiple)
      .map((input) => input.id),
  )

  for (const edge of params.edges) {
    if (edge.target !== params.nodeId) continue

    const sourceOutputs = params.nodeOutputs[edge.source]
    const sourceHandle = typeof edge.sourceHandle === 'string' ? edge.sourceHandle : ''
    if (!sourceOutputs || !sourceHandle) continue

    const targetHandle = typeof edge.targetHandle === 'string' && edge.targetHandle.trim().length > 0
      ? edge.targetHandle
      : sourceHandle
    const value = sourceOutputs[sourceHandle]
    if (value === undefined) continue

    if (multipleInputHandles.has(targetHandle)) {
      inputs[targetHandle] = appendMultipleInputValue(inputs[targetHandle], value)
      continue
    }

    inputs[targetHandle] = value
  }

  return inputs
}
