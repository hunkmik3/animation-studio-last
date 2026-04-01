import { describe, expect, it } from 'vitest'
import {
  buildWorkflowCharacterAssetOutputs,
  buildWorkflowLocationAssetOutputs,
} from '@/lib/workflow-engine/reference-assets'

describe('workflow reference asset helpers', () => {
  it('builds character asset outputs around the selected primary appearance image', () => {
    const result = buildWorkflowCharacterAssetOutputs([
      {
        id: 'char_1',
        name: 'Queen Elara',
        aliases: JSON.stringify(['Empress Elara']),
        appearances: [
          {
            id: 'appearance_1',
            appearanceIndex: 0,
            changeReason: 'Primary',
            description: 'Royal blue gown with silver crown',
            imageUrl: '/m/fallback-queen.png',
            imageUrls: ['/m/queen-front.png', '/m/queen-side.png'],
            selectedIndex: 1,
          },
        ],
      },
    ])

    expect(result.summary).toBe('Loaded 1 character asset from Asset Hub.')
    expect(result.characters).toEqual([
      {
        id: 'char_1',
        assetId: 'char_1',
        name: 'Queen Elara',
        aliases: ['Empress Elara'],
        introduction: 'Royal blue gown with silver crown',
        appearance: 'Royal blue gown with silver crown',
        referenceSource: 'asset-hub',
        referenceAssetType: 'character',
        referenceImageUrl: '/m/queen-side.png',
        referenceImageUrls: ['/m/queen-side.png', '/m/queen-front.png', '/m/fallback-queen.png'],
        selectedImageUrl: '/m/queen-side.png',
        selectedAppearanceId: 'appearance_1',
        expected_appearances: [
          {
            id: 'appearance_1',
            change_reason: 'Primary',
            description: 'Royal blue gown with silver crown',
          },
        ],
      },
    ])
  })

  it('builds location asset outputs around the selected scene image', () => {
    const result = buildWorkflowLocationAssetOutputs([
      {
        id: 'loc_1',
        name: 'Secret Backroom',
        summary: 'Private strategy room beneath the palace.',
        images: [
          {
            id: 'image_1',
            imageIndex: 0,
            description: 'Wide shot of a candlelit war room',
            imageUrl: '/m/war-room-wide.png',
            isSelected: false,
          },
          {
            id: 'image_2',
            imageIndex: 1,
            description: 'Closer angle on the table and maps',
            imageUrl: '/m/war-room-close.png',
            isSelected: true,
          },
        ],
      },
    ])

    expect(result.summary).toBe('Loaded 1 location asset from Asset Hub.')
    expect(result.scenes).toEqual([
      {
        id: 'loc_1',
        assetId: 'loc_1',
        name: 'Secret Backroom',
        summary: 'Private strategy room beneath the palace.',
        description: 'Closer angle on the table and maps',
        descriptions: ['Wide shot of a candlelit war room', 'Closer angle on the table and maps'],
        referenceSource: 'asset-hub',
        referenceAssetType: 'scene',
        referenceImageUrl: '/m/war-room-close.png',
        selectedImageUrl: '/m/war-room-close.png',
        selectedLocationImageId: 'image_2',
      },
    ])
    expect(result.locations).toEqual(result.scenes)
  })
})
