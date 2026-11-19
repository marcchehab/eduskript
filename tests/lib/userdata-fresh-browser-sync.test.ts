// Must be the first import: installs an in-memory IndexedDB before Dexie loads.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/userdata/schema'
import { userDataService, REMOTE_CHANGE_SOURCE } from '@/lib/userdata/userDataService'
import { syncEngine } from '@/lib/userdata/sync-engine'
import { annotationsAdapter } from '@/lib/userdata/adapters'
import type { AnnotationData } from '@/lib/userdata/types'

/**
 * Findings annotations-not-shown-on-first-visit-fresh-browser and
 * annotations-new-browser-overwrites-server-strokes (QA run 2026-11-19-a):
 * in a browser with an empty IndexedDB the initial sync wrote the server row
 * into IndexedDB without telling mounted hooks, and a local write pushed
 * during the manifest pass replaced the server row.
 */

const stroke = (id: string) => ({ id, points: [{ x: 1, y: 2, pressure: 0.5 }], mode: 'draw', color: '#000', width: 2, sectionId: 'h2-a', sectionOffsetY: 100 })
const ann = (...ids: string[]): AnnotationData => ({
  canvasData: ids.length ? JSON.stringify(ids.map(stroke)) : '',
  headingOffsets: { 'h2-a': 100 },
  pageVersion: 'v1',
})
const idsOf = (d: AnnotationData) => annotationsAdapter.itemIds!(d)

describe('annotations adapter', () => {
  it('merge keeps strokes from both sides (union by id, local first)', () => {
    const merged = annotationsAdapter.merge!(ann('x'), ann('a', 'b', 'x'))
    expect(idsOf(merged)).toEqual(['x', 'a', 'b'])
  })

  it('merge of an empty local with a remote keeps the remote strokes', () => {
    expect(idsOf(annotationsAdapter.merge!(ann(), ann('a', 'b')))).toEqual(['a', 'b'])
  })

  it('merge leaves stroke anchoring (sectionId/sectionOffsetY/points) untouched', () => {
    const merged = annotationsAdapter.merge!(ann('x'), ann('a'))
    expect(JSON.parse(merged.canvasData)).toEqual([stroke('x'), stroke('a')])
  })

  it('addItems appends only the requested strokes', () => {
    const out = annotationsAdapter.addItems!(ann('x'), ann('a', 'b', 'c'), new Set(['a', 'c']))
    expect(idsOf(out)).toEqual(['x', 'a', 'c'])
  })
})

describe('sync engine on a fresh browser', () => {
  const KEY = ['u1', 'site-a', 'page-1', 'annotations', '', ''] as const
  const SERVER = { adapter: 'annotations', itemId: 'page-1', version: 1, updatedAt: 1000 }

  beforeEach(async () => {
    await db.siteUserData.clear()
    await userDataService.setCurrentUser('u1')
    userDataService.setCurrentSite('site-a')
  })
  afterEach(() => {
    syncEngine.setUser(null)
    syncEngine.setSiteId(null)
    vi.unstubAllGlobals()
  })

  it('notifies a subscribed hook when the manifest pass fetches the server row', async () => {
    const received: Array<{ data: AnnotationData; source?: string }> = []
    const unsubscribe = userDataService.subscribe<AnnotationData>('page-1', 'annotations', (data, source) => {
      received.push({ data, source })
    }, { siteId: 'site-a' })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/user-data/manifest')) return new Response(JSON.stringify([SERVER]), { status: 200 })
      if (url === '/api/user-data/bulk-fetch') {
        return new Response(JSON.stringify({ items: [{ ...SERVER, data: ann('a', 'b') }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ conflicts: [] }), { status: 200 })
    }))
    try {
      syncEngine.setSiteId('site-a')
      syncEngine.setUser('u1')
      await vi.waitFor(() => expect(received).toHaveLength(1))
      expect(received[0].source).toBe(REMOTE_CHANGE_SOURCE)
      expect(idsOf(received[0].data)).toEqual(['a', 'b'])
    } finally {
      unsubscribe()
    }
  })

  it('holds a write made during the manifest pass and pushes the merged row afterwards', async () => {
    let releaseBulk!: () => void
    const bulkHeld = new Promise<void>((r) => { releaseBulk = r })
    const pushed: AnnotationData[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      if (url.startsWith('/api/user-data/manifest')) return new Response(JSON.stringify([SERVER]), { status: 200 })
      if (url === '/api/user-data/bulk-fetch') {
        await bulkHeld
        return new Response(JSON.stringify({ items: [{ ...SERVER, data: ann('a', 'b') }] }), { status: 200 })
      }
      if (url === '/api/user-data/sync') {
        for (const it of JSON.parse(init!.body!).items) pushed.push(JSON.parse(it.data))
        return new Response(JSON.stringify({ conflicts: [] }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }))

    syncEngine.setSiteId('site-a')
    syncEngine.setUser('u1')
    // Wait until the engine is inside the bulk fetch.
    await vi.waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(c => c[0] === '/api/user-data/bulk-fetch')).toBe(true))

    // Local write with no knowledge of the server row (same version as the
    // server: the server would accept it and replace a, b).
    await userDataService.save('page-1', 'annotations', ann('x'), { siteId: 'site-a', immediate: true })
    syncEngine.queueSync('annotations', 'page-1', JSON.stringify(ann('x')), 1, { siteId: 'site-a', immediate: true })
    await new Promise((r) => setTimeout(r, 50))
    expect(pushed).toHaveLength(0)

    releaseBulk()
    await vi.waitFor(() => expect(pushed.length).toBeGreaterThan(0), { timeout: 5000 })
    expect(idsOf(pushed[pushed.length - 1]).sort()).toEqual(['a', 'b', 'x'])
    const local = await db.siteUserData.get([...KEY])
    expect(idsOf(local!.data as AnnotationData).sort()).toEqual(['a', 'b', 'x'])
  })
})
