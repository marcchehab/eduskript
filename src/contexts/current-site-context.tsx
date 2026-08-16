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
 *  that bridges React state into it. */
function SyncEngineSiteBridge({ siteId }: { siteId: string | null }) {
  useEffect(() => {
    syncEngine.setSiteId(siteId)
    return () => syncEngine.setSiteId(null)
  }, [siteId])
  return null
}

export function useCurrentSite(): CurrentSite {
  return useContext(CurrentSiteContext)
}
