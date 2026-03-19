import type { Edge, Node } from '@xyflow/react'

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function configSnapshot(config: Record<string, unknown>): string {
  try {
    return JSON.stringify(config, Object.keys(config).sort())
  } catch {
    return ''
  }
}

export function buildWorkflowGraphSignature(nodes: Node[], edges: Edge[]): string {
  const executionNodes = nodes
    .filter((node) => node.type !== 'workflowGroup' && !node.hidden)
    .map((node) => {
      const nodeData = toRecord(node.data)
      const nodeType = typeof nodeData.nodeType === 'string' ? nodeData.nodeType : ''
      const config = toRecord(nodeData.config)
      return {
        id: node.id,
        nodeType,
        config: configSnapshot(config),
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))

  const executionNodeIds = new Set(executionNodes.map((node) => node.id))
  const executionEdges = edges
    .filter((edge) => executionNodeIds.has(edge.source) && executionNodeIds.has(edge.target))
    .map((edge) => ({
      source: edge.source,
      sourceHandle: typeof edge.sourceHandle === 'string' ? edge.sourceHandle : '',
      target: edge.target,
      targetHandle: typeof edge.targetHandle === 'string' ? edge.targetHandle : '',
    }))
    .sort((a, b) => {
      const left = `${a.source}:${a.sourceHandle}->${a.target}:${a.targetHandle}`
      const right = `${b.source}:${b.sourceHandle}->${b.target}:${b.targetHandle}`
      return left.localeCompare(right)
    })

  return JSON.stringify({
    nodes: executionNodes,
    edges: executionEdges,
  })
}

