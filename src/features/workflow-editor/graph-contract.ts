import type { Edge, Node } from '@xyflow/react'
import { NODE_TYPE_REGISTRY } from '@/lib/workflow-engine/registry'
import { isNodeTypeExecutionSupported } from '@/lib/workflow-engine/execution-support'

export interface UnsupportedExecutionNode {
  nodeId: string
  nodeType: string
  label: string
}

export interface GraphContractIssue {
  edgeId: string
  reason: 'missing-node' | 'missing-node-definition' | 'invalid-source-handle' | 'invalid-target-handle'
}

export interface GraphSanitizationResult {
  nodes: Node[]
  edges: Edge[]
  issues: GraphContractIssue[]
  changed: boolean
}

const LEGACY_HANDLE_MAP: Record<string, string[]> = {
  input: ['text', 'value', 'prompt'],
  content: ['text', 'prompt'],
  script: ['text'],
  value: ['text'],
  output: ['result', 'text'],
  panel: ['panels'],
  scene: ['scenes'],
  location: ['scenes'],
  character: ['characters'],
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function getNodeType(node: Node): string {
  const data = toRecord(node.data)
  return typeof data.nodeType === 'string' ? data.nodeType : ''
}

function getNodeLabel(node: Node): string {
  const data = toRecord(node.data)
  const label = typeof data.label === 'string' ? data.label.trim() : ''
  if (label) return label
  return node.id
}

function normalizeHandle(
  rawHandle: string | null | undefined,
  allowedHandles: string[],
): { handle: string | null; remapped: boolean } {
  if (allowedHandles.length === 0) {
    return { handle: null, remapped: false }
  }

  const normalized = typeof rawHandle === 'string' ? rawHandle.trim() : ''
  if (normalized && allowedHandles.includes(normalized)) {
    return { handle: normalized, remapped: false }
  }

  if (normalized) {
    const caseInsensitiveMatch = allowedHandles.find((handle) => handle.toLowerCase() === normalized.toLowerCase())
    if (caseInsensitiveMatch) {
      return { handle: caseInsensitiveMatch, remapped: caseInsensitiveMatch !== normalized }
    }

    const mappedCandidates = LEGACY_HANDLE_MAP[normalized.toLowerCase()] || []
    for (const candidate of mappedCandidates) {
      if (allowedHandles.includes(candidate)) {
        return { handle: candidate, remapped: true }
      }
    }
  }

  if (allowedHandles.length === 1) {
    return { handle: allowedHandles[0], remapped: true }
  }

  return { handle: null, remapped: false }
}

function isExecutionNode(node: Node): boolean {
  return node.type !== 'workflowGroup' && !node.hidden
}

export function collectUnsupportedExecutionNodes(nodes: Node[]): UnsupportedExecutionNode[] {
  const unsupported: UnsupportedExecutionNode[] = []

  for (const node of nodes) {
    if (!isExecutionNode(node)) continue
    const nodeType = getNodeType(node)
    if (!nodeType) {
      unsupported.push({
        nodeId: node.id,
        nodeType: 'unknown',
        label: getNodeLabel(node),
      })
      continue
    }
    if (!isNodeTypeExecutionSupported(nodeType)) {
      unsupported.push({
        nodeId: node.id,
        nodeType,
        label: getNodeLabel(node),
      })
    }
  }

  return unsupported
}

export function sanitizeWorkflowGraph(input: { nodes: Node[]; edges: Edge[] }): GraphSanitizationResult {
  const nodeById = new Map<string, Node>()
  for (const node of input.nodes) {
    nodeById.set(node.id, node)
  }

  const sanitizedEdges: Edge[] = []
  const issues: GraphContractIssue[] = []
  let changed = false

  for (const edge of input.edges) {
    const sourceNode = nodeById.get(edge.source)
    const targetNode = nodeById.get(edge.target)

    if (!sourceNode || !targetNode) {
      issues.push({ edgeId: edge.id, reason: 'missing-node' })
      changed = true
      continue
    }

    const sourceType = getNodeType(sourceNode)
    const targetType = getNodeType(targetNode)
    const sourceDef = NODE_TYPE_REGISTRY[sourceType]
    const targetDef = NODE_TYPE_REGISTRY[targetType]
    if (!sourceDef || !targetDef) {
      issues.push({ edgeId: edge.id, reason: 'missing-node-definition' })
      changed = true
      continue
    }

    const sourceHandles = sourceDef.outputs.map((port) => port.id)
    const targetHandles = targetDef.inputs.map((port) => port.id)

    const normalizedSource = normalizeHandle(
      typeof edge.sourceHandle === 'string' ? edge.sourceHandle : null,
      sourceHandles,
    )
    if (!normalizedSource.handle) {
      issues.push({ edgeId: edge.id, reason: 'invalid-source-handle' })
      changed = true
      continue
    }

    const normalizedTarget = normalizeHandle(
      typeof edge.targetHandle === 'string' ? edge.targetHandle : null,
      targetHandles,
    )
    if (!normalizedTarget.handle) {
      issues.push({ edgeId: edge.id, reason: 'invalid-target-handle' })
      changed = true
      continue
    }

    const nextEdge: Edge = {
      ...edge,
      sourceHandle: normalizedSource.handle,
      targetHandle: normalizedTarget.handle,
    }
    if (
      nextEdge.sourceHandle !== edge.sourceHandle
      || nextEdge.targetHandle !== edge.targetHandle
    ) {
      changed = true
    }
    sanitizedEdges.push(nextEdge)
  }

  return {
    nodes: input.nodes,
    edges: sanitizedEdges,
    issues,
    changed,
  }
}
