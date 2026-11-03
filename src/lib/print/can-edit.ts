'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'

// One request per page and tab; several components on a page share it.
const cache = new Map<string, Promise<boolean>>()

/** Whether the viewer may edit the page (/api/pages/[id]/can-edit). False while loading. */
export function useCanEditPage(pageId: string | undefined, enabled = true): boolean {
  const { status, data } = useSession()
  const [canEdit, setCanEdit] = useState(false)
  const student = data?.user?.accountType === 'student'
  useEffect(() => {
    if (!enabled || !pageId || status !== 'authenticated' || student) return
    let promise = cache.get(pageId)
    if (!promise) {
      promise = fetch(`/api/pages/${pageId}/can-edit`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => !!d?.canEdit)
        .catch(() => false)
      cache.set(pageId, promise)
    }
    let cancelled = false
    void promise.then((v) => { if (!cancelled) setCanEdit(v) })
    return () => { cancelled = true }
  }, [enabled, pageId, status, student])
  return canEdit
}
