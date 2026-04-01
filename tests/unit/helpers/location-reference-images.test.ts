import { describe, expect, it } from 'vitest'
import {
  buildLocationImageSeeds,
  normalizeLocationReferenceImageUrls,
} from '@/lib/asset-hub/location-reference-images'

describe('normalizeLocationReferenceImageUrls', () => {
  it('keeps up to five non-empty image references', () => {
    expect(
      normalizeLocationReferenceImageUrls([
        ' https://example.com/a.png ',
        '',
        'cos/location-b.png',
        '   ',
        'cos/location-c.png',
        'cos/location-d.png',
        'cos/location-e.png',
        'cos/location-f.png',
      ]),
    ).toEqual([
      'https://example.com/a.png',
      'cos/location-b.png',
      'cos/location-c.png',
      'cos/location-d.png',
      'cos/location-e.png',
    ])
  })

  it('supports a single string reference', () => {
    expect(normalizeLocationReferenceImageUrls(' cos/location-a.png ')).toEqual(['cos/location-a.png'])
  })
})

describe('buildLocationImageSeeds', () => {
  it('creates selected image rows from uploaded references', () => {
    expect(
      buildLocationImageSeeds({
        name: 'Secret Backroom',
        summary: 'Stone room with candles',
        referenceImageUrls: ['cos/location-a.png', 'cos/location-b.png'],
      }),
    ).toEqual([
      {
        imageIndex: 0,
        description: 'Stone room with candles',
        imageUrl: 'cos/location-a.png',
        isSelected: true,
      },
      {
        imageIndex: 1,
        description: 'Stone room with candles',
        imageUrl: 'cos/location-b.png',
        isSelected: false,
      },
    ])
  })

  it('creates empty generation slots when no references were uploaded', () => {
    expect(
      buildLocationImageSeeds({
        name: 'Secret Backroom',
        summary: null,
        referenceImageUrls: [],
      }),
    ).toEqual([
      {
        imageIndex: 0,
        description: 'Secret Backroom',
        imageUrl: null,
        isSelected: false,
      },
      {
        imageIndex: 1,
        description: 'Secret Backroom',
        imageUrl: null,
        isSelected: false,
      },
      {
        imageIndex: 2,
        description: 'Secret Backroom',
        imageUrl: null,
        isSelected: false,
      },
    ])
  })
})
