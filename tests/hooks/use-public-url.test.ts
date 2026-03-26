import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock isCustomDomainServer — we control the return value per test
let mockIsCustomDomain = false
vi.mock('@/lib/custom-domain', () => ({
  isCustomDomainServer: () => mockIsCustomDomain,
}))

// Minimal React mock — usePublicUrl uses useMemo which needs React
vi.mock('react', async () => {
  const actual = await vi.importActual('react')
  return {
    ...actual,
    useMemo: (fn: () => unknown) => fn(),
  }
})

import { usePublicUrl } from '@/hooks/use-public-url'

describe('usePublicUrl', () => {
  beforeEach(() => {
    mockIsCustomDomain = false
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('buildPageUrl (published content)', () => {
    it('should include pageSlug on main domain', () => {
      const { buildPageUrl } = usePublicUrl('eduadmin')
      expect(buildPageUrl('markdown-basics', 'headings-text'))
        .toBe('/eduadmin/markdown-basics/headings-text')
    })

    it('should omit pageSlug on custom domain', () => {
      mockIsCustomDomain = true
      const { buildPageUrl } = usePublicUrl('ig')
      expect(buildPageUrl('grundlagen', 'intro'))
        .toBe('/grundlagen/intro')
    })

    it('should handle undefined pageSlug gracefully', () => {
      const { buildPageUrl } = usePublicUrl(undefined)
      expect(buildPageUrl('skript', 'page'))
        .toBe('/undefined/skript/page')
    })
  })

  describe('buildPreviewUrl (unpublished content)', () => {
    it('should always use /preview/ prefix with pageSlug', () => {
      const { buildPreviewUrl } = usePublicUrl('eduadmin')
      expect(buildPreviewUrl('markdown-basics', 'headings-text'))
        .toBe('/preview/eduadmin/markdown-basics/headings-text')
    })

    it('should use /preview/ prefix even on custom domain', () => {
      mockIsCustomDomain = true
      const { buildPreviewUrl } = usePublicUrl('ig')
      expect(buildPreviewUrl('grundlagen', 'intro'))
        .toBe('/preview/ig/grundlagen/intro')
    })
  })

  describe('buildViewUrl (auto-selects based on publish state)', () => {
    it('should use public URL when fully published on main domain', () => {
      const { buildViewUrl } = usePublicUrl('eduadmin')
      expect(buildViewUrl('markdown-basics', 'headings-text', true))
        .toBe('/eduadmin/markdown-basics/headings-text')
    })

    it('should use preview URL when not fully published on main domain', () => {
      const { buildViewUrl } = usePublicUrl('eduadmin')
      expect(buildViewUrl('markdown-basics', 'headings-text', false))
        .toBe('/preview/eduadmin/markdown-basics/headings-text')
    })

    it('should use public URL without pageSlug when published on custom domain', () => {
      mockIsCustomDomain = true
      const { buildViewUrl } = usePublicUrl('ig')
      expect(buildViewUrl('grundlagen', 'intro', true))
        .toBe('/grundlagen/intro')
    })

    it('should use preview URL with pageSlug when unpublished on custom domain', () => {
      mockIsCustomDomain = true
      const { buildViewUrl } = usePublicUrl('ig')
      expect(buildViewUrl('grundlagen', 'intro', false))
        .toBe('/preview/ig/grundlagen/intro')
    })
  })

  describe('URL structure matches route expectations', () => {
    it('preview URL should match /preview/[domain]/[skriptSlug]/[pageSlug] route', () => {
      const { buildPreviewUrl } = usePublicUrl('myteacher')
      const url = buildPreviewUrl('my-skript', 'my-page')
      const segments = url.split('/').filter(Boolean)
      expect(segments).toEqual(['preview', 'myteacher', 'my-skript', 'my-page'])
    })

    it('public URL should match /[domain]/[skriptSlug]/[pageSlug] route', () => {
      const { buildPageUrl } = usePublicUrl('myteacher')
      const url = buildPageUrl('my-skript', 'my-page')
      const segments = url.split('/').filter(Boolean)
      expect(segments).toEqual(['myteacher', 'my-skript', 'my-page'])
    })
  })
})
