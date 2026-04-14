import { describe, it, expect } from 'vitest'
import { stripPrefix } from '@/components/public/layout-client'

// stripPrefix removes the proxy-added segment from a server-side path so
// that client-built navigation URLs match the browser-visible path. The
// proxy (src/proxy.ts) sets x-proxy-strip-prefix; the server wrapper in
// src/components/public/layout.tsx forwards it to the client layout, which
// applies this helper to routePrefix and homeUrl.
describe('components/public/layout stripPrefix', () => {
  it('returns the path unchanged when no prefix is given', () => {
    expect(stripPrefix('/org/eduskript/c/skript/page', undefined)).toBe('/org/eduskript/c/skript/page')
    expect(stripPrefix('/foo', '')).toBe('/foo')
  })

  it('strips an exact-match prefix to empty string (so caller can fall back to "/")', () => {
    expect(stripPrefix('/org/eduskript', '/org/eduskript')).toBe('')
    expect(stripPrefix('/ig', '/ig')).toBe('')
  })

  it('strips a leading prefix when followed by a "/"', () => {
    // org content on eduskript.org
    expect(stripPrefix('/org/eduskript/c', '/org/eduskript')).toBe('/c')
    // org teacher subpage on eduskript.org
    expect(stripPrefix('/org/eduskript/teacherA', '/org/eduskript')).toBe('/teacherA')
    // teacher custom domain (informatikgarten.ch)
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

  it('handles the localhost case: routePrefix shorter than (or equal to) what proxy would have stripped', () => {
    // On localhost the proxy doesn't rewrite arbitrary paths, so the header
    // is undefined and stripPrefix is a no-op. Verifies the no-prefix branch.
    expect(stripPrefix('/org/eduskript/c', undefined)).toBe('/org/eduskript/c')
  })
})
