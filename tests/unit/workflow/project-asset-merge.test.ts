import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import {
  collectWorkflowAssetCandidates,
  mergeWorkflowCharactersIntoProject,
  mergeWorkflowScenesIntoProject,
} from '@/lib/workflows/project-asset-merge'

describe('project asset merge bridge', () => {
  it('collects only completed extraction outputs and dedupes alias-matched candidates', () => {
    const candidates = collectWorkflowAssetCandidates({
      nodes: [
        { id: 'char_1', data: { nodeType: 'character-extract' } },
        { id: 'scene_running', data: { nodeType: 'scene-extract' } },
        { id: 'scene_done', data: { nodeType: 'scene-extract' } },
      ],
      nodeOutputs: {
        char_1: {
          characters: [
            { name: 'Lin Mo', aliases: ['I'], introduction: 'Main hero' },
            { name: 'I', aliases: ['Lin Mo', 'Boss'], introduction: 'First person narrator' },
          ],
          updatedCharacters: [
            { name: 'Lin Mo', updated_aliases: ['Mr Lin'], updated_introduction: 'Main hero, husband of Su Qing' },
          ],
        },
        scene_running: {
          scenes: [{ name: 'Ignored Scene', summary: 'Should not be collected' }],
        },
        scene_done: {
          scenes: [
            {
              name: 'City Hall/Main Hall',
              descriptions: ['[City Hall] marble hall'],
            },
            {
              name: 'Main Hall',
              descriptions: ['[Main Hall] podium area'],
            },
          ],
        },
      },
      nodeExecutionStates: {
        char_1: { status: 'completed' },
        scene_running: { status: 'running' },
        scene_done: { status: 'completed' },
      },
    })

    expect(candidates.characters).toEqual([
      expect.objectContaining({
        name: 'Lin Mo',
        aliases: expect.arrayContaining(['I', 'Boss']),
      }),
    ])
    expect(candidates.updatedCharacters).toEqual([
      {
        name: 'Lin Mo',
        updated_aliases: ['Mr Lin'],
        updated_introduction: 'Main hero, husband of Su Qing',
      },
    ])
    expect(candidates.scenes).toEqual([
      expect.objectContaining({
        name: 'City Hall/Main Hall',
        descriptions: ['[City Hall] marble hall', '[Main Hall] podium area'],
      }),
    ])
  })

  it('ignores extraction outputs when node execution status is missing', () => {
    const candidates = collectWorkflowAssetCandidates({
      nodes: [
        { id: 'char_without_state', data: { nodeType: 'character-extract' } },
        { id: 'scene_without_state', data: { nodeType: 'scene-extract' } },
      ],
      nodeOutputs: {
        char_without_state: {
          characters: [{ name: 'Ghost Character', aliases: [], introduction: 'Should be ignored' }],
        },
        scene_without_state: {
          scenes: [{ name: 'Ghost Scene', descriptions: ['Should be ignored'] }],
        },
      },
      nodeExecutionStates: {},
    })

    expect(candidates.characters).toEqual([])
    expect(candidates.updatedCharacters).toEqual([])
    expect(candidates.scenes).toEqual([])
  })

  it('merges workflow characters into existing project records with alias-aware matching', async () => {
    const mockFindMany = vi.fn().mockResolvedValue([
      {
        id: 'char_existing',
        name: 'Lin Mo',
        aliases: JSON.stringify(['I']),
        introduction: 'Main hero',
        profileData: JSON.stringify({
          role_level: 'S',
          personality_tags: ['calm'],
        }),
      },
    ])
    const mockCreate = vi.fn().mockResolvedValue({
      id: 'char_new',
      name: 'Su Qing',
      aliases: JSON.stringify(['Qing']),
      introduction: 'Female lead',
      profileData: JSON.stringify({ role_level: 'A' }),
    })
    const mockUpdate = vi.fn().mockResolvedValue({})

    const tx = {
      novelPromotionCharacter: {
        findMany: mockFindMany,
        create: mockCreate,
        update: mockUpdate,
      },
    } as unknown as Prisma.TransactionClient

    const stats = await mergeWorkflowCharactersIntoProject({
      tx,
      projectInternalId: 'np_project_1',
      characters: [
        {
          name: 'I',
          aliases: ['Lin Mo', 'Boss'],
          introduction: 'Main hero',
          role_level: 'S',
          archetype: '',
          personality_tags: ['strategic'],
          era_period: '',
          social_class: '',
          occupation: '',
          costume_tier: null,
          suggested_colors: [],
          primary_identifier: '',
          visual_keywords: [],
          gender: '',
          age_range: '',
        },
        {
          name: 'Su Qing',
          aliases: ['Qing'],
          introduction: 'Female lead',
          role_level: 'A',
          archetype: '',
          personality_tags: [],
          era_period: '',
          social_class: '',
          occupation: '',
          costume_tier: null,
          suggested_colors: [],
          primary_identifier: '',
          visual_keywords: [],
          gender: '',
          age_range: '',
        },
      ],
      updatedCharacters: [
        {
          name: 'Lin Mo',
          updated_aliases: ['Mr Lin'],
          updated_introduction: 'Main hero and husband',
        },
      ],
    })

    expect(stats).toEqual({
      inputCount: 2,
      updateHintCount: 1,
      created: 1,
      updated: 2,
      skipped: 0,
      matched: 1,
    })
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: 'Su Qing',
        aliases: JSON.stringify(['Qing']),
      }),
    }))
    expect(mockUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: 'char_existing' },
      data: expect.objectContaining({
        aliases: JSON.stringify(['I', 'Boss']),
      }),
    }))
    expect(mockUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: 'char_existing' },
      data: expect.objectContaining({
        aliases: JSON.stringify(['I', 'Boss', 'Mr Lin']),
      }),
    }))
  })

  it('merges workflow scenes into project locations and appends only missing descriptions', async () => {
    const mockFindMany = vi.fn().mockResolvedValue([
      {
        id: 'loc_existing',
        name: 'City Hall/Main Hall',
        summary: '',
        selectedImageId: null,
        images: [
          { id: 'img_existing', imageIndex: 0, description: '[City Hall] old desc' },
        ],
      },
    ])

    const mockLocationCreate = vi.fn().mockResolvedValue({
      id: 'loc_new',
      name: 'Rooftop',
      summary: 'Night rooftop',
      selectedImageId: null,
    })
    const mockLocationUpdate = vi.fn().mockResolvedValue({})

    const mockLocationImageCreate = vi.fn()
      .mockResolvedValueOnce({
        id: 'img_new_for_existing',
        imageIndex: 1,
        description: '[Main Hall] podium',
      })
      .mockResolvedValueOnce({
        id: 'img_new_location_0',
        imageIndex: 0,
        description: '[Rooftop] open sky',
      })

    const tx = {
      novelPromotionLocation: {
        findMany: mockFindMany,
        create: mockLocationCreate,
        update: mockLocationUpdate,
      },
      locationImage: {
        create: mockLocationImageCreate,
      },
    } as unknown as Prisma.TransactionClient

    const stats = await mergeWorkflowScenesIntoProject({
      tx,
      projectInternalId: 'np_project_1',
      scenes: [
        {
          name: 'Main Hall',
          summary: 'Official hall',
          description: '[Main Hall] podium',
          descriptions: ['[Main Hall] podium'],
        },
        {
          name: '幻想空间',
          summary: '抽象空间',
          description: '抽象空间',
          descriptions: ['抽象空间'],
        },
        {
          name: 'Rooftop',
          summary: 'Night rooftop',
          description: '[Rooftop] open sky',
          descriptions: ['[Rooftop] open sky'],
        },
      ],
    })

    expect(stats).toEqual({
      inputCount: 3,
      created: 1,
      updated: 1,
      skipped: 1,
      matched: 1,
      createdDescriptions: 2,
    })
    expect(mockLocationImageCreate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        locationId: 'loc_existing',
        imageIndex: 1,
        description: '[Main Hall] podium',
      }),
    }))
    expect(mockLocationUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: 'loc_existing' },
      data: { selectedImageId: 'img_new_for_existing' },
    }))
    expect(mockLocationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: 'Rooftop',
      }),
    }))
  })
})
