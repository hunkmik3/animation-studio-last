import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeExecutorContext } from '@/lib/workflow-engine/executors'
import { LEGACY_CHARACTER_EXTRACT_PROMPT } from '@/lib/workflow-engine/executors/extraction-bridge'

const mockChatCompletion = vi.fn()

vi.mock('@/lib/llm/chat-completion', () => ({
  chatCompletion: mockChatCompletion,
}))

function createBaseContext(overrides?: Partial<NodeExecutorContext>): NodeExecutorContext {
  return {
    nodeId: 'node_test',
    nodeType: 'character-extract',
    config: {},
    inputs: { text: 'Story content for extraction.' },
    projectId: 'project_1',
    userId: 'user_1',
    locale: 'en',
    modelConfig: {
      analysisModel: 'google/gemini-3-pro-preview',
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
    },
    ...overrides,
  }
}

describe('workflow character/scene parity bridge executors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('auto-upgrades legacy character prompt to production template and dedupes alias-matched characters', async () => {
    const { executeCharacterExtract } = await import('@/lib/workflow-engine/executors/character-extract')
    mockChatCompletion.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            new_characters: [
              {
                name: 'Lin Mo',
                aliases: ['I', 'Mr Lin'],
                introduction: 'Main protagonist narrated in first person.',
                role_level: 'S',
                personality_tags: ['calm', 'strategic'],
                visual_keywords: ['scar', 'long coat'],
                suggested_colors: ['blue', 'black'],
                expected_appearances: [{ id: 1, change_reason: 'initial appearance' }],
              },
              {
                name: 'I',
                aliases: ['Lin Mo'],
                introduction: 'First-person pronoun reference.',
                role_level: 'S',
              },
            ],
            updated_characters: [
              {
                name: 'Lin Mo',
                updated_introduction: 'Discovered spouse mapping.',
                updated_aliases: ['Boss Lin'],
              },
            ],
          }),
        },
      }],
    })

    const result = await executeCharacterExtract(createBaseContext({
      config: { prompt: LEGACY_CHARACTER_EXTRACT_PROMPT },
    }))

    const outputs = result.outputs as Record<string, unknown>
    const characters = outputs.characters as Array<Record<string, unknown>>
    const updatedCharacters = outputs.updatedCharacters as Array<Record<string, unknown>>
    const warnings = outputs.warnings as string[]

    expect(characters.length).toBe(1)
    expect(characters[0].name).toBe('Lin Mo')
    expect(characters[0].aliases).toEqual(expect.arrayContaining(['I', 'Mr Lin']))
    expect(characters[0].role_level).toBe('S')
    expect(characters[0].expected_appearances).toEqual([
      { id: 1, change_reason: 'initial appearance' },
    ])
    expect(updatedCharacters).toEqual([
      {
        name: 'Lin Mo',
        updated_introduction: 'Discovered spouse mapping.',
        updated_aliases: ['Boss Lin'],
      },
    ])
    expect(warnings.some((item) => item.includes('auto-upgraded'))).toBe(true)
    expect(result.metadata?.promptMode).toBe('production-template')
    expect(result.metadata?.parseMode).toBe('production-structured')
    expect(result.temporaryImplementation).toBe(true)

    const userMessage = (
      mockChatCompletion.mock.calls[0]?.[2] as Array<{ role: string; content: string }>
    )[1]?.content
    expect(userMessage).toContain('Existing character library info')
  })

  it('filters invalid scenes and dedupes alias-equivalent locations with merged descriptions', async () => {
    const { executeSceneExtract } = await import('@/lib/workflow-engine/executors/scene-extract')
    mockChatCompletion.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            locations: [
              {
                name: 'City Hall/Main Hall',
                summary: 'Official administrative hall.',
                descriptions: [
                  '[City Hall] Wide marble hall with high ceiling.',
                  '[City Hall] Side entrance and waiting area.',
                ],
              },
              {
                name: 'Main Hall',
                summary: 'Same place with alternate naming.',
                descriptions: [
                  '[Main Hall] Podium and audience seats.',
                ],
              },
              {
                name: '幻想空间',
                summary: '抽象空间，无法具象化',
                descriptions: ['抽象场域'],
              },
            ],
          }),
        },
      }],
    })

    const result = await executeSceneExtract(createBaseContext({
      nodeType: 'scene-extract',
      config: { prompt: '' },
    }))

    const outputs = result.outputs as Record<string, unknown>
    const scenes = outputs.scenes as Array<Record<string, unknown>>
    const locations = outputs.locations as Array<Record<string, unknown>>

    expect(scenes.length).toBe(1)
    expect(scenes[0].name).toBe('City Hall/Main Hall')
    expect(scenes[0].descriptions).toEqual([
      '[City Hall] Wide marble hall with high ceiling.',
      '[City Hall] Side entrance and waiting area.',
      '[Main Hall] Podium and audience seats.',
    ])
    expect(locations).toEqual(scenes)
    expect(result.metadata?.promptMode).toBe('production-template')
    expect(result.metadata?.parseMode).toBe('production-structured')
  })

  it('marks character extraction as custom-override when user provides a custom prompt', async () => {
    const { executeCharacterExtract } = await import('@/lib/workflow-engine/executors/character-extract')
    mockChatCompletion.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify([
            {
              name: 'Custom Hero',
              role: 'protagonist',
              appearance: 'silver armor',
            },
          ]),
        },
      }],
    })

    const result = await executeCharacterExtract(createBaseContext({
      config: {
        prompt: 'Custom extraction rules.\nText:\n{input}\nOutput JSON array.',
      },
    }))

    const outputs = result.outputs as Record<string, unknown>
    const characters = outputs.characters as Array<Record<string, unknown>>

    expect(characters.length).toBe(1)
    expect(characters[0].name).toBe('Custom Hero')
    expect(result.metadata?.promptMode).toBe('custom-override')
    expect(result.parityNotes?.includes('Custom prompt override enabled')).toBe(true)
  })
})
