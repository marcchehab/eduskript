'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'

/**
 * The viewer's rights on a site's presentation data (GET /api/sites/[id]/access,
 * rule in src/lib/site-access.ts). One request per (user, site) per browser
 * session, shared by every caller (module cache). Logged-out viewers and a
 * null siteId make no request.
 *
 * `resolved` is false until the answer is known — callers that render
 * owner-only UI should render nothing until then (no flash).
 */
export interface SiteAccessState {
  resolved: boolean
  canManage: boolean
  isOwner: boolean
  kind: 'personal' | 'org' | null
}

const NONE: SiteAccessState = { resolved: true, canManage: false, isOwner: false, kind: null }
const PENDING: SiteAccessState = { resolved: false, canManage: false, isOwner: false, kind: null }
const cache = new Map<string, Promise<SiteAccessState>>()

export function useSiteAccess(siteId: string | null | undefined): SiteAccessState {
  const { data: session, status } = useSession()
  const userId = session?.user?.id ?? null
  const key = siteId && userId ? `${userId}:${siteId}` : null
  const [loaded, setLoaded] = useState<{ key: string; value: SiteAccessState } | null>(null)

  useEffect(() => {
    if (!key || !siteId) return
    let p = cache.get(key)
    if (!p) {
      p = fetch(`/api/sites/${encodeURIComponent(siteId)}/access`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then(j => (j
          ? { resolved: true, canManage: !!j.canManage, isOwner: !!j.isOwner, kind: j.kind ?? null }
          : NONE))
        .catch(() => NONE)
      cache.set(key, p)
    }
    let live = true
    void p.then(v => { if (live) setLoaded({ key, value: v }) })
    return () => { live = false }
  }, [key, siteId])

  if (status === 'loading') return PENDING
  if (!key) return NONE
  return loaded?.key === key ? loaded.value : PENDING
}
