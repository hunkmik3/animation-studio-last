import type { Edge } from '@xyflow/react'
import { NODE_TYPE_REGISTRY } from '@/lib/workflow-engine/registry'

function appendMultipleInputValue(existing: unknown, next: unknown): unknown[] {
  const existingValues = existing === undefined
    ? []
    : (Array.isArray(existing) ? existing : [existing])
  const nextValues = Array.isArray(next) ? next : [next]
  return [...existingValues, ...nextValues]
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

type ContinuityKind = 'previous-panel-image' | 'character-reference' | 'location-reference'

function readContinuityKind(edge: Edge): ContinuityKind | '' {
  const edgeData = toRecord(edge.data)
  const value = edgeData.continuityKind
  if (value === 'previous-panel-image') return value
  if (value === 'character-reference') return value
  if (value === 'location-reference') return value
  return ''
}

function appendContinuityMeta(
  inputs: Record<string, unknown>,
  key: string,
  edge: Edge,
  sourceHandle: string,
  targetHandle: string,
  continuityKind: ContinuityKind,
) {
  const edgeData = toRecord(edge.data)
  inputs[key] = appendMultipleInputValue(inputs[key], {
    ...edgeData,
    continuityKind,
    edgeId: edge.id,
    sourceNodeId: edge.source,
    sourceHandle,
    targetHandle,
  })
}

function appendContinuityMissingMeta(
  inputs: Record<string, unknown>,
  edge: Edge,
  sourceHandle: string,
  targetHandle: string,
  continuityKind: ContinuityKind,
  reason: 'source-node-output-missing' | 'source-handle-missing' | 'source-value-missing',
) {
  const edgeData = toRecord(edge.data)
  inputs.continuityMissingMeta = appendMultipleInputValue(inputs.continuityMissingMeta, {
    ...edgeData,
    continuityKind,
    edgeId: edge.id,
    sourceNodeId: edge.source,
    sourceHandle,
    targetHandle,
    reason,
  })
}

function appendContinuityReference(
  inputs: Record<string, unknown>,
  continuityKind: ContinuityKind,
  value: unknown,
  edge: Edge,
  sourceHandle: string,
  targetHandle: string,
) {
  appendContinuityMeta(inputs, 'continuityReferenceMeta', edge, sourceHandle, targetHandle, continuityKind)

  if (continuityKind === 'previous-panel-image') {
    inputs.previousPanelReference = appendMultipleInputValue(inputs.previousPanelReference, value)
    appendContinuityMeta(inputs, 'previousPanelReferenceMeta', edge, sourceHandle, targetHandle, continuityKind)
    return
  }

  if (continuityKind === 'character-reference') {
    inputs.characterReference = appendMultipleInputValue(inputs.characterReference, value)
    appendContinuityMeta(inputs, 'characterReferenceMeta', edge, sourceHandle, targetHandle, continuityKind)
    return
  }

  if (continuityKind === 'location-reference') {
    inputs.locationReference = appendMultipleInputValue(inputs.locationReference, value)
    appendContinuityMeta(inputs, 'locationReferenceMeta', edge, sourceHandle, targetHandle, continuityKind)
  }
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

    const sourceHandle = typeof edge.sourceHandle === 'string' ? edge.sourceHandle : ''
    const targetHandle = typeof edge.targetHandle === 'string' && edge.targetHandle.trim().length > 0
      ? edge.targetHandle
      : sourceHandle
    const continuityKind = targetHandle === 'reference'
      ? readContinuityKind(edge)
      : ''
    const sourceOutputs = params.nodeOutputs[edge.source]
    if (!sourceOutputs) {
      if (continuityKind) {
        appendContinuityMissingMeta(
          inputs,
          edge,
          sourceHandle,
          targetHandle,
          continuityKind,
          'source-node-output-missing',
        )
      }
      continue
    }
    if (!sourceHandle) {
      if (continuityKind) {
        appendContinuityMissingMeta(
          inputs,
          edge,
          sourceHandle,
          targetHandle,
          continuityKind,
          'source-handle-missing',
        )
      }
      continue
    }
    const value = sourceOutputs[sourceHandle]
    if (value === undefined) {
      if (continuityKind) {
        appendContinuityMissingMeta(
          inputs,
          edge,
          sourceHandle,
          targetHandle,
          continuityKind,
          'source-value-missing',
        )
      }
      continue
    }

    if (multipleInputHandles.has(targetHandle)) {
      inputs[targetHandle] = appendMultipleInputValue(inputs[targetHandle], value)
      if (continuityKind) {
        appendContinuityReference(inputs, continuityKind, value, edge, sourceHandle, targetHandle)
      }
      continue
    }

    inputs[targetHandle] = value
  }

  return inputs
}
