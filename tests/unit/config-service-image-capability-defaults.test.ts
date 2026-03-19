import { describe, expect, it } from 'vitest'
import {
  buildImageBillingPayloadFromUserConfig,
  resolveModelCapabilityGenerationOptions,
  type UserModelConfig,
} from '@/lib/config-service'

const EMPTY_USER_CONFIG: UserModelConfig = {
  analysisModel: null,
  characterModel: null,
  locationModel: null,
  storyboardModel: null,
  editModel: null,
  videoModel: null,
  capabilityDefaults: {},
}

describe('buildImageBillingPayloadFromUserConfig', () => {
  it('auto fills a supported resolution when model requires it and user config has no capability defaults', () => {
    const payload = buildImageBillingPayloadFromUserConfig({
      userModelConfig: EMPTY_USER_CONFIG,
      imageModel: 'fal::banana-2',
      basePayload: {
        type: 'character',
        id: 'character-1',
      },
    })

    expect(payload.imageModel).toBe('fal::banana-2')
    expect(payload.generationOptions).toEqual(
      expect.objectContaining({
        resolution: '2K',
      }),
    )
  })

  it('respects explicit resolution from request payload over auto-filled defaults', () => {
    const payload = buildImageBillingPayloadFromUserConfig({
      userModelConfig: EMPTY_USER_CONFIG,
      imageModel: 'fal::banana-2',
      basePayload: {
        type: 'character',
        id: 'character-2',
        resolution: '1K',
      },
    })

    expect(payload.generationOptions).toEqual(
      expect.objectContaining({
        resolution: '1K',
      }),
    )
  })

  it('auto fills required resolution for direct capability resolution calls used by storyboard routes', () => {
    const options = resolveModelCapabilityGenerationOptions({
      modelType: 'image',
      modelKey: 'fal::banana-2',
    })

    expect(options).toEqual(
      expect.objectContaining({
        resolution: '2K',
      }),
    )
  })
})
