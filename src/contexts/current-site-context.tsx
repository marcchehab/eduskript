'use client'

/**
 * Current-site identity context.
 *
 * Site/org identity is resolved server-side, once, right where a route
 * already knows it ([domain]/layout.tsx, each org/[orgSlug]/**\/page.tsx) —
 * so it's passed straight down as a normal prop into this provider, mounted
 * at that route boundary. No upward reporting needed (contrast with
 * examUserId in src/lib/userdata/provider.tsx, which genuinely can't be
 * known until deep inside a client-rendered exam page).
 *
 * Routes with no site/org (dashboard, auth) simply never mount this
 * provider, so useCurrentSite() returns nulls there — callers should treat
 * that as "no site scoping applies" rather than an error.
 */

import { createContext, useContext, useEffect, useState } from 'react'
import { syncEngine } from '@/lib/userdata/sync-engine'
import { userDataService } from '@/lib/userdata/userDataService'

export interface CurrentSite {
  siteId: string | null
  organizationId: string | null
  pageId: string | null
  setPageId: (id: string | null) => void
}

const CurrentSiteContext = createContext<CurrentSite>({
  siteId: null,
  organizationId: null,
  pageId: null,
  setPageId: () => {},
})

export function CurrentSiteProvider({
  siteId,
  organizationId = null,
  children,
}: {
  siteId: string | null
  organizationId?: string | null
  children: React.ReactNode
}) {
  const [pageId, setPageId] = useState<string | null>(null)
  // Site scoping (src/lib/site-access.ts): every IndexedDB record is keyed on
  // the site. Set during render, not in an effect — child effects (editors
  // restoring saved answers) run BEFORE this provider's effects, and must
  // already read/write under the right site. Idempotent, so re-renders and
  // StrictMode double-renders are harmless. Pending debounced saves captured
  // their own site, so a switch can't misfile them.
  if (userDataService.getCurrentSite() !== (siteId ?? '')) {
    userDataService.setCurrentSite(siteId)
  }
  return (
    <CurrentSiteContext.Provider value={{ siteId, organizationId, pageId, setPageId }}>
      <SyncEngineSiteBridge siteId={siteId} />
      {children}
    </CurrentSiteContext.Provider>
  )
}

/**
 * Reports the current content page's id up into CurrentSiteContext. Needed
 * because [domain]/layout.tsx mounts PublicSiteLayout/CurrentSiteProvider
 * once for the whole site — it has no access to page-specific route params —
 * so PublicSiteLayout's own siteStructure-based pageId lookup silently misses
 * unlisted pages (excluded from getFullSiteStructure's query). The content
 * page itself already has the real page id, so it reports it upward.
 */
export function ReportCurrentPageId({ pageId }: { pageId: string }) {
  const { setPageId } = useContext(CurrentSiteContext)
  useEffect(() => {
    setPageId(pageId)
    return () => setPageId(null)
  }, [pageId, setPageId])
  return null
}

/** Feeds the resolved siteId into the sync engine singleton — a plain
 *  imported module, not itself context-aware, so this is the one place
 *  that bridges React state into it. On unmount the user-data service drops
 *  back to "no site" (deferred, see mountedBridges) so a later non-site route
 *  (dashboard) can't write into this site's records. */
// How many bridges per site are mounted. The reset to "no site" on unmount
// is deferred to a macrotask and skipped while another provider for the same
// site is mounted (same-site route change remounts the provider): unmount
// cleanups of the leaving tree (annotation-layer's final save) run AFTER
// this bridge's cleanup and must still see the site (bughunt #11). Hooks pass
// the site explicitly anyway (provider.tsx / hooks.ts); this guards the
// remaining direct service callers.
const mountedBridges = new Map<string, number>()

function SyncEngineSiteBridge({ siteId }: { siteId: string | null }) {
  useEffect(() => {
    const key = siteId ?? ''
    mountedBridges.set(key, (mountedBridges.get(key) ?? 0) + 1)
    syncEngine.setSiteId(siteId)
    userDataService.setCurrentSite(siteId)
    return () => {
      mountedBridges.set(key, (mountedBridges.get(key) ?? 1) - 1)
      setTimeout(() => {
        if ((mountedBridges.get(key) ?? 0) > 0) return
        if (userDataService.getCurrentSite() !== key) return
        syncEngine.setSiteId(null)
        userDataService.setCurrentSite(null)
      }, 0)
    }
  }, [siteId])
  // Re-assert the site after every commit of this (visible) tree: a render of
  // another site's provider that React discarded or suspended may have set
  // the global during render (bughunt #24).
  useEffect(() => {
    if (userDataService.getCurrentSite() !== (siteId ?? '')) userDataService.setCurrentSite(siteId)
  })
  return null
}

export function useCurrentSite(): CurrentSite {
  return useContext(CurrentSiteContext)
}
