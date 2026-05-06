// `/p/{id}` is the slug-independent "stable link" form. Authors paste it into
// markdown; the redirect route at /app/p/[id] resolves it at click time, and
// the rehype rewrite plugin in compileMarkdown resolves it at render time so
// public pages ship with canonical hrefs baked in.
//
// This file is import-safe on the client. The DB-backed resolver lives in
// `page-stable-link.server.ts` and is dynamically imported only on the server.
//
// Loose ID regex — narrow enough to skip obvious non-IDs (`/p/`, `/p/x`),
// permissive enough to accept any cuid/cuid2 variant. The DB lookup is the
// real filter.
const STABLE_LINK_RE = /\/p\/([a-zA-Z0-9_-]{16,})\b/g

const STABLE_LINK_PREFIX = '/p/'

export function isStableLink(href: string): boolean {
  return href.startsWith(STABLE_LINK_PREFIX)
}

/** Pull out the id from `/p/{id}`. Returns null if href isn't a stable link. */
export function parseStableLink(href: string): string | null {
  if (!href.startsWith(STABLE_LINK_PREFIX)) return null
  const id = href.slice(STABLE_LINK_PREFIX.length).split(/[?#/]/)[0]
  return id || null
}

/** Scan raw markdown for `/p/{id}` references. Deduped. */
export function extractStableLinkIds(markdown: string): string[] {
  const ids = new Set<string>()
  for (const match of markdown.matchAll(STABLE_LINK_RE)) {
    ids.add(match[1])
  }
  return [...ids]
}

export interface ResolvedPage {
  id: string
  /** Canonical public URL like `/{pageSlug}/{skriptSlug}/{pageSlug}` */
  url: string
  /** Page title — useful for autocomplete labels and link previews. */
  title: string
}
