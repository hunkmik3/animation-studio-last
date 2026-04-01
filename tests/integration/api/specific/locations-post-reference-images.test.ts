import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  globalAssetFolder: {
    findUnique: vi.fn(),
  },
  globalLocation: {
    create: vi.fn(async () => ({ id: 'location-1', userId: 'user-1' })),
    findUnique: vi.fn(async () => ({
      id: 'location-1',
      userId: 'user-1',
      name: 'Secret Backroom',
      images: [],
    })),
  },
  globalLocationImage: {
    createMany: vi.fn(async () => ({ count: 2 })),
  },
}))

const mediaAttachMock = vi.hoisted(() => ({
  attachMediaFieldsToGlobalLocation: vi.fn(async (value: unknown) => value),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/attach', () => mediaAttachMock)

describe('api specific - locations POST reference images', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.globalAssetFolder.findUnique.mockResolvedValue(null)
  })

  it('stores uploaded references as initial location images and skips background generation', async () => {
    const fetchMock = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const mod = await import('@/app/api/asset-hub/locations/route')
    const req = buildMockRequest({
      path: '/api/asset-hub/locations',
      method: 'POST',
      headers: {
        'accept-language': 'en-US,en;q=0.9',
      },
      body: {
        name: 'Secret Backroom',
        summary: 'Stone room with candles',
        referenceImageUrls: ['cos/location-a.png', 'cos/location-b.png'],
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    expect(prismaMock.globalLocationImage.createMany).toHaveBeenCalledWith({
      data: [
        {
          locationId: 'location-1',
          imageIndex: 0,
          description: 'Stone room with candles',
          imageUrl: 'cos/location-a.png',
          isSelected: true,
        },
        {
          locationId: 'location-1',
          imageIndex: 1,
          description: 'Stone room with candles',
          imageUrl: 'cos/location-b.png',
          isSelected: false,
        },
      ],
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
