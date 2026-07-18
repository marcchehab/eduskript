'use client'

import { useCallback, useEffect, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface AdminSite {
  id: string
  slug: string
  pageName: string | null
  order: number
}

/**
 * Superadmin-only control to view a user's sites and grant an ADDITIONAL one.
 * Extra sites are a special deal (not self-serve); this is the only UI that
 * creates a second site for a teacher. The user's primary site (order 0) is
 * edited via the Page Slug field above — this panel is for extras.
 */
export function AdminUserSites({ userId }: { userId: string }) {
  const [sites, setSites] = useState<AdminSite[]>([])
  const [slug, setSlug] = useState('')
  const [pageName, setPageName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/sites`)
      if (res.ok) {
        const data = await res.json()
        setSites(data.sites ?? [])
      }
    } catch {
      // best-effort
    }
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  const grant = async () => {
    setError('')
    if (!slug.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/sites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slug.trim(), pageName: pageName.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to grant site')
        return
      }
      setSlug('')
      setPageName('')
      await load()
    } catch {
      setError('Failed to grant site')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <Label>Sites ({sites.length})</Label>
      <ul className="space-y-1 text-sm">
        {sites.map((s) => (
          <li key={s.id} className="flex items-center justify-between">
            <span className="font-mono">/{s.slug}</span>
            <span className="text-xs text-muted-foreground">
              {s.order === 0 ? 'primary' : `extra · ${s.pageName || '—'}`}
            </span>
          </li>
        ))}
      </ul>
      <div className="space-y-2 border-t border-border pt-3">
        <Label className="text-xs text-muted-foreground">Grant an additional site (special deal)</Label>
        <div className="flex gap-2">
          <Input
            placeholder="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="font-mono"
          />
          <Input
            placeholder="Page name (optional)"
            value={pageName}
            onChange={(e) => setPageName(e.target.value)}
          />
          <Button type="button" onClick={grant} disabled={busy || !slug.trim()}>
            Grant
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}
