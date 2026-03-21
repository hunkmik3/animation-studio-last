import { describe, expect, it } from 'vitest'
import type { Edge } from '@xyflow/react'
import { collectWorkflowNodeInputs } from '@/lib/workflow-engine/input-collection'

describe('workflow input collection', () => {
  it('aggregates multiple reference image edges into a single array input', () => {
    const edges: Edge[] = [
      {
        id: 'edge_1',
        source: 'char_ref',
        sourceHandle: 'image',
        target: 'panel_image',
        targetHandle: 'reference',
      },
      {
        id: 'edge_2',
        source: 'scene_ref',
        sourceHandle: 'image',
        target: 'panel_image',
        targetHandle: 'reference',
      },
      {
        id: 'edge_3',
        source: 'prompt_node',
        sourceHandle: 'text',
        target: 'panel_image',
        targetHandle: 'prompt',
      },
    ]

    const inputs = collectWorkflowNodeInputs({
      nodeId: 'panel_image',
      nodeType: 'image-generate',
      edges,
      nodeOutputs: {
        char_ref: { image: '/m/character.png' },
        scene_ref: { image: '/m/scene.png' },
        prompt_node: { text: 'Hero facing the gate' },
      },
    })

    expect(inputs).toEqual({
      prompt: 'Hero facing the gate',
      reference: ['/m/character.png', '/m/scene.png'],
    })
  })

  it('keeps single-value handles in last-write-wins mode', () => {
    const edges: Edge[] = [
      {
        id: 'edge_1',
        source: 'prompt_a',
        sourceHandle: 'text',
        target: 'panel_image',
        targetHandle: 'prompt',
      },
      {
        id: 'edge_2',
        source: 'prompt_b',
        sourceHandle: 'text',
        target: 'panel_image',
        targetHandle: 'prompt',
      },
    ]

    const inputs = collectWorkflowNodeInputs({
      nodeId: 'panel_image',
      nodeType: 'image-generate',
      edges,
      nodeOutputs: {
        prompt_a: { text: 'First prompt' },
        prompt_b: { text: 'Final prompt' },
      },
    })

    expect(inputs).toEqual({
      prompt: 'Final prompt',
    })
  })
})
