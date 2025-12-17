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

  // Helper to create mock NextRequest
  function createMockRequest(hostname: string, pathname: string) {
    const url = new URL(`http://${hostname}${pathname}`)
    return {
      headers: {
        get: (name: string) => {
          if (name === 'host') return hostname
          if (name === 'cookie') return ''
          return null
        },
      },
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

  describe('default org fallback', () => {
    it('should rewrite root path to default org', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false })

      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('localhost:3000', '/')
      await proxy(request as any)

      expect(NextResponse.rewrite).toHaveBeenCalled()
      const rewriteCall = (NextResponse.rewrite as any).mock.calls[0][0]
      expect(rewriteCall.pathname).toBe('/org/eduskript')
    })

    it('should rewrite teacher path to default org', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false })

      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('localhost:3000', '/teachername')
      await proxy(request as any)

      expect(NextResponse.rewrite).toHaveBeenCalled()
      const rewriteCall = (NextResponse.rewrite as any).mock.calls[0][0]
      expect(rewriteCall.pathname).toBe('/org/eduskript/teachername')
    })

    it('should rewrite collection path to default org with /c/ prefix', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false })

      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('localhost:3000', '/c/algebra')
      await proxy(request as any)

      expect(NextResponse.rewrite).toHaveBeenCalled()
      const rewriteCall = (NextResponse.rewrite as any).mock.calls[0][0]
      expect(rewriteCall.pathname).toBe('/org/eduskript/c/algebra')
    })

    it('should use DEFAULT_ORG_SLUG env var when set', async () => {
      process.env.DEFAULT_ORG_SLUG = 'myorg'
      mockFetch.mockResolvedValueOnce({ ok: false })

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

  describe('custom domain resolution', () => {
    it('should rewrite to resolved org for custom domain', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ orgSlug: 'school1' }),
      })

      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('school.edu', '/')
      await proxy(request as any)

      expect(NextResponse.rewrite).toHaveBeenCalled()
      const rewriteCall = (NextResponse.rewrite as any).mock.calls[0][0]
      expect(rewriteCall.pathname).toBe('/org/school1')
    })

    it('should include path when rewriting custom domain', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ orgSlug: 'school1' }),
      })

      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('school.edu', '/teacher1')
      await proxy(request as any)

      expect(NextResponse.rewrite).toHaveBeenCalled()
      const rewriteCall = (NextResponse.rewrite as any).mock.calls[0][0]
      expect(rewriteCall.pathname).toBe('/org/school1/teacher1')
    })

    it('should fall back to default org when custom domain not found', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false })

      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('unknown.com', '/')
      await proxy(request as any)

      expect(NextResponse.rewrite).toHaveBeenCalled()
      const rewriteCall = (NextResponse.rewrite as any).mock.calls[0][0]
      expect(rewriteCall.pathname).toBe('/org/eduskript')
    })
  })

  describe('localhost handling (no special case)', () => {
    it('should treat localhost same as any other domain - fall back to default org', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false })

      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('localhost:3000', '/somepath')
      await proxy(request as any)

      expect(NextResponse.rewrite).toHaveBeenCalled()
      const rewriteCall = (NextResponse.rewrite as any).mock.calls[0][0]
      expect(rewriteCall.pathname).toBe('/org/eduskript/somepath')
    })

    it('should treat 127.0.0.1 same as any other domain', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false })

      const { proxy } = await import('@/proxy')
      const { NextResponse } = await import('next/server')

      const request = createMockRequest('127.0.0.1:3000', '/')
      await proxy(request as any)

      expect(NextResponse.rewrite).toHaveBeenCalled()
      const rewriteCall = (NextResponse.rewrite as any).mock.calls[0][0]
      expect(rewriteCall.pathname).toBe('/org/eduskript')
    })
  })
})
