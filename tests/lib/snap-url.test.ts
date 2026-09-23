import { describe, it, expect } from 'vitest'
import { snapImageSrc } from '@/lib/snap-url'

describe('snapImageSrc', () => {
  it('rewrites S3 snap URLs to the access-checked proxy', () => {
    expect(snapImageSrc('https://s3.fr-par.scw.cloud/eduskript-user/snaps/u1/p1/s1.png'))
      .toBe('/api/snaps/image/snaps/u1/p1/s1.png')
  })

  it('passes data URLs and other URLs through', () => {
    expect(snapImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(snapImageSrc('/api/files/abc')).toBe('/api/files/abc')
  })
})
