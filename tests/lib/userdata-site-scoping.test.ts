// Must be the first import: installs an in-memory IndexedDB before Dexie loads.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import { UserDataDatabase, LEGACY_SITE_ID, db } from '@/lib/userdata/schema'
import { userDataService } from '@/lib/userdata/userDataService'
import { syncEngine } from '@/lib/userdata/sync-engine'

/**
 * Site scoping on the client (src/lib/userdata/schema.ts, userDataService.ts):
 *  - Dexie version 2 copies every v1 row into `siteUserData` as LEGACY and
 *    never deletes anything (unsynced rows stay unsynced).
 *  - The first real site that reads a legacy row adopts (moves) it.
 *  - Records are isolated per site.
 *  - The sync engine never queues rows without a real site.
 */

const V1_STORES = {
  userData: '[userId+pageId+componentId+targetType+targetId], updatedAt, savedToRemote, targetType, localOnly, [userId+pageId], userId',
  userData_history: '++id, [userId+pageId+componentId], versionNumber, createdAt, blobId',
  versionBlobs: 'blobId, createdAt, refCount',
}

function legacyRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    userId: 'u1',
    pageId: 'page-1',
    componentId: 'code-editor-a',
    data: { files: [{ name: 'main.py', content: 'print(42)' }] },
    createdAt: new Date(0).toISOString(),
    updatedAt: 1000,
    savedToRemote: false,
    version: 3,
    targetType: '',
    targetId: '',
    ...over,
  }
}

describe('Dexie v1 → v2 upgrade (site scoping)', () => {
  it('copies every row as legacy, keeps unsynced flags and never deletes the v1 table', async () => {
    const name = 'SiteScopeUpgradeTest'
    const v1 = new Dexie(name)
    v1.version(1).stores(V1_STORES)
    await v1.open()
    await v1.table('userData').bulkPut([
      legacyRow(),
      legacyRow({ componentId: 'quiz-q1', savedToRemote: true, data: { selected: [1] } }),
      legacyRow({ userId: 'anonymous', componentId: 'annotations', localOnly: true }),
    ])
    await v1.table('userData_history').add({ userId: 'u1', pageId: 'page-1', componentId: 'code-editor-a', versionNumber: 1, dataHash: 'h', blobId: 'h', createdAt: 1, sizeBytes: 1 })
    v1.close()

    const v2 = new UserDataDatabase(name)
    await v2.open()

    const rows = await v2.siteUserData.toArray()
    expect(rows).toHaveLength(3)
    expect(rows.every(r => r.siteId === LEGACY_SITE_ID)).toBe(true)
    const unsynced = rows.find(r => r.componentId === 'code-editor-a')!
    expect(unsynced.savedToRemote).toBe(false)
    expect(unsynced.version).toBe(3)
    expect(unsynced.data).toEqual({ files: [{ name: 'main.py', content: 'print(42)' }] })
    expect(rows.find(r => r.componentId === 'annotations')!.localOnly).toBe(true)

    // Old table untouched (safety copy).
    expect(await v2.userData.count()).toBe(3)
    // History rows are stamped legacy, not dropped.
    const hist = await v2.userData_history.toArray()
    expect(hist).toHaveLength(1)
    expect(hist[0].siteId).toBe(LEGACY_SITE_ID)
    v2.close()
  })
})

