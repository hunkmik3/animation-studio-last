import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  buildStoryboardPanelGraph,
  collectStoryboardDerivedNodeIds,
  extractCharacterReferenceSeeds,
  extractStoryboardPanelsFromOutputs,
  extractStoryboardSceneReferenceSeeds,
} from '@/features/workflow-editor/storyboard-materialization'

describe('storyboard materialization helpers', () => {
  it('extracts materializable storyboard panels from node outputs', () => {
    const panels = extractStoryboardPanelsFromOutputs({
      panels: [
        {
          panelIndex: 0,
          panel_number: 1,
          description: 'A lonely alley at night',
          source_text: 'The hero walks into the alley.',
          imagePrompt: 'Anime alley with neon reflections',
          video_prompt: 'Slow dolly forward through the alley',
          characters: ['Hero'],
          location: 'Neon Alley',
        },
        {
          panelIndex: 1,
          panel_number: 2,
          description: 'Close-up on the hero',
          characters: JSON.stringify([{ name: 'Hero' }, { name: 'Shadow' }]),
          location: 'Neon Alley',
        },
      ],
    })

    expect(panels).toEqual([
      {
        panelIndex: 0,
        panelNumber: 1,
        description: 'A lonely alley at night',
        sourceText: 'The hero walks into the alley.',
        imagePrompt: 'Anime alley with neon reflections',
        videoPrompt: 'Slow dolly forward through the alley',
        characters: ['Hero'],
        characterAssetIds: [],
        location: 'Neon Alley',
        locationAssetId: '',
      },
      {
        panelIndex: 1,
        panelNumber: 2,
        description: 'Close-up on the hero',
        sourceText: '',
        imagePrompt: 'Close-up on the hero',
        videoPrompt: 'Close-up on the hero',
        characters: ['Hero', 'Shadow'],
        characterAssetIds: [],
        location: 'Neon Alley',
        locationAssetId: '',
      },
    ])
  })

  it('extracts character and scene reference seeds from upstream workflow outputs', () => {
    const characterSeeds = extractCharacterReferenceSeeds({
      characters: [
        {
          name: 'Eren',
          aliases: ['Jaeger'],
          introduction: 'Teen protagonist with explosive determination.',
          appearance: 'Short brown hair, green eyes, scout jacket',
          visual_keywords: ['anime', 'determined'],
        },
      ],
    })
    const sceneSeeds = extractStoryboardSceneReferenceSeeds({
      scenes: [
        {
          name: 'Shiganshina Gate',
          description: 'Massive stone gate under a red warning sky',
          atmosphere: 'urgent',
          key_objects: ['gate', 'smoke'],
        },
      ],
    })

    expect(characterSeeds).toEqual([
      expect.objectContaining({
        assetId: '',
        name: 'Eren',
        aliases: ['Jaeger'],
        imageUrl: null,
      }),
    ])
    expect(characterSeeds[0]?.prompt).toContain('production character reference illustration')
    expect(sceneSeeds).toEqual([
      expect.objectContaining({
        assetId: '',
        name: 'Shiganshina Gate',
        imageUrl: null,
      }),
    ])
    expect(sceneSeeds[0]?.prompt).toContain('production environment reference concept art')
  })

  it('builds a grouped workflow graph with reference assets and per-panel media nodes', () => {
    const graph = buildStoryboardPanelGraph({
      storyboardNodeId: 'storyboard_1',
      storyboardNodeLabel: 'Storyboard',
      storyboardPosition: { x: 100, y: 200 },
      characterReferences: [
        {
          assetId: '',
          name: 'Eren',
          aliases: ['Jaeger'],
          prompt: 'Eren reference prompt',
          imageUrl: null,
        },
      ],
      sceneReferences: [
        {
          assetId: '',
          name: 'Shiganshina Gate',
          prompt: 'Gate scene prompt',
          imageUrl: null,
        },
      ],
      artStyle: 'realistic',
      panels: [
        {
          panelIndex: 0,
          panelNumber: 1,
          description: 'Panel 1',
          sourceText: 'Line 1',
          imagePrompt: 'Image prompt 1',
          videoPrompt: 'Video prompt 1',
          characters: ['Eren'],
          characterAssetIds: [],
          location: 'Shiganshina Gate',
          locationAssetId: '',
        },
        {
          panelIndex: 1,
          panelNumber: 2,
          description: 'Panel 2',
          sourceText: 'Line 2',
          imagePrompt: 'Image prompt 2',
          videoPrompt: 'Video prompt 2',
          characters: [],
          characterAssetIds: [],
          location: '',
          locationAssetId: '',
        },
      ],
    })

    expect(graph.groupId).toBe('storyboard_1__panels_group')
    expect(graph.nodes).toHaveLength(13)
    expect(graph.edges).toHaveLength(10)

    const groupNode = graph.nodes.find((node) => node.id === graph.groupId)
    expect(groupNode?.type).toBe('workflowGroup')
    expect(groupNode?.position).toEqual({ x: 480, y: 160 })
    expect(groupNode?.data).toEqual(expect.objectContaining({
      label: 'Storyboard Assets · Storyboard',
      width: 1600,
    }))

    const imagePromptNode = graph.nodes.find((node) => node.id === 'storyboard_1__panel_1__image_prompt')
    expect(imagePromptNode?.data).toEqual(expect.objectContaining({
      nodeType: 'text-input',
      label: 'Panel 1 Image Prompt',
      derivedFromStoryboard: 'storyboard_1',
    }))

    const characterReferenceNode = graph.nodes.find((node) => node.id === 'storyboard_1__character_ref_1__image')
    expect(characterReferenceNode?.data).toEqual(expect.objectContaining({
      nodeType: 'image-generate',
      label: 'Eren Ref Image',
      materializedReferenceType: 'character',
      config: expect.objectContaining({
        artStyle: 'realistic',
      }),
    }))

    const sceneReferenceNode = graph.nodes.find((node) => node.id === 'storyboard_1__scene_ref_1__image')
    expect(sceneReferenceNode?.data).toEqual(expect.objectContaining({
      nodeType: 'image-generate',
      label: 'Shiganshina Gate Scene Image',
      materializedReferenceType: 'scene',
      config: expect.objectContaining({
        artStyle: 'realistic',
      }),
    }))

    const videoNode = graph.nodes.find((node) => node.id === 'storyboard_1__panel_2__video')
    expect(videoNode?.data).toEqual(expect.objectContaining({
      nodeType: 'video-generate',
      materializedPanelIndex: 1,
      config: expect.objectContaining({
        artStyle: 'realistic',
      }),
    }))

    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'storyboard_1__panel_1__image_prompt',
        target: 'storyboard_1__panel_1__image',
        targetHandle: 'prompt',
      }),
      expect.objectContaining({
        source: 'storyboard_1__panel_1__image',
        target: 'storyboard_1__panel_1__video',
        targetHandle: 'image',
      }),
      expect.objectContaining({
        source: 'storyboard_1__character_ref_1__image',
        target: 'storyboard_1__panel_1__image',
        targetHandle: 'reference',
      }),
      expect.objectContaining({
        source: 'storyboard_1__scene_ref_1__image',
        target: 'storyboard_1__panel_1__image',
        targetHandle: 'reference',
      }),
    ]))
    expect(graph.preloadedOutputs).toEqual({})
  })

  it('prefers asset-backed reference images when storyboard inputs already contain selected refs', () => {
    const graph = buildStoryboardPanelGraph({
      storyboardNodeId: 'storyboard_asset_1',
      storyboardNodeLabel: 'Asset Storyboard',
      storyboardPosition: { x: 80, y: 120 },
      characterReferences: [
        {
          assetId: 'char-queen',
          name: 'Queen Elara',
          aliases: ['Empress Elara'],
          prompt: 'Unused because asset ref should win',
          imageUrl: '/m/queen-elara.png',
        },
      ],
      sceneReferences: [
        {
          assetId: 'scene-backroom',
          name: 'Secret Backroom',
          prompt: 'Unused because asset ref should win',
          imageUrl: '/m/secret-backroom.png',
        },
      ],
      panels: [
        {
          panelIndex: 0,
          panelNumber: 1,
          description: 'Panel 1',
          sourceText: 'Line 1',
          imagePrompt: 'Queen Elara confronts the nobles',
          videoPrompt: 'A slow push-in over the table',
          characters: ['Queen Elara'],
          characterAssetIds: ['char-queen'],
          location: 'Secret Backroom',
          locationAssetId: 'scene-backroom',
        },
      ],
    })

    const characterReferenceNode = graph.nodes.find((node) => node.id === 'storyboard_asset_1__character_ref_1__image')
    const sceneReferenceNode = graph.nodes.find((node) => node.id === 'storyboard_asset_1__scene_ref_1__image')

    expect(characterReferenceNode?.data).toEqual(expect.objectContaining({
      nodeType: 'reference-image',
      config: expect.objectContaining({
        imageUrl: '/m/queen-elara.png',
      }),
      initialOutput: {
        image: '/m/queen-elara.png',
      },
      materializedReferenceSource: 'asset-hub',
    }))
    expect(sceneReferenceNode?.data).toEqual(expect.objectContaining({
      nodeType: 'reference-image',
      config: expect.objectContaining({
        imageUrl: '/m/secret-backroom.png',
      }),
      initialOutput: {
        image: '/m/secret-backroom.png',
      },
      materializedReferenceSource: 'asset-hub',
    }))
    expect(graph.preloadedOutputs).toEqual({
      storyboard_asset_1__character_ref_1__image: { image: '/m/queen-elara.png' },
      storyboard_asset_1__scene_ref_1__image: { image: '/m/secret-backroom.png' },
    })
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'storyboard_asset_1__character_ref_1__image',
        target: 'storyboard_asset_1__panel_1__image',
        targetHandle: 'reference',
      }),
      expect.objectContaining({
        source: 'storyboard_asset_1__scene_ref_1__image',
        target: 'storyboard_asset_1__panel_1__image',
        targetHandle: 'reference',
      }),
    ]))
  })

  it('connects reference nodes by asset id even when panel character/location names differ', () => {
    const graph = buildStoryboardPanelGraph({
      storyboardNodeId: 'storyboard_asset_id_1',
      storyboardNodeLabel: 'Asset Id Storyboard',
      storyboardPosition: { x: 100, y: 120 },
      characterReferences: [
        {
          assetId: 'char-queen',
          name: 'Clara Queen',
          aliases: ['Empress Elara'],
          prompt: 'Reference prompt',
          imageUrl: '/m/queen-ref.png',
        },
      ],
      sceneReferences: [
        {
          assetId: 'scene-backroom',
          name: 'Secret Backroom',
          prompt: 'Reference prompt',
          imageUrl: '/m/scene-ref.png',
        },
      ],
      panels: [
        {
          panelIndex: 0,
          panelNumber: 1,
          description: 'Panel 1',
          sourceText: 'Line 1',
          imagePrompt: 'Image prompt 1',
          videoPrompt: 'Video prompt 1',
          characters: ['Queen Elara'],
          characterAssetIds: ['char-queen'],
          location: 'War Room',
          locationAssetId: 'scene-backroom',
        },
      ],
    })

    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'storyboard_asset_id_1__character_ref_1__image',
        target: 'storyboard_asset_id_1__panel_1__image',
        targetHandle: 'reference',
      }),
      expect.objectContaining({
        source: 'storyboard_asset_id_1__scene_ref_1__image',
        target: 'storyboard_asset_id_1__panel_1__image',
        targetHandle: 'reference',
      }),
    ]))
  })

  it('collects all nodes derived from a storyboard node', () => {
    const nodes: Node[] = [
      {
        id: 'storyboard_1__panels_group',
        type: 'workflowGroup',
        position: { x: 0, y: 0 },
        data: { derivedFromStoryboard: 'storyboard_1' },
      },
      {
        id: 'storyboard_1__panel_1__image',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: { derivedFromStoryboard: 'storyboard_1' },
      },
      {
        id: 'other_node',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {},
      },
    ]

    const derivedIds = collectStoryboardDerivedNodeIds(nodes, 'storyboard_1')
    expect(Array.from(derivedIds)).toEqual([
      'storyboard_1__panels_group',
      'storyboard_1__panel_1__image',
    ])
  })
})
