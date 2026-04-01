import { describe, expect, it } from 'vitest'
import enAssets from '../../../messages/en/assets.json'
import zhAssets from '../../../messages/zh/assets.json'

interface CharacterMessages {
  readonly appearance?: string
}

interface AssetsMessages {
  readonly character?: CharacterMessages
}

function readCharacterAppearanceLabel(messages: AssetsMessages): string | undefined {
  return messages.character?.appearance
}

describe('asset hub messages', () => {
  it('defines the character appearance label in English', () => {
    expect(readCharacterAppearanceLabel(enAssets as AssetsMessages)).toBe('Appearance')
  })

  it('defines the character appearance label in Chinese', () => {
    expect(readCharacterAppearanceLabel(zhAssets as AssetsMessages)).toBe('形象')
  })
})
