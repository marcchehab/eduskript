import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Bughunt #33: a student's snap image is readable by managers of a site that
// holds the student's snaps for that page — not by any class teacher.

const mocks = vi.hoisted(() => ({
  prisma: { user: { findUnique: vi.fn() }, userData: { findFirst: vi.fn() } },
  managed: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/s3', () => ({ isS3Configured: () => true, downloadFromS3: vi.fn(async () => Buffer.from('x')) }))
vi.mock('@/lib/site-access', () => ({ getManagedSiteIds: mocks.managed }))

import { getServerSession } from 'next-auth'
import { GET } from '@/app/api/snaps/image/[...key]/route'

const session = getServerSession as unknown as ReturnType<typeof vi.fn>
const call = () => GET(new NextRequest('http://localhost/x'), { params: Promise.resolve({ key: ['snaps', 'stud', 'page-1', 'snap.png'] }) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.user.findUnique.mockResolvedValue({ accountType: 'student' })
})

describe('snap image access', () => {
  it('manager of a site holding the snaps for that page → 200', async () => {
    session.mockResolvedValue({ user: { id: 'org-admin' } })
    mocks.managed.mockResolvedValue(['org-site'])
    mocks.prisma.userData.findFirst.mockResolvedValue({ id: 'row' })
    expect((await call()).status).toBe(200)
    expect(mocks.prisma.userData.findFirst.mock.calls[0][0].where).toEqual({
      userId: 'stud', adapter: 'snaps', itemId: 'page-1', siteId: { in: ['org-site'] },
    })
  })

  it('a class teacher who manages no site holding them → 403', async () => {
    session.mockResolvedValue({ user: { id: 'teacher' } })
    mocks.managed.mockResolvedValue(['own-site'])
    mocks.prisma.userData.findFirst.mockResolvedValue(null)
    expect((await call()).status).toBe(403)
  })
})
