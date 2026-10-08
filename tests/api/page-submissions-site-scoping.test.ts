import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// GET /api/pages/[id]/submissions?siteId= — answers are listed per site, for
// the site's managers only (personal owner / org owner+admin). Page authorship
// and superadmin grant nothing.

const mocks = vi.hoisted(() => ({
  prisma: {
    page: { findUnique: vi.fn() },
    site: { findUnique: vi.fn() },
    userData: { findMany: vi.fn() },
    user: { findMany: vi.fn(), findFirst: vi.fn() },
    examSubmission: { findMany: vi.fn() },
  },
  getSiteAccess: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/site-access', () => ({ getSiteAccess: mocks.getSiteAccess }))
vi.mock('@/lib/privacy/pseudonym', () => ({ generatePseudonym: () => 'x' }))

import { getServerSession } from 'next-auth'
import { GET } from '@/app/api/pages/[id]/submissions/route'

const p = mocks.prisma
const session = getServerSession as unknown as ReturnType<typeof vi.fn>
const ctx = { params: Promise.resolve({ id: 'page-1' }) }
const get = (siteId?: string) =>
  GET(new NextRequest(`http://localhost/api/pages/page-1/submissions${siteId ? `?siteId=${siteId}` : ''}`), ctx)

beforeEach(() => {
  vi.clearAllMocks()
  p.page.findUnique.mockResolvedValue({ pageType: 'normal', authors: [{ userId: 'author-1' }], skript: { authors: [] } })
  p.site.findUnique.mockResolvedValue({ userId: null, organization: { members: [{ userId: 'org-admin' }] } })
  p.userData.findMany.mockResolvedValue([{ userId: 'student-1', adapter: 'quiz-q1', updatedAt: new Date(1) }])
  p.user.findMany.mockResolvedValue([{ id: 'student-1', name: 'S', email: null, studentPseudonym: 'p', oauthProvider: null }])
  p.examSubmission.findMany.mockResolvedValue([])
})

describe('page submissions — site scoping', () => {
  it('org admin sees the answers given on the org site, filtered by siteId', async () => {
    session.mockResolvedValue({ user: { id: 'org-admin' } })
    mocks.getSiteAccess.mockResolvedValue({ siteId: 'org-site', kind: 'org', canManage: true, isOwner: false })
    const body = await (await get('org-site')).json()
    expect(body.isAuthor).toBe(true)
    expect(body.submissions.map((s: { userId: string }) => s.userId)).toEqual(['student-1'])
    expect(p.userData.findMany.mock.calls[0][0].where).toEqual({ itemId: 'page-1', siteId: 'org-site' })
  })

  it('a co-author who does not manage the site sees nothing', async () => {
    session.mockResolvedValue({ user: { id: 'author-1' } })
    mocks.getSiteAccess.mockResolvedValue({ siteId: 'site-a', kind: 'personal', canManage: false, isOwner: false })
    const body = await (await get('site-a')).json()
    expect(body).toEqual({ isAuthor: false, submissions: [], yourAnonymousUserId: null })
    expect(p.userData.findMany).not.toHaveBeenCalled()
  })

  it('no superadmin bypass', async () => {
    session.mockResolvedValue({ user: { id: 'platform-admin', isAdmin: true } })
    mocks.getSiteAccess.mockResolvedValue({ siteId: 'site-a', kind: 'personal', canManage: false, isOwner: false })
    const body = await (await get('site-a')).json()
    expect(body.submissions).toEqual([])
  })

  it('without siteId nothing is returned', async () => {
    session.mockResolvedValue({ user: { id: 'org-admin' } })
    mocks.getSiteAccess.mockResolvedValue(null)
    const body = await (await get()).json()
    expect(body.isAuthor).toBe(false)
  })
})
