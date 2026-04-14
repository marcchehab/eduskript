import { describe, it, expect } from 'vitest'
import { stripPrefix, computeProxyStrip } from '@/components/public/layout'

// These helpers power the client-side nav-URL rewriting in PublicSiteLayout.
// `computeProxyStrip` decides WHAT to strip from routePrefix based on the
// current hostname (mirrors the proxy's own prepending logic from
// src/proxy.ts). `stripPrefix` does the actual removal. Both run purely on
// the client at click time — no request-scoped data in the render — so
// every page can stay ISR-cacheable.
describe('components/public/layout — stripPrefix', () => {
  it('returns the path unchanged when no prefix is given', () => {
    expect(stripPrefix('/org/eduskript/c/skript/page', undefined)).toBe('/org/eduskript/c/skript/page')
    expect(stripPrefix('/foo', '')).toBe('/foo')
  })

  it('strips an exact-match prefix to empty string (so caller can fall back to "/")', () => {
    expect(stripPrefix('/org/eduskript', '/org/eduskript')).toBe('')
    expect(stripPrefix('/ig', '/ig')).toBe('')
  })

  it('strips a leading prefix when followed by a "/"', () => {
    expect(stripPrefix('/org/eduskript/c', '/org/eduskript')).toBe('/c')
    expect(stripPrefix('/org/eduskript/teacherA', '/org/eduskript')).toBe('/teacherA')
    expect(stripPrefix('/ig/skript/page', '/ig')).toBe('/skript/page')
  })

  it('does NOT strip when the prefix only matches a partial segment', () => {
    // '/org/eduskript' must not strip from '/org/eduskript-other' — segment boundary required
    expect(stripPrefix('/org/eduskript-other/c', '/org/eduskript')).toBe('/org/eduskript-other/c')
  })

  it('does NOT strip when path does not start with the prefix at all', () => {
    expect(stripPrefix('/org/schoola/c', '/org/eduskript')).toBe('/org/schoola/c')
    expect(stripPrefix('/some-teacher/page', '/ig')).toBe('/some-teacher/page')
  })
})

describe('components/public/layout — computeProxyStrip', () => {
  describe('primary hosts (eduskript.org family, localhost, tunnels)', () => {
    it('strips /org/eduskript when rendering the primary org on eduskript.org', () => {
      expect(computeProxyStrip('eduskript.org', '/org/eduskript/c')).toBe('/org/eduskript')
      expect(computeProxyStrip('eduskript.org', '/org/eduskript/teacherA')).toBe('/org/eduskript')
      expect(computeProxyStrip('www.eduskript.org', '/org/eduskript/c')).toBe('/org/eduskript')
    })

    it('strips /org/eduskript on localhost too (default org mirrors production)', () => {
      expect(computeProxyStrip('localhost', '/org/eduskript/c')).toBe('/org/eduskript')
    })

    it('strips on ngrok tunnel domains (which behave like eduskript.org via proxy)', () => {
      expect(computeProxyStrip('abc123.ngrok-free.dev', '/org/eduskript/c')).toBe('/org/eduskript')
      expect(computeProxyStrip('xyz.ngrok-free.app', '/org/eduskript/c')).toBe('/org/eduskript')
      expect(computeProxyStrip('old.ngrok.io', '/org/eduskript/c')).toBe('/org/eduskript')
    })

    it('does NOT strip when the route is for a different org on the primary host', () => {
      // eduskript.org/org/schoola/... is the fallback path for orgs without
      // custom domains. The proxy bypasses /org/* paths so the browser URL
      // already shows the full /org/schoola prefix — nav links must keep it.
      expect(computeProxyStrip('eduskript.org', '/org/schoola/c')).toBe('')
      expect(computeProxyStrip('eduskript.org', '/org/otherOrg/teacherA')).toBe('')
    })

    it('does NOT strip for teacher routes (no /org/ prefix) on the primary host', () => {
      // This would only arise on localhost accessing a teacher route directly
      // — the browser URL and the internal route are the same, no strip.
      expect(computeProxyStrip('localhost', '/ig')).toBe('')
      expect(computeProxyStrip('localhost', '/some-teacher/skript/page')).toBe('')
    })
  })

  describe('custom hosts (teacher domains, DB-resolved org domains)', () => {
    it('strips /{teacherSlug} for a teacher custom domain', () => {
      // The proxy rewrote informatikgarten.ch → /ig/... based on the
      // hostname. Strip the leading tenant segment so nav links match what
      // the browser shows.
      expect(computeProxyStrip('informatikgarten.ch', '/ig')).toBe('/ig')
      expect(computeProxyStrip('informatikgarten.ch', '/ig/grundjahr')).toBe('/ig')
    })

    it('strips /org/{orgSlug} for a DB-resolved org custom domain', () => {
      // schoola.org resolves via DB lookup to org "schoola"; proxy rewrites
      // / → /org/schoola. Strip that prefix from nav URLs.
      expect(computeProxyStrip('schoola.org', '/org/schoola/c')).toBe('/org/schoola')
      expect(computeProxyStrip('schoola.org', '/org/schoola/teacherB')).toBe('/org/schoola')
    })

    it('returns empty string when routePrefix has no leading tenant segment', () => {
      // Shouldn't happen in practice (pages always provide a routePrefix),
      // but guard against degenerate input.
      expect(computeProxyStrip('schoola.org', '')).toBe('')
    })
  })
})
