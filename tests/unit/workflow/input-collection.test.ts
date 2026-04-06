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

  it('extracts previous panel continuity references from tagged reference edges', () => {
    const edges: Edge[] = [
      {
        id: 'edge_prev_panel',
        source: 'panel_1_image',
        sourceHandle: 'image',
        target: 'panel_2_image',
        targetHandle: 'reference',
        data: {
          continuityKind: 'previous-panel-image',
          continuitySource: 'materialized-panel-chain',
        },
      },
      {
        id: 'edge_scene_ref',
        source: 'scene_ref',
        sourceHandle: 'image',
        target: 'panel_2_image',
        targetHandle: 'reference',
      },
      {
        id: 'edge_prompt',
        source: 'prompt_node',
        sourceHandle: 'text',
        target: 'panel_2_image',
        targetHandle: 'prompt',
      },
    ]

    const inputs = collectWorkflowNodeInputs({
      nodeId: 'panel_2_image',
      nodeType: 'image-generate',
      edges,
      nodeOutputs: {
        panel_1_image: { image: '/m/panel-1.jpg' },
        scene_ref: { image: '/m/scene.png' },
        prompt_node: { text: 'Panel 2 prompt' },
      },
    })

    expect(inputs).toEqual({
      prompt: 'Panel 2 prompt',
      reference: ['/m/panel-1.jpg', '/m/scene.png'],
      previousPanelReference: ['/m/panel-1.jpg'],
      continuityReferenceMeta: [
        {
          continuityKind: 'previous-panel-image',
          continuitySource: 'materialized-panel-chain',
          edgeId: 'edge_prev_panel',
          sourceNodeId: 'panel_1_image',
          sourceHandle: 'image',
          targetHandle: 'reference',
        },
      ],
      previousPanelReferenceMeta: [
        {
          continuityKind: 'previous-panel-image',
          continuitySource: 'materialized-panel-chain',
          edgeId: 'edge_prev_panel',
          sourceNodeId: 'panel_1_image',
          sourceHandle: 'image',
          targetHandle: 'reference',
        },
      ],
    })
  })

  it('extracts character/location continuity references and tracks unresolved continuity sources', () => {
    const edges: Edge[] = [
      {
        id: 'edge_character_ref',
        source: 'character_ref',
        sourceHandle: 'image',
        target: 'panel_3_image',
        targetHandle: 'reference',
        data: {
          continuityKind: 'character-reference',
          continuitySource: 'materialized-character-reference',
          characterName: 'Clara Queen',
          appearanceLockTokens: ['deep blue royal gown', 'silver crown'],
          identityTokens: ['queen', 'cold gaze'],
        },
      },
      {
        id: 'edge_location_ref',
        source: 'location_ref',
        sourceHandle: 'image',
        target: 'panel_3_image',
        targetHandle: 'reference',
        data: {
          continuityKind: 'location-reference',
          continuitySource: 'materialized-location-reference',
          locationName: 'Secret Backroom',
        },
      },
      {
        id: 'edge_missing_prev',
        source: 'panel_2_image',
        sourceHandle: 'image',
        target: 'panel_3_image',
        targetHandle: 'reference',
        data: {
          continuityKind: 'previous-panel-image',
          continuitySource: 'materialized-panel-chain',
        },
      },
    ]

    const inputs = collectWorkflowNodeInputs({
      nodeId: 'panel_3_image',
      nodeType: 'image-generate',
      edges,
      nodeOutputs: {
        character_ref: { image: '/m/queen-ref.png' },
        location_ref: { image: '/m/secret-room.png' },
      },
    })

    expect(inputs).toEqual({
      reference: ['/m/queen-ref.png', '/m/secret-room.png'],
      continuityReferenceMeta: [
        {
          continuityKind: 'character-reference',
          continuitySource: 'materialized-character-reference',
          characterName: 'Clara Queen',
          appearanceLockTokens: ['deep blue royal gown', 'silver crown'],
          identityTokens: ['queen', 'cold gaze'],
          edgeId: 'edge_character_ref',
          sourceNodeId: 'character_ref',
          sourceHandle: 'image',
          targetHandle: 'reference',
        },
        {
          continuityKind: 'location-reference',
          continuitySource: 'materialized-location-reference',
          locationName: 'Secret Backroom',
          edgeId: 'edge_location_ref',
          sourceNodeId: 'location_ref',
          sourceHandle: 'image',
          targetHandle: 'reference',
        },
      ],
      characterReference: ['/m/queen-ref.png'],
      characterReferenceMeta: [
        {
          continuityKind: 'character-reference',
          continuitySource: 'materialized-character-reference',
          characterName: 'Clara Queen',
          appearanceLockTokens: ['deep blue royal gown', 'silver crown'],
          identityTokens: ['queen', 'cold gaze'],
          edgeId: 'edge_character_ref',
          sourceNodeId: 'character_ref',
          sourceHandle: 'image',
          targetHandle: 'reference',
        },
      ],
      locationReference: ['/m/secret-room.png'],
      locationReferenceMeta: [
        {
          continuityKind: 'location-reference',
          continuitySource: 'materialized-location-reference',
          locationName: 'Secret Backroom',
          edgeId: 'edge_location_ref',
          sourceNodeId: 'location_ref',
          sourceHandle: 'image',
          targetHandle: 'reference',
        },
      ],
      continuityMissingMeta: [
        {
          continuityKind: 'previous-panel-image',
          continuitySource: 'materialized-panel-chain',
          edgeId: 'edge_missing_prev',
          sourceNodeId: 'panel_2_image',
          sourceHandle: 'image',
          targetHandle: 'reference',
          reason: 'source-node-output-missing',
        },
      ],
    })
  })
})
