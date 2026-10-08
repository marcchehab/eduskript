import { describe, it, expect } from 'vitest'
import { gunzipSync } from 'zlib'
import { encodeSEBFile } from '@/lib/seb-file'
import { getPublicOrigin } from '@/lib/public-origin'

describe('encodeSEBFile', () => {
  it('produces gzip("plnd" + gzip(xml))', () => {
    const xml = '<?xml version="1.0"?><plist><dict/></plist>'
    const outer = gunzipSync(encodeSEBFile(xml))
    expect(outer.subarray(0, 4).toString()).toBe('plnd')
    expect(gunzipSync(outer.subarray(4)).toString()).toBe(xml)
  })
})

describe('getPublicOrigin', () => {
  const req = (h: Record<string, string>) => ({
    headers: new Headers(h),
    nextUrl: { origin: 'https://0.0.0.0:3000' },
  })

  it('prefers forwarded host and proto', () => {
    expect(getPublicOrigin(req({ host: '0.0.0.0:3000', 'x-forwarded-host': 'eduskript.org', 'x-forwarded-proto': 'https' })))
      .toBe('https://eduskript.org')
  })
  it('falls back to host header', () => {
    expect(getPublicOrigin(req({ host: 'informatikgarten.ch' }))).toBe('https://informatikgarten.ch')
    expect(getPublicOrigin(req({ host: 'localhost:3000' }))).toBe('http://localhost:3000')
  })
})
