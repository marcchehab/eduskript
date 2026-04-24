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

  describe('buildPageUrl', () => {
    it('should include pageSlug on main domain', () => {
      const { buildPageUrl } = usePublicUrl('eduadmin')
      expect(buildPageUrl('markdown-basics', 'headings-text'))
        .toBe('/eduadmin/markdown-basics/headings-text')
    })

    it('should omit pageSlug on custom domain (proxy prepends it)', () => {
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

  describe('URL structure matches route expectations', () => {
    it('public URL should match /[domain]/[skriptSlug]/[pageSlug] route', () => {
      const { buildPageUrl } = usePublicUrl('myteacher')
      const url = buildPageUrl('my-skript', 'my-page')
      const segments = url.split('/').filter(Boolean)
      expect(segments).toEqual(['myteacher', 'my-skript', 'my-page'])
    })
  })
})
