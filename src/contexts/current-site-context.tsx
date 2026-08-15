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

import { createContext, useContext, useEffect } from 'react'
import { syncEngine } from '@/lib/userdata/sync-engine'

export interface CurrentSite {
  siteId: string | null
  organizationId: string | null
}

const CurrentSiteContext = createContext<CurrentSite>({ siteId: null, organizationId: null })

export function CurrentSiteProvider({
  siteId,
  organizationId = null,
  children,
}: {
  siteId: string | null
  organizationId?: string | null
  children: React.ReactNode
}) {
  return (
    <CurrentSiteContext.Provider value={{ siteId, organizationId }}>
      <SyncEngineSiteBridge siteId={siteId} />
      {children}
    </CurrentSiteContext.Provider>
  )
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
