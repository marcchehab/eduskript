import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Bughunt #40/#27: start-session must never trust a userId from the query
// string; the user comes only from a valid one-time SEB token. siteId is
// required, returnUrl must be a same-origin path.

const mocks = vi.hoisted(() => ({
  validateExamToken: vi.fn(),
  createExamSession: vi.fn(async () => 'sess-1'),
  isItemPlacedOnSite: vi.fn(async () => true),
  page: { findUnique: vi.fn(async () => ({ skriptId: 'sk-1' })) },
  cookieSet: vi.fn(),
}))
vi.mock('@/lib/exam-tokens', () => ({ validateExamToken: mocks.validateExamToken, createExamSession: mocks.createExamSession }))
vi.mock('@/lib/site-access', () => ({ isItemPlacedOnSite: mocks.isItemPlacedOnSite }))
vi.mock('@/lib/prisma', () => ({ prisma: { page: mocks.page } }))
vi.mock('@/lib/public-origin', () => ({ getPublicOrigin: () => 'http://localhost' }))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.cookieSet }) }))

import { GET } from '@/app/api/exams/[pageId]/start-session/route'

const ctx = { params: Promise.resolve({ pageId: 'page-1' }) }
const get = (qs: string) => GET(new NextRequest(`http://localhost/api/exams/page-1/start-session?${qs}`), ctx)

beforeEach(() => vi.clearAllMocks())

describe('GET start-session', () => {
  it('ignores a userId in the query: no token → 400, no session', async () => {
    const res = await get('userId=victim&skriptId=sk-1&siteId=s1&returnUrl=%2Fexam%2Fx')
    expect(res.status).toBe(400)
    expect(mocks.createExamSession).not.toHaveBeenCalled()
  })

  it('invalid/used token → 401, no session', async () => {
    mocks.validateExamToken.mockResolvedValue(null)
    const res = await get('token=t&siteId=s1&returnUrl=%2Fexam%2Fx&userId=victim')
    expect(res.status).toBe(401)
    expect(mocks.createExamSession).not.toHaveBeenCalled()
  })

  it('valid token: consumes it and uses ITS user, the page skript and the site', async () => {
    mocks.validateExamToken.mockResolvedValue('token-user')
    const res = await get('token=t&siteId=s1&returnUrl=%2Fexam%2Fx&userId=victim')
    expect(res.status).toBe(307)
    expect(mocks.validateExamToken).toHaveBeenCalledWith('t', 'page-1', true)
    expect(mocks.createExamSession).toHaveBeenCalledWith('token-user', 'page-1', 'sk-1', 's1')
  })

  it('requires siteId and rejects absolute/protocol-relative returnUrls', async () => {
    mocks.validateExamToken.mockResolvedValue('token-user')
    expect((await get('token=t&returnUrl=%2Fexam')).status).toBe(400)
    expect((await get('token=t&siteId=s1&returnUrl=https%3A%2F%2Fevil.example')).status).toBe(400)
    expect((await get('token=t&siteId=s1&returnUrl=%2F%2Fevil.example')).status).toBe(400)
    expect(mocks.createExamSession).not.toHaveBeenCalled()
  })

  it('site that does not place the page → 403', async () => {
    mocks.isItemPlacedOnSite.mockResolvedValueOnce(false)
    expect((await get('token=t&siteId=other&returnUrl=%2Fexam')).status).toBe(403)
  })
})
