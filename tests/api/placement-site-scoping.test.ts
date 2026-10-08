import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Rule 3: a teacher may place ANY skript they can access — read access
// (SkriptAuthor viewer, or a page share) suffices — on a site they own.

const mocks = vi.hoisted(() => ({
  prisma: {
    site: { findFirst: vi.fn() },
    collection: { findFirst: vi.fn(), findUnique: vi.fn() },
    skript: { count: vi.fn(), findUnique: vi.fn() },
    pageLayout: { upsert: vi.fn() },
    organizationMember: { findMany: vi.fn() },
    collectionSkript: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/page-layout', () => ({ hydratePageLayoutItems: vi.fn(async () => []) }))

import { getServerSession } from 'next-auth'
import { POST as saveLayout } from '@/app/api/sites/[siteId]/page-layout/route'
import { POST as addToCollection } from '@/app/api/collections/[id]/skripts/route'

const p = mocks.prisma
const session = getServerSession as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  session.mockResolvedValue({ user: { id: 'teacher-b', email: 'b@x' } })
  p.site.findFirst.mockResolvedValue({ id: 'site-b', slug: 'b' })
  p.pageLayout.upsert.mockImplementation(async (args: { create: { items: { create: unknown[] } } }) => ({ items: args.create.items.create }))
})

describe('placing skripts (site scoping rule 3)', () => {
  it('a viewer-permission skript can be placed as a root item on the own site', async () => {
    p.skript.count.mockResolvedValue(1) // canPlaceSkript: viewer row matches
    const res = await saveLayout(
      new NextRequest('http://localhost/api/sites/site-b/page-layout', {
        method: 'POST',
        body: JSON.stringify({ items: [{ id: 'shared-skript', type: 'skript' }] }),
      }),
      { params: Promise.resolve({ siteId: 'site-b' }) },
    )
    expect(res.status).toBe(200)
    const where = p.skript.count.mock.calls[0][0].where
    expect(JSON.stringify(where)).not.toContain('permission') // viewer OR author
    expect(p.pageLayout.upsert.mock.calls[0][0].create.items.create).toEqual([
      { type: 'skript', contentId: 'shared-skript', order: 0 },
    ])
  })

  it('a skript without any access is dropped', async () => {
    p.skript.count.mockResolvedValue(0)
    await saveLayout(
      new NextRequest('http://localhost/api/sites/site-b/page-layout', {
        method: 'POST',
        body: JSON.stringify({ items: [{ id: 'foreign', type: 'skript' }] }),
      }),
      { params: Promise.resolve({ siteId: 'site-b' }) },
    )
    expect(p.pageLayout.upsert.mock.calls[0][0].create.items.create).toEqual([])
  })

  it('adding a skript to a collection now requires access (was unchecked)', async () => {
    p.collection.findUnique.mockResolvedValue({ id: 'col', site: { userId: 'teacher-b', organizationId: null, slug: 'b' } })
    p.skript.findUnique.mockResolvedValue({ id: 'foreign' })
    p.skript.count.mockResolvedValue(0)
    const res = await addToCollection(
      new NextRequest('http://localhost/api/collections/col/skripts', {
        method: 'POST',
        body: JSON.stringify({ skriptId: 'foreign' }),
      }),
      { params: Promise.resolve({ id: 'col' }) },
    )
    expect(res.status).toBe(403)
  })
})
