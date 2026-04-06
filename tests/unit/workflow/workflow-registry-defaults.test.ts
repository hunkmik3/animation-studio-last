import { describe, expect, it } from 'vitest'
import { NODE_TYPE_REGISTRY } from '@/lib/workflow-engine/registry'

describe('workflow registry defaults', () => {
  it('uses google as the default provider for image-generate nodes', () => {
    const imageNode = NODE_TYPE_REGISTRY['image-generate']
    expect(imageNode?.defaultConfig).toEqual(expect.objectContaining({
      provider: 'google',
    }))

    const providerField = imageNode?.configFields.find((field) => field.key === 'provider')
    const providerOptions = providerField?.type === 'select' ? providerField.options : []
    expect(providerOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'google' }),
    ]))
  })
})
