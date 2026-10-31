import { describe, it, expect } from 'vitest'
import { pluginThumbnailKey, thumbnailCrop, withoutThumbnailKey } from '@/lib/plugin-thumbnail'

const KEY = `files/${'a'.repeat(64)}.webp`

describe('pluginThumbnailKey', () => {
  it('returns a well-formed key', () => {
    expect(pluginThumbnailKey({ thumbnailKey: KEY })).toBe(KEY)
  })

  it.each([
    [null], [undefined], [{}],
    [{ thumbnailKey: 5 }],
    [{ thumbnailKey: 'https://evil.test/x.webp' }],
    [{ thumbnailKey: `files/${'a'.repeat(64)}.svg` }],
    [{ thumbnailKey: '../files/abc.webp' }],
  ])('rejects %j', (manifest) => {
    expect(pluginThumbnailKey(manifest)).toBeNull()
  })
})

describe('withoutThumbnailKey', () => {
  it('drops only the key and leaves the input unchanged', () => {
    const input = { defaultHeight: 300, thumbnailKey: KEY }
    expect(withoutThumbnailKey(input)).toEqual({ defaultHeight: 300 })
    expect(input.thumbnailKey).toBe(KEY)
  })
})

describe('thumbnailCrop', () => {
  it('keeps the top of a tall screenshot', () => {
    expect(thumbnailCrop(1000, 2000)).toEqual({ sx: 0, sy: 0, sw: 1000, sh: 625, width: 480, height: 300 })
  })

  it('centres a wide screenshot', () => {
    expect(thumbnailCrop(2000, 500)).toEqual({ sx: 600, sy: 0, sw: 800, sh: 500, width: 480, height: 300 })
  })

  it('does not enlarge a small image', () => {
    expect(thumbnailCrop(160, 100)).toEqual({ sx: 0, sy: 0, sw: 160, sh: 100, width: 160, height: 100 })
  })
})
