// Must be the first import: installs an in-memory IndexedDB before Dexie loads.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'u1' } }, status: 'authenticated' }),
}))
vi.mock('@/contexts/current-site-context', () => ({ useCurrentSite: () => ({ siteId: 'site-a' }) }))

import { db } from '@/lib/userdata/schema'
import { userDataService } from '@/lib/userdata/userDataService'
import { syncEngine } from '@/lib/userdata/sync-engine'
import { UserDataProvider, useSyncedUserData } from '@/lib/userdata/provider'
import type { StickyNotesData } from '@/lib/userdata/adapters'

/**
 * A remote delivery (sync engine, fresh browser) that arrives while a local
 * edit is still in the debounced save must not drop that edit: the hook
 * merges (adapter.merge) and saves the merged value. Found by the flaky
 * e2e/annotation-elements.spec.ts sticky-note test after the fresh-browser
 * sync fix started delivering remote rows to mounted hooks.
 */

type Note = StickyNotesData['notes'][number]
const note = (id: string, updatedAt = 1): Note => ({ id, updatedAt } as unknown as Note)
const ids = (d: StickyNotesData | null) => (d?.notes ?? []).map((n) => n.id).sort()

const wrapper = ({ children }: { children: ReactNode }) => <UserDataProvider>{children}</UserDataProvider>

beforeEach(async () => {
  await db.siteUserData.clear()
  // Manifest/bulk-fetch/sync calls of the real sync engine: an empty server.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/user-data/manifest')) return new Response('[]', { status: 200 })
    return new Response(JSON.stringify({ items: [], conflicts: [] }), { status: 200 })
  }))
})
afterEach(() => {
  syncEngine.setUser(null)
  syncEngine.setSiteId(null)
  vi.unstubAllGlobals()
})

describe('useSyncedUserData remote delivery after a local edit', () => {
  it('keeps the unsaved local note and adds the server notes', async () => {
    const { result } = renderHook(
      () => useSyncedUserData<StickyNotesData>('page-1', 'sticky-notes', { notes: [] }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // Local edit: debounced save, not in IndexedDB yet.
    await act(async () => { await result.current.updateData({ notes: [note('local')] }) })
    expect(await db.siteUserData.get(['u1', 'site-a', 'page-1', 'sticky-notes', '', ''])).toBeUndefined()

    // The sync engine delivers the server row (as fetchAndMergeChunk does).
    act(() => {
      userDataService.notifyRemoteChange('u1', 'site-a', 'page-1', 'sticky-notes', '', '', { notes: [note('server')] })
    })
    await waitFor(() => expect(ids(result.current.data)).toEqual(['local', 'server']))

    // The merged value replaces the pending save.
    await act(async () => { await userDataService.flush() })
    const rec = await db.siteUserData.get(['u1', 'site-a', 'page-1', 'sticky-notes', '', ''])
    expect(ids(rec?.data as StickyNotesData)).toEqual(['local', 'server'])
  })

  it('without local edits the delivered row replaces the state', async () => {
    const { result } = renderHook(
      () => useSyncedUserData<StickyNotesData>('page-1', 'sticky-notes', { notes: [] }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => {
      userDataService.notifyRemoteChange('u1', 'site-a', 'page-1', 'sticky-notes', '', '', { notes: [note('server')] })
    })
    await waitFor(() => expect(ids(result.current.data)).toEqual(['server']))
  })
})
