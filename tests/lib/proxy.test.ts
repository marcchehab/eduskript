import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Next.js modules before importing proxy
vi.mock('next/server', () => ({
  NextResponse: {
    next: vi.fn(() => ({ type: 'next' })),
    rewrite: vi.fn((url: URL) => ({ type: 'rewrite', url: url.pathname })),
  },
}))

// Mock fetch for domain resolution
const mockFetch = vi.fn()
global.fetch = mockFetch

/**
 * The proxy also ships buffered metrics to /api/internal/metrics-ingest, which
 * is unrelated to routing. These assertions are about the DB lookup, so match
 * on the resolve-domain call specifically rather than on "fetch at all".
 */
function resolveDomainCalls() {
  return mockFetch.mock.calls.filter(call => String(call[0]).includes('resolve-domain'))
}

/**
 * Answer only the resolve-domain lookup with `response`; anything else (the
 * metrics-ingest POST) gets a benign reply. Ordered mocks would otherwise be
 * consumed by whichever call happens to come first.
 */
function mockResolveDomain(response: unknown) {
  mockFetch.mockImplementation(async (url: string) =>
    String(url).includes('resolve-domain')
      ? response
      : { ok: true, json: async () => ({}) }
  )
}

describe('proxy routing', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    // Reset environment variable
    delete process.env.DEFAULT_ORG_SLUG
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Helper to create mock NextRequest. Uses a real Headers object so that
  // proxy code which spreads it (e.g. `new Headers(request.headers)` to
  // forward headers on a rewrite) works as in production.
  function createMockRequest(hostname: string, pathname: string) {
    const url = new URL(`http://${hostname}${pathname}`)
    void url
    const headers = new Headers()
    headers.set('host', hostname)
    headers.set('cookie', '')
    return {
      headers,
      nextUrl: {
        pathname,
        origin: `http://${hostname}`,
        clone: () => ({
          pathname,
          origin: `http://${hostname}`,
        }),
      },
    }
  }

  describe('internal routes bypass', () => {
    it('should skip /_next routes', async () => {
      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('localhost:3000', '/_next/static/chunk.js')
      await proxy(request as any)

      expect(NextResponse.next).toHaveBeenCalled()
      expect(NextResponse.rewrite).not.toHaveBeenCalled()
    })

    it('should skip /api routes', async () => {
      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('localhost:3000', '/api/auth/session')
      await proxy(request as any)

      expect(NextResponse.next).toHaveBeenCalled()
      expect(NextResponse.rewrite).not.toHaveBeenCalled()
    })

    it('should skip /dashboard routes', async () => {
      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('localhost:3000', '/dashboard/page-builder')
      await proxy(request as any)

      expect(NextResponse.next).toHaveBeenCalled()
      expect(NextResponse.rewrite).not.toHaveBeenCalled()
    })

    it('should skip /embed routes on app domain', async () => {
      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('eduskript.org', '/embed/eduadmin/mod-clock')
      await proxy(request as any)

      expect(NextResponse.next).toHaveBeenCalled()
      expect(NextResponse.rewrite).not.toHaveBeenCalled()
    })

    it('should skip /embed routes on custom teacher domain', async () => {
      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('informatikgarten.ch', '/embed/informatikgarten/mod-calc')
      await proxy(request as any)

      expect(NextResponse.next).toHaveBeenCalled()
      expect(NextResponse.rewrite).not.toHaveBeenCalled()
    })

    it('should skip explicit /org/ routes', async () => {
      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('localhost:3000', '/org/eduskript')
      await proxy(request as any)

      expect(NextResponse.next).toHaveBeenCalled()
      expect(NextResponse.rewrite).not.toHaveBeenCalled()
    })

    it('should skip static files with extensions', async () => {
      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('localhost:3000', '/images/logo.png')
      await proxy(request as any)

      expect(NextResponse.next).toHaveBeenCalled()
      expect(NextResponse.rewrite).not.toHaveBeenCalled()
    })
  })

  describe('app domains (no DB lookup)', () => {
    it('should rewrite eduskript.org to /org/eduskript', async () => {
      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('eduskript.org', '/')
      await proxy(request as any)

      expect(NextResponse.rewrite).toHaveBeenCalled()
      const rewriteCall = (NextResponse.rewrite as any).mock.calls[0][0]
      expect(rewriteCall.pathname).toBe('/org/eduskript')
      expect(resolveDomainCalls()).toHaveLength(0)
    })
  })

  describe('localhost handling', () => {
    it('should rewrite localhost root to default org without fetch', async () => {
      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('localhost:3000', '/')
      await proxy(request as any)

      expect(NextResponse.rewrite).toHaveBeenCalled()
      const rewriteCall = (NextResponse.rewrite as any).mock.calls[0][0]
      expect(rewriteCall.pathname).toBe('/org/eduskript')
      expect(resolveDomainCalls()).toHaveLength(0)
    })

    it('should pass through localhost sub-paths to let [domain] route handle them', async () => {
      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('localhost:3000', '/somepath')
      await proxy(request as any)

      expect(NextResponse.next).toHaveBeenCalled()
      expect(NextResponse.rewrite).not.toHaveBeenCalled()
    })

    it('should pass through teacher page URLs on localhost (not rewrite to org)', async () => {
      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('localhost:3000', '/eduadmin/markdown-basics/headings-text')
      await proxy(request as any)

      expect(NextResponse.next).toHaveBeenCalled()
      expect(NextResponse.rewrite).not.toHaveBeenCalled()
    })

    it('should pass through two-segment paths on localhost', async () => {
      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('localhost:3000', '/eduadmin/some-skript')
      await proxy(request as any)

      expect(NextResponse.next).toHaveBeenCalled()
      expect(NextResponse.rewrite).not.toHaveBeenCalled()
    })
  })

  describe('eduskript.org teacher page routing', () => {
    it('should rewrite teacher page paths to org on eduskript.org', async () => {
      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      // On eduskript.org, /eduadmin/skript/page gets rewritten to /org/eduskript/eduadmin/skript/page
      // because the [domain] route on eduskript.org expects the org rewrite
      const request = createMockRequest('eduskript.org', '/eduadmin/markdown-basics/headings-text')
      await proxy(request as any)

      expect(NextResponse.rewrite).toHaveBeenCalled()
      const rewriteCall = (NextResponse.rewrite as any).mock.calls[0][0]
      expect(rewriteCall.pathname).toBe('/org/eduskript/eduadmin/markdown-basics/headings-text')
    })
  })

  describe('custom domain resolution via API', () => {
    it('should rewrite to resolved org for unknown custom domain', async () => {
      mockResolveDomain({
        ok: true,
        json: async () => ({ type: 'org', orgSlug: 'school1' }),
      })

      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('school.edu', '/')
      await proxy(request as any)

      expect(NextResponse.rewrite).toHaveBeenCalled()
      const rewriteCall = (NextResponse.rewrite as any).mock.calls[0][0]
      expect(rewriteCall.pathname).toBe('/org/school1')
    })

    it('should rewrite to teacher page for teacher custom domain', async () => {
      mockResolveDomain({
        ok: true,
        json: async () => ({ type: 'teacher', pageSlug: 'teacherpage' }),
      })

      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('teacher.example.com', '/')
      await proxy(request as any)

      expect(NextResponse.rewrite).toHaveBeenCalled()
      const rewriteCall = (NextResponse.rewrite as any).mock.calls[0][0]
      expect(rewriteCall.pathname).toBe('/teacherpage')
    })

    it('should fall back to default org when custom domain not found', async () => {
      mockResolveDomain({ ok: false })

      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('unknown.com', '/')
      await proxy(request as any)

      expect(NextResponse.rewrite).toHaveBeenCalled()
      const rewriteCall = (NextResponse.rewrite as any).mock.calls[0][0]
      expect(rewriteCall.pathname).toBe('/org/eduskript')
    })
  })

  describe('DEFAULT_ORG_SLUG env var', () => {
    it('should use DEFAULT_ORG_SLUG env var when set', async () => {
      process.env.DEFAULT_ORG_SLUG = 'myorg'

      // Need to re-import to pick up new env var
      vi.resetModules()
      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('localhost:3000', '/')
      await proxy(request as any)

      expect(NextResponse.rewrite).toHaveBeenCalled()
      const rewriteCall = (NextResponse.rewrite as any).mock.calls[0][0]
      expect(rewriteCall.pathname).toBe('/org/myorg')
    })
  })
})
