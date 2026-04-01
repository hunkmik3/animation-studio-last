import { describe, expect, it } from 'vitest'
import { getAssetCardEmptyStateConfig } from '@/app/[locale]/workspace/asset-hub/components/asset-card-empty-state'

describe('getAssetCardEmptyStateConfig', () => {
  it('exposes upload before generate for character cards without an image', () => {
    expect(getAssetCardEmptyStateConfig('character')).toEqual({
      iconName: 'image',
      actions: ['upload', 'generate'],
    })
  })

  it('exposes upload before generate for location cards without an image', () => {
    expect(getAssetCardEmptyStateConfig('location')).toEqual({
      iconName: 'globe2',
      actions: ['upload', 'generate'],
    })
  })
})
