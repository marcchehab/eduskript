'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface UnsavedChangesGuardOptions {
  isDirty: boolean
  /** Persist the edits. Resolve true on success; false keeps the user on the page. */
  onSave: () => Promise<boolean>
}

/**
 * Protects unsaved editor changes (used by page-editor.tsx).
 *
 * - Reload / close tab / external navigation: native `beforeunload` prompt
 *   (browsers show their own generic text; custom text is ignored).
 * - In-app navigation: a capture-phase click listener on `document` catches
 *   clicks on same-origin `<a href>` (incl. next/link) anywhere on the page
 *   while dirty and shows a Save / Discard / Cancel dialog instead.
 *
 * Known limitations: programmatic `router.push` calls and the browser
 * back/forward buttons are NOT intercepted (App Router has no public
 * navigation-blocking API). Modifier/middle clicks and target=_blank links
 * pass through, since they open a new tab and keep this one.
 */
export function useUnsavedChangesGuard({ isDirty, onSave }: UnsavedChangesGuardOptions) {
  const router = useRouter()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  // Set once the user chose Discard/Save so the follow-up navigation isn't
  // intercepted again while the dirty flag is still true.
  const bypassRef = useRef(false)
  const pathname = usePathname()

  // Re-arm after a navigation in case the editor instance is reused.
  useEffect(() => {
    bypassRef.current = false
  }, [pathname])

  useEffect(() => {
    if (!isDirty) return
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (bypassRef.current) return
      e.preventDefault()
      // Legacy browsers need returnValue set to show the prompt.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  useEffect(() => {
    if (!isDirty) return
    const handleClick = (e: MouseEvent) => {
      if (bypassRef.current || e.defaultPrevented) return
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      // Same-page hash links don't leave the editor.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      e.preventDefault()
      e.stopPropagation()
      setPendingHref(url.pathname + url.search + url.hash)
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [isDirty])

  const proceed = (href: string) => {
    bypassRef.current = true
    setPendingHref(null)
    router.push(href)
  }

  const handleSave = async () => {
    if (!pendingHref) return
    setIsSaving(true)
    try {
      const ok = await onSave()
      if (ok) proceed(pendingHref)
      else setPendingHref(null)
    } finally {
      setIsSaving(false)
    }
  }

  const dialog = (
    <Dialog open={pendingHref !== null} onOpenChange={(open) => { if (!open && !isSaving) setPendingHref(null) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>
            This page has changes that are not saved yet. Save them before leaving?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPendingHref(null)} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => pendingHref && proceed(pendingHref)} disabled={isSaving}>
            Discard
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { dialog }
}
