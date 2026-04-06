import { describe, expect, it } from 'vitest'
import { createEmptyWorkflowContinuityMemory } from '@/lib/workflow-engine/continuity-memory'
import { updateWorkflowContinuityMemoryFromImageNode } from '@/features/workflow-editor/continuity-memory-state'

describe('workflow continuity memory state updater', () => {
  it('updates character/location continuity memory from standalone image node output', () => {
    const result = updateWorkflowContinuityMemoryFromImageNode({
      memory: createEmptyWorkflowContinuityMemory(new Date('2026-04-01T00:00:00.000Z')),
      nodeId: 'storyboard_1__panel_2__image',
      nodeData: {
        continuityState: {
          panelIndex: 1,
          panelNumber: 2,
          sources: {
            characterReferences: [
              {
                referenceNodeId: 'character_ref_1',
                characterName: 'Clara Queen',
                characterAssetId: '',
                referenceSource: 'asset-hub',
                appearanceLockTokens: ['deep blue royal gown'],
                panelAppearanceHints: ['silver crown'],
                identityTokens: ['cold gaze'],
              },
            ],
            locationReference: {
              referenceNodeId: 'location_ref_1',
              locationName: 'Secret Backroom',
              locationAssetId: '',
              referenceSource: 'asset-hub',
              environmentLockTokens: ['stone fireplace', 'long wooden table'],
            },
          },
          identity: {
            characterNames: ['Clara Queen'],
            appearanceLockTokens: ['royal gown'],
            environmentLockTokens: ['candlelit war chamber'],
          },
        },
      },
      nodeOutputs: {
        character_ref_1: { image: '/m/clara-reference' },
        location_ref_1: { image: '/m/room-reference' },
      },
      resultOutputs: { image: '/m/panel-2-image' },
      executorMetadata: {
        continuityStrength: 'strong',
        continuitySourceKinds: ['character-reference', 'location-reference'],
      },
    })

    expect(result.changed).toBe(true)
    expect(result.memory.characters['name:clara queen']).toEqual(expect.objectContaining({
      canonicalName: 'Clara Queen',
      preferredReferenceImage: '/m/clara-reference',
      latestGoodImage: '/m/panel-2-image',
      continuityStrength: 'strong',
    }))
    expect(result.memory.locations['name:secret backroom']).toEqual(expect.objectContaining({
      locationName: 'Secret Backroom',
      preferredReferenceImage: '/m/room-reference',
      latestGoodImage: '/m/panel-2-image',
      environmentLockTokens: ['stone fireplace', 'long wooden table', 'candlelit war chamber'],
      continuityStrength: 'strong',
    }))
  })

  it('does not mutate continuity memory when usable image output is missing', () => {
    const initialMemory = createEmptyWorkflowContinuityMemory(new Date('2026-04-01T00:00:00.000Z'))
    const result = updateWorkflowContinuityMemoryFromImageNode({
      memory: initialMemory,
      nodeId: 'panel_missing',
      nodeData: {},
      nodeOutputs: {},
      resultOutputs: {},
      executorMetadata: {},
    })

    expect(result.changed).toBe(false)
    expect(result.memory).toEqual(initialMemory)
  })
})
