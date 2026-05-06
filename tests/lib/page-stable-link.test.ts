import { describe, it, expect } from 'vitest'
import {
  isStableLink,
  parseStableLink,
  extractStableLinkIds,
} from '@/lib/page-stable-link'

describe('page-stable-link', () => {
  describe('isStableLink', () => {
    it('matches /p/-prefixed hrefs', () => {
      expect(isStableLink('/p/cmnbxf63m000ogfc7rf5s2znp')).toBe(true)
      expect(isStableLink('/p/anything')).toBe(true)
    })

    it('rejects non-stable links', () => {
      expect(isStableLink('https://example.com')).toBe(false)
      expect(isStableLink('/page')).toBe(false)
      expect(isStableLink('/profile/foo')).toBe(false)
      expect(isStableLink('p/abc')).toBe(false) // no leading slash
    })
  })

  describe('parseStableLink', () => {
    it('extracts the id', () => {
      expect(parseStableLink('/p/cmnbxf63m000ogfc7rf5s2znp'))
        .toBe('cmnbxf63m000ogfc7rf5s2znp')
    })

    it('strips trailing query and fragment', () => {
      expect(parseStableLink('/p/abc123?foo=bar')).toBe('abc123')
      expect(parseStableLink('/p/abc123#section')).toBe('abc123')
      expect(parseStableLink('/p/abc123/extra')).toBe('abc123')
    })

    it('returns null for non-stable links', () => {
      expect(parseStableLink('https://example.com')).toBeNull()
      expect(parseStableLink('/p/')).toBeNull()
    })
  })

  describe('extractStableLinkIds', () => {
    it('finds ids inside markdown links', () => {
      const md = 'See [chapter 3](/p/cmnbxf63m000ogfc7rf5s2znp) and [intro](/p/abcdefghij1234567890).'
      expect(extractStableLinkIds(md).sort()).toEqual([
        'abcdefghij1234567890',
        'cmnbxf63m000ogfc7rf5s2znp',
      ])
    })

    it('dedupes repeated ids', () => {
      const id = 'cmnbxf63m000ogfc7rf5s2znp'
      const md = `[a](/p/${id}) [b](/p/${id})`
      expect(extractStableLinkIds(md)).toEqual([id])
    })

    it('ignores too-short paths that look like /p/X', () => {
      // Loose regex requires {16,} chars — short paths slip through
      expect(extractStableLinkIds('[x](/p/short)')).toEqual([])
      expect(extractStableLinkIds('[x](/p/abc)')).toEqual([])
    })

    it('finds ids in raw HTML href values', () => {
      const md = '<a href="/p/cmnbxf63m000ogfc7rf5s2znp">link</a>'
      expect(extractStableLinkIds(md)).toEqual(['cmnbxf63m000ogfc7rf5s2znp'])
    })

    it('returns empty for content without stable links', () => {
      expect(extractStableLinkIds('# Title\n\nNo links here.')).toEqual([])
      expect(extractStableLinkIds('[external](https://example.com)')).toEqual([])
    })
  })
})
