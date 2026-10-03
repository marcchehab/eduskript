'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'

/**
 * Whether the signed-in user may edit page `pageId` (GET /api/pages/[id]/can-edit:
 * page or skript author, admin; never students). One request per page per
 * browser session, shared by every caller (module cache). Logged-out viewers
 * make no request. Used for in-place editing on public pages.
 */
const cache = new Map<string, Promise<boolean>>()

export function usePageCanEdit(pageId: string | undefined): boolean {
  const { status } = useSession()
  const [canEdit, setCanEdit] = useState(false)
  useEffect(() => {
    if (!pageId || status !== 'authenticated') return
    let p = cache.get(pageId)
    if (!p) {
      p = fetch(`/api/pages/${pageId}/can-edit`).then(r => (r.ok ? r.json() : null)).then(j => !!j?.canEdit).catch(() => false)
      cache.set(pageId, p)
    }
    let live = true
    void p.then(v => { if (live) setCanEdit(v) })
    return () => { live = false }
  }, [pageId, status])
  return canEdit
}
