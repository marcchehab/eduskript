import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Bughunt #41/#44: a NEW org root skript needs the acting admin's own read
// access; skripts already in the layout survive a re-save.

const mocks = vi.hoisted(() => ({
  prisma: {
    site: { findUnique: vi.fn(async () => ({ id: 'org-site', slug: 'school' })), findFirst: vi.fn(async () => ({ id: 'org-site', slug: 'school' })) },
    organizationMember: { findMany: vi.fn(async () => [{ userId: 'admin' }, { userId: 'other-admin' }]) },
    pageLayout: {
      findUnique: vi.fn(async () => ({ items: [{ contentId: 'kept' }] })),
      upsert: vi.fn(async (a: { create: { items: { create: unknown[] } } }) => ({ items: a.create.items.create, site: { slug: 'school' } })),
    },
    collection: { findFirst: vi.fn() },
  },
  canPlaceSkript: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn(), unstable_cache: (f: unknown) => f }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/org-auth', () => ({ requireOrgAdmin: vi.fn(async () => ({ session: { user: { id: 'admin', email: 'a@x' } } })) }))
vi.mock('@/lib/site-access', () => ({ canPlaceSkript: mocks.canPlaceSkript }))
vi.mock('@/lib/page-stable-link.server', () => ({ invalidateStableLinks: vi.fn() }))
vi.mock('@/lib/page-layout', () => ({ hydratePageLayoutItems: vi.fn(async () => []) }))

import { POST } from '@/app/api/organizations/[orgId]/page-layout/route'

beforeEach(() => vi.clearAllMocks())

describe('org page layout placement', () => {
  it('drops a new skript the acting admin cannot read (even if another admin authors it); keeps existing ones', async () => {
    mocks.canPlaceSkript.mockImplementation(async (_u: string, id: string) => id === 'readable')
    const res = await POST(
      new NextRequest('http://localhost/api/organizations/o1/page-layout', {
        method: 'POST',
        body: JSON.stringify({ items: [
          { id: 'kept', type: 'skript' },
          { id: 'other-admins-skript', type: 'skript' },
          { id: 'readable', type: 'skript' },
        ] }),
      }),
      { params: Promise.resolve({ orgId: 'o1' }) },
    )
    expect(res.status).toBe(200)
    const created = mocks.prisma.pageLayout.upsert.mock.calls[0][0].create.items.create.map((i: { contentId: string }) => i.contentId)
    expect(created).toEqual(['kept', 'readable'])
  })
})
