import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(),
  },
}))

const decryptApiKeyMock = vi.hoisted(() => vi.fn((value: string) => `decrypted:${value}`))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/crypto-utils', () => ({
  decryptApiKey: decryptApiKeyMock,
}))

import { getProviderConfig } from '@/lib/api-config'

describe('api-config google env fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GOOGLE_API_KEY
    delete process.env.GEMINI_API_KEY
    prismaMock.userPreference.findUnique.mockResolvedValue({
      customModels: '[]',
      customProviders: '[]',
    })
  })

  it('prioritizes GOOGLE_API_KEY over stored provider key for google provider', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue({
      customModels: '[]',
      customProviders: JSON.stringify([
        {
          id: 'google',
          name: 'Google AI Studio',
          apiKey: 'encrypted-google-key',
        },
      ]),
    })
    process.env.GOOGLE_API_KEY = 'env-google-key'

    const config = await getProviderConfig('user_1', 'google')

    expect(config.apiKey).toBe('env-google-key')
    expect(decryptApiKeyMock).not.toHaveBeenCalled()
  })

  it('uses GOOGLE_API_KEY when provider exists but key is empty', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue({
      customModels: '[]',
      customProviders: JSON.stringify([
        {
          id: 'google',
          name: 'Google AI Studio',
        },
      ]),
    })
    process.env.GOOGLE_API_KEY = 'env-google-key'

    const config = await getProviderConfig('user_1', 'google')

    expect(config.apiKey).toBe('env-google-key')
    expect(decryptApiKeyMock).not.toHaveBeenCalled()
  })

  it('uses GOOGLE_API_KEY when google provider is missing in user config', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue({
      customModels: '[]',
      customProviders: JSON.stringify([
        {
          id: 'fal',
          name: 'FAL',
          apiKey: 'encrypted-fal-key',
        },
      ]),
    })
    process.env.GOOGLE_API_KEY = 'env-google-key'

    const config = await getProviderConfig('user_1', 'google')

    expect(config).toEqual({
      id: 'google',
      name: 'google',
      apiKey: 'env-google-key',
    })
  })

  it('throws when google provider key is missing and env key is not set', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue({
      customModels: '[]',
      customProviders: JSON.stringify([
        {
          id: 'google',
          name: 'Google AI Studio',
        },
      ]),
    })

    await expect(getProviderConfig('user_1', 'google')).rejects.toThrow('PROVIDER_API_KEY_MISSING: google')
  })
})
