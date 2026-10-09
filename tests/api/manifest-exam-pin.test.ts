import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Bughunt #32: an SEB exam session pinned to a site cannot read another
// site's manifest.

const mocks = vi.hoisted(() => ({
  prisma: { examSession: { findUnique: vi.fn() }, userData: { findMany: vi.fn(async () => []) } },
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sess' }) }) }))

import { GET } from '@/app/api/user-data/manifest/route'

const get = (siteId: string) => GET(new NextRequest(`http://localhost/api/user-data/manifest?siteId=${siteId}`))

beforeEach(() => vi.clearAllMocks())

describe('manifest + SEB site pin', () => {
  it('403 for another site, 200 for the pinned one', async () => {
    mocks.prisma.examSession.findUnique.mockResolvedValue({ userId: 's1', expiresAt: new Date(Date.now() + 60_000), siteId: 'site-a' })
    expect((await get('site-b')).status).toBe(403)
    expect((await get('site-a')).status).toBe(200)
  })

  it('legacy session without site is not pinned', async () => {
    mocks.prisma.examSession.findUnique.mockResolvedValue({ userId: 's1', expiresAt: new Date(Date.now() + 60_000), siteId: '' })
    expect((await get('site-b')).status).toBe(200)
  })
})
