import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Bughunt #13: a skript move only removes the memberships in collections the
// mover can edit (other teachers' placements stay) and never grants
// SkriptAuthor rights.

const tx = vi.hoisted(() => ({
  collectionSkript: { findMany: vi.fn(async () => []), deleteMany: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  skriptAuthor: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  skript: { findUnique: vi.fn(async () => ({ id: 'sk', collectionSkripts: [] })) },
}))
const p = vi.hoisted(() => ({
  skript: { findUnique: vi.fn(), count: vi.fn(async () => 1) },
  collection: { findUnique: vi.fn() },
  site: { findFirst: vi.fn(async () => null) },
  organizationMember: { findMany: vi.fn(async () => []) },
  $transaction: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'me' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/site-revalidate', () => ({ getPlacingSites: vi.fn(async () => []), revalidateSkriptOnPlacingSites: vi.fn() }))
vi.mock('@/lib/page-stable-link.server', () => ({ invalidateStableLinks: vi.fn() }))

import { POST } from '@/app/api/skripts/move/route'

beforeEach(() => {
  vi.clearAllMocks()
  p.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx))
  p.skript.findUnique.mockResolvedValue({
    id: 'sk',
    slug: 'sk',
    authors: [{ userId: 'author', permission: 'author', user: {} }, { userId: 'me', permission: 'viewer', user: {} }],
    collectionSkripts: [
      { collection: { id: 'my-col', site: { userId: 'me', organizationId: null } } },
      { collection: { id: 'their-col', site: { userId: 'other', organizationId: null } } },
    ],
  })
  p.collection.findUnique.mockResolvedValue({ id: 'my-col-2', site: { userId: 'me', organizationId: null } })
})

describe('POST /api/skripts/move — site scoping', () => {
  it('removes only the mover\'s collection memberships and grants no authorship', async () => {
    const res = await POST(new NextRequest('http://localhost/api/skripts/move', {
      method: 'POST',
      body: JSON.stringify({ skriptId: 'sk', targetCollectionId: 'my-col-2', order: 0 }),
    }))
    expect(res.status).toBe(200)
    expect(tx.collectionSkript.deleteMany).toHaveBeenCalledWith({ where: { skriptId: 'sk', collectionId: { in: ['my-col'] } } })
    expect(tx.skriptAuthor.create).not.toHaveBeenCalled()
    expect(tx.skriptAuthor.update).not.toHaveBeenCalled()
  })
})