describe('userDataService site scoping', () => {
  beforeEach(async () => {
    await db.siteUserData.clear()
    await db.userData_history.clear()
    await userDataService.setCurrentUser('u1')
    userDataService.setCurrentSite(null)
  })

  it('adopts a legacy record into the first site that reads it (moved, not dropped)', async () => {
    await db.siteUserData.put({ ...legacyRow(), siteId: LEGACY_SITE_ID } as never)

    userDataService.setCurrentSite('site-a')
    const rec = await userDataService.get('page-1', 'code-editor-a')
    expect(rec?.siteId).toBe('site-a')
    expect(rec?.savedToRemote).toBe(false) // still pending → will be pushed for site-a
    expect(await db.siteUserData.get(['u1', LEGACY_SITE_ID, 'page-1', 'code-editor-a', '', ''])).toBeUndefined()

    // Another site does not see it.
    userDataService.setCurrentSite('site-b')
    expect(await userDataService.get('page-1', 'code-editor-a')).toBeNull()
  })

  it('keeps the same page isolated per site', async () => {
    userDataService.setCurrentSite('site-a')
    await userDataService.save('page-1', 'quiz-q1', { selected: [0] }, { immediate: true })
    userDataService.setCurrentSite('site-b')
    expect(await userDataService.get('page-1', 'quiz-q1')).toBeNull()
    await userDataService.save('page-1', 'quiz-q1', { selected: [2] }, { immediate: true })

    userDataService.setCurrentSite('site-a')
    expect((await userDataService.get('page-1', 'quiz-q1'))?.data).toEqual({ selected: [0] })
    userDataService.setCurrentSite('site-b')
    expect((await userDataService.get('page-1', 'quiz-q1'))?.data).toEqual({ selected: [2] })
  })

  it('a debounced save lands on the site it was made on even if the site switches', async () => {
    userDataService.setCurrentSite('site-a')
    await userDataService.save('page-1', 'code-editor-x', { v: 1 }, { debounce: 10_000 })
    userDataService.setCurrentSite('site-b')
    await userDataService.flush()
    expect(await db.siteUserData.get(['u1', 'site-a', 'page-1', 'code-editor-x', '', ''])).toBeTruthy()
    expect(await db.siteUserData.get(['u1', 'site-b', 'page-1', 'code-editor-x', '', ''])).toBeUndefined()
  })

  it('cleanupOldData never drops unsynced rows', async () => {
    await db.siteUserData.put({ ...legacyRow({ updatedAt: 1 }), siteId: 'site-a' } as never)
    await db.siteUserData.put({ ...legacyRow({ componentId: 'quiz-old', updatedAt: 1, savedToRemote: true }), siteId: 'site-a' } as never)
    const deleted = await userDataService.cleanupOldData(1)
    expect(deleted).toBe(1)
    expect(await db.siteUserData.get(['u1', 'site-a', 'page-1', 'code-editor-a', '', ''])).toBeTruthy()
  })
})

describe('syncEngine site gating', () => {
  it('never queues items without a real site', () => {
    const before = syncEngine.getStatus().pending
    syncEngine.queueSync('quiz-q1', 'page-1', '{}', 1, { siteId: '' })
    syncEngine.queueSync('quiz-q1', 'page-1', '{}', 1, { siteId: LEGACY_SITE_ID })
    syncEngine.queueSync('quiz-q1', 'page-1', '{}', 1, { siteId: null })
    expect(syncEngine.getStatus().pending).toBe(before)
  })
})

describe('old-tab writes after the upgrade (bughunt #2)', () => {
  beforeEach(async () => {
    await db.siteUserData.clear()
    await db.userData.clear()
    await userDataService.setCurrentUser('u1')
    userDataService.setCurrentSite(null)
    localStorage.removeItem('eduskript-userdata-legacy-sweep-at')
  })

  it('sweepLegacyTable copies v1 rows newer than the watermark as unsynced legacy rows', async () => {
    const { sweepLegacyTable } = await import('@/lib/userdata/migrations')
    localStorage.setItem('eduskript-userdata-legacy-sweep-at', '1000')
    await db.userData.bulkPut([
      legacyRow({ updatedAt: 500 }) as never, // already copied by the upgrade
      legacyRow({ componentId: 'quiz-new', updatedAt: 2000, savedToRemote: true }) as never, // old tab wrote + "synced"
    ])
    expect(await sweepLegacyTable()).toBe(1)
    const rows = await db.siteUserData.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ componentId: 'quiz-new', siteId: LEGACY_SITE_ID, savedToRemote: false })
    expect(localStorage.getItem('eduskript-userdata-legacy-sweep-at')).toBe('2000')
    expect(await db.userData.count()).toBe(2) // v1 table untouched
  })

  it('without a watermark the sweep does nothing (no double copy)', async () => {
    const { sweepLegacyTable } = await import('@/lib/userdata/migrations')
    await db.userData.put(legacyRow({ updatedAt: 5000 }) as never)
    expect(await sweepLegacyTable()).toBe(0)
    expect(await db.siteUserData.count()).toBe(0)
  })

  it('a legacy row newer than the site row wins and stays unsynced; an older one is left alone', async () => {
    await db.siteUserData.put({ ...legacyRow({ updatedAt: 100, version: 5, savedToRemote: true, data: { v: 'site' } }), siteId: 'site-a' } as never)
    await db.siteUserData.put({ ...legacyRow({ updatedAt: 200, version: 2, data: { v: 'old-tab' } }), siteId: LEGACY_SITE_ID } as never)
    userDataService.setCurrentSite('site-a')
    const rec = await userDataService.get('page-1', 'code-editor-a')
    expect(rec).toMatchObject({ siteId: 'site-a', data: { v: 'old-tab' }, version: 6, savedToRemote: false })
    expect(await db.siteUserData.get(['u1', LEGACY_SITE_ID, 'page-1', 'code-editor-a', '', ''])).toBeUndefined()

    await db.siteUserData.put({ ...legacyRow({ componentId: 'x', updatedAt: 1 }), siteId: LEGACY_SITE_ID } as never)
    await db.siteUserData.put({ ...legacyRow({ componentId: 'x', updatedAt: 9 }), siteId: 'site-a' } as never)
    expect((await userDataService.get('page-1', 'x'))?.updatedAt).toBe(9)
    expect(await db.siteUserData.get(['u1', LEGACY_SITE_ID, 'page-1', 'x', '', ''])).toBeTruthy()
  })
})

