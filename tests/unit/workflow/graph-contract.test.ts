import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { collectUnsupportedExecutionNodes, sanitizeWorkflowGraph } from '@/features/workflow-editor/graph-contract'

function makeNode(id: string, nodeType: string): Node {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      nodeType,
      label: id,
      config: {},
    },
  }
}

describe('workflow graph contract', () => {
  it('remaps legacy target handles to valid handles for launch-safe nodes', () => {
    const nodes: Node[] = [
      makeNode('n_text', 'text-input'),
      makeNode('n_llm', 'llm-prompt'),
    ]
    const edges: Edge[] = [
      {
        id: 'e_1',
        source: 'n_text',
        sourceHandle: 'text',
        target: 'n_llm',
        targetHandle: 'input',
      },
    ]

    const result = sanitizeWorkflowGraph({ nodes, edges })
    expect(result.changed).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0]?.targetHandle).toBe('text')
  })

  it('drops edges that reference invalid node handles', () => {
    const nodes: Node[] = [
      makeNode('n_text', 'text-input'),
      makeNode('n_llm', 'llm-prompt'),
    ]
    const edges: Edge[] = [
      {
        id: 'e_invalid',
        source: 'n_text',
        sourceHandle: 'text',
        target: 'n_llm',
        targetHandle: 'invalid_input',
      },
    ]

    const result = sanitizeWorkflowGraph({ nodes, edges })
    expect(result.changed).toBe(true)
    expect(result.edges).toHaveLength(0)
    expect(result.issues).toEqual([
      {
        edgeId: 'e_invalid',
        reason: 'invalid-target-handle',
      },
    ])
  })

  it('reports unsupported execution nodes that block launch-safe run', () => {
    const nodes: Node[] = [
      makeNode('n_text', 'text-input'),
      makeNode('n_cond', 'condition'),
    ]

    const unsupported = collectUnsupportedExecutionNodes(nodes)
    expect(unsupported).toEqual([
      {
        nodeId: 'n_cond',
        nodeType: 'condition',
        label: 'n_cond',
      },
    ])
  })
})
