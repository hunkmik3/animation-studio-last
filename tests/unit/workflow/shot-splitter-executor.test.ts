import { describe, expect, it } from 'vitest'
import { executeShotSplitter } from '@/lib/workflow-engine/executors/shot-splitter'
import type { NodeExecutorContext } from '@/lib/workflow-engine/executors/types'

function createContext(overrides?: Partial<NodeExecutorContext>): NodeExecutorContext {
  return {
    nodeId: 'shot_splitter_1',
    nodeType: 'shot-splitter',
    config: {
      splitMode: 'line',
      maxShots: 24,
    },
    inputs: {
      text: '',
    },
    projectId: null,
    userId: 'user_1',
    locale: 'en',
    modelConfig: {
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
    },
    ...overrides,
  }
}

describe('shot splitter executor', () => {
  it('splits scripts by line, preserves asset ids, and inherits location context by default', async () => {
    const result = await executeShotSplitter(createContext({
      inputs: {
        text: [
          'Queen Elara slams her goblet in the Secret Backroom.',
          'The Messenger kneels before Queen Elara.',
          'A noble whispers in fear.',
        ].join('\n'),
        characters: [
          { id: 'char-queen', name: 'Queen Elara', aliases: ['Empress Elara'] },
          { id: 'char-messenger', name: 'Messenger', aliases: [] },
        ],
        scenes: [
          { id: 'scene-backroom', name: 'Secret Backroom' },
        ],
      },
    }))

    expect(result.outputs).toEqual({
      panels: [
        {
          panelIndex: 0,
          panel_number: 1,
          description: 'Queen Elara slams her goblet in the Secret Backroom.',
          source_text: 'Queen Elara slams her goblet in the Secret Backroom.',
          imagePrompt: 'Queen Elara slams her goblet in the Secret Backroom.',
          video_prompt: 'Queen Elara slams her goblet in the Secret Backroom.',
          videoPrompt: 'Queen Elara slams her goblet in the Secret Backroom.',
          characters: ['Queen Elara'],
          character_asset_ids: ['char-queen'],
          location: 'Secret Backroom',
          location_asset_id: 'scene-backroom',
          location_source: 'explicit',
        },
        {
          panelIndex: 1,
          panel_number: 2,
          description: 'The Messenger kneels before Queen Elara.',
          source_text: 'The Messenger kneels before Queen Elara.',
          imagePrompt: 'The Messenger kneels before Queen Elara.',
          video_prompt: 'The Messenger kneels before Queen Elara.',
          videoPrompt: 'The Messenger kneels before Queen Elara.',
          characters: ['Queen Elara', 'Messenger'],
          character_asset_ids: ['char-queen', 'char-messenger'],
          location: 'Secret Backroom',
          location_asset_id: 'scene-backroom',
          location_source: 'inherited',
        },
        {
          panelIndex: 2,
          panel_number: 3,
          description: 'A noble whispers in fear.',
          source_text: 'A noble whispers in fear.',
          imagePrompt: 'A noble whispers in fear.',
          video_prompt: 'A noble whispers in fear.',
          videoPrompt: 'A noble whispers in fear.',
          characters: [],
          character_asset_ids: [],
          location: 'Secret Backroom',
          location_asset_id: 'scene-backroom',
          location_source: 'inherited',
        },
      ],
      summary: 'Split script into 3 shots using line mode.',
    })
    expect(result.message).toBe('Created 3 shots.')
    expect(result.metadata).toEqual(expect.objectContaining({
      splitMode: 'line',
      locationBindingMode: 'inherit-last',
      shotCount: 3,
      matchedCharacterCount: 3,
      matchedLocationCount: 3,
      explicitLocationMatchCount: 1,
      inheritedLocationMatchCount: 2,
    }))
  })

  it('splits scripts by sentence and respects maxShots', async () => {
    const result = await executeShotSplitter(createContext({
      config: {
        splitMode: 'sentence',
        maxShots: 2,
      },
      inputs: {
        text: 'Queen Elara looks up. The Messenger bursts in! The nobles recoil in fear?',
      },
    }))

    expect(result.outputs).toEqual({
      panels: [
        expect.objectContaining({
          panelIndex: 0,
          panel_number: 1,
          source_text: 'Queen Elara looks up.',
        }),
        expect.objectContaining({
          panelIndex: 1,
          panel_number: 2,
          source_text: 'The Messenger bursts in!',
        }),
      ],
      summary: 'Split script into 2 shots using sentence mode.',
    })
  })

  it('keeps locations empty when location binding mode is explicit-only', async () => {
    const result = await executeShotSplitter(createContext({
      config: {
        splitMode: 'line',
        maxShots: 24,
        locationBindingMode: 'explicit-only',
      },
      inputs: {
        text: [
          'Queen Elara slams her goblet in the Secret Backroom.',
          'The Messenger kneels before Queen Elara.',
        ].join('\n'),
        scenes: [
          { id: 'scene-backroom', name: 'Secret Backroom' },
        ],
      },
    }))

    expect(result.outputs).toEqual({
      panels: [
        expect.objectContaining({
          panelIndex: 0,
          location: 'Secret Backroom',
          location_asset_id: 'scene-backroom',
          location_source: 'explicit',
        }),
        expect.objectContaining({
          panelIndex: 1,
          location: '',
          location_asset_id: '',
          location_source: 'none',
        }),
      ],
      summary: 'Split script into 2 shots using line mode.',
    })
    expect(result.metadata).toEqual(expect.objectContaining({
      locationBindingMode: 'explicit-only',
      matchedLocationCount: 1,
      explicitLocationMatchCount: 1,
      inheritedLocationMatchCount: 0,
    }))
  })

  it('keeps matching by character and scene name when asset ids are unavailable', async () => {
    const result = await executeShotSplitter(createContext({
      inputs: {
        text: 'Queen Elara orders everyone to gather in the Secret Backroom.',
        characters: [
          { name: 'Queen Elara', aliases: ['Empress Elara'] },
        ],
        scenes: [
          { name: 'Secret Backroom' },
        ],
      },
    }))

    expect(result.outputs).toEqual({
      panels: [
        expect.objectContaining({
          panelIndex: 0,
          characters: ['Queen Elara'],
          character_asset_ids: [],
          location: 'Secret Backroom',
          location_asset_id: '',
          location_source: 'explicit',
        }),
      ],
      summary: 'Split script into 1 shot using line mode.',
    })
    expect(result.metadata).toEqual(expect.objectContaining({
      shotCount: 1,
      matchedCharacterCount: 1,
      matchedLocationCount: 1,
    }))
  })

  it('fails explicitly when no script text is provided', async () => {
    await expect(executeShotSplitter(createContext({
      inputs: {
        text: '   ',
      },
    }))).rejects.toThrow('Input text is required for shot splitting.')
  })
})