describe('explicit site beats the global (bughunt #11/#24/#25)', () => {
  beforeEach(async () => {
    await db.siteUserData.clear()
    await userDataService.setCurrentUser('u1')
  })

  it('a save with an explicit site lands there even after the global was reset', async () => {
    userDataService.setCurrentSite(null) // e.g. bridge reset during unmount
    await userDataService.save('page-1', 'annotations', { strokes: 1 }, { immediate: true, siteId: 'site-a' })
    expect(await db.siteUserData.get(['u1', 'site-a', 'page-1', 'annotations', '', ''])).toBeTruthy()
    expect(await db.siteUserData.get(['u1', '', 'page-1', 'annotations', '', ''])).toBeUndefined()
    expect((await userDataService.get('page-1', 'annotations', { siteId: 'site-a' }))?.data).toEqual({ strokes: 1 })
  })
})

describe('never-synced legacy rows (bughunt #12)', () => {
  beforeEach(async () => {
    await db.siteUserData.clear()
    await userDataService.setCurrentUser('u1')
  })

  it('getComponentsForPage adopts the page\'s legacy rows', async () => {
    await db.siteUserData.put({ ...legacyRow({ componentId: 'code-editor-z' }), siteId: LEGACY_SITE_ID } as never)
    userDataService.setCurrentSite('site-a')
    expect(await userDataService.getComponentsForPage('page-1')).toEqual(['code-editor-z'])
  })

  it('initial sync adopts unsynced legacy rows the server says are placed on the site, and pushes them', async () => {
    await db.siteUserData.bulkPut([
      { ...legacyRow({ pageId: 'placed-page' }), siteId: LEGACY_SITE_ID },
      { ...legacyRow({ pageId: 'other-page' }), siteId: LEGACY_SITE_ID },
    ] as never)
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push(url)
      if (url.startsWith('/api/user-data/manifest')) return new Response('[]', { status: 200 })
      if (url.includes('/placed')) {
        expect(JSON.parse(init!.body!).itemIds.sort()).toEqual(['other-page', 'placed-page'])
        return new Response(JSON.stringify({ placed: ['placed-page'] }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, synced: 1, conflicts: [] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      syncEngine.setSiteId('site-a')
      syncEngine.setUser('u1')
      await vi.waitFor(async () => {
        expect(await db.siteUserData.get(['u1', 'site-a', 'placed-page', 'code-editor-a', '', ''])).toBeTruthy()
      })
      expect(await db.siteUserData.get(['u1', LEGACY_SITE_ID, 'other-page', 'code-editor-a', '', ''])).toBeTruthy()
    } finally {
      syncEngine.setUser(null)
      vi.unstubAllGlobals()
    }
  })
})
