import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'

// vi.mock is hoisted to top of file before imports — define mock state via
// vi.hoisted so the factory closures can see them.
const mocks = vi.hoisted(() => {
  const mockPrisma = {
    page: { findUnique: vi.fn() },
    class: { upsert: vi.fn() },
    user: { upsert: vi.fn() },
    classMembership: { upsert: vi.fn() },
    userData: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  }
  return { mockPrisma }
})

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))
vi.mock('@/lib/prisma', () => ({
  prisma: mocks.mockPrisma,
}))
vi.mock('@/lib/privacy/pseudonym', () => ({
  generatePseudonym: (input: string) => `pseudo-${input}`,
}))

import { getServerSession } from 'next-auth'
import { clearAllRateLimits } from '@/lib/rate-limit'
import { POST } from '@/app/api/survey-responses/route'

const mockPrisma = mocks.mockPrisma

function makeRequest(body: unknown, ip = '127.0.0.1') {
  return new NextRequest('http://localhost/api/survey-responses', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
  })
}

const VALID_SESSION_ID = '11111111-2222-3333-4444-555555555555'
const VALID_PAGE_ID = 'page-abc'

const validBody = {
  pageId: VALID_PAGE_ID,
  sessionId: VALID_SESSION_ID,
  answers: [
    { questionId: 'q1', type: 'single', value: [0] },
    { questionId: 'q2', type: 'text', value: 'free response' },
  ],
}

describe('POST /api/survey-responses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearAllRateLimits()
    // Default transaction: invoke callback with the mock prisma instance.
    mockPrisma.$transaction.mockImplementation(
      async (cb: (tx: typeof mockPrisma) => Promise<unknown>) => cb(mockPrisma)
    )
    mockPrisma.userData.findFirst.mockResolvedValue(null)
    mockPrisma.class.upsert.mockResolvedValue({ id: 'implicit-class-1' })
    mockPrisma.user.upsert.mockResolvedValue({ id: 'shell-user-1' })
    mockPrisma.classMembership.upsert.mockResolvedValue({ id: 'membership-1' })
    mockPrisma.userData.create.mockResolvedValue({ id: 'ud-1' })
  })

  it('rejects malformed body with 400', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const res = await POST(makeRequest({ pageId: 'x' }))
    expect(res.status).toBe(400)
  })

  it('rejects non-UUID sessionId with 400', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const res = await POST(
      makeRequest({ ...validBody, sessionId: 'not-a-uuid' })
    )
    expect(res.status).toBe(400)
  })

  it('rejects when page does not exist (404)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    mockPrisma.page.findUnique.mockResolvedValue(null)
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(404)
  })

  it('rejects when page has no <survey> region (400)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    mockPrisma.page.findUnique.mockResolvedValue({
      id: VALID_PAGE_ID,
      title: 'No Survey',
      content: 'Just markdown, no survey here.',
    })
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(400)
  })

  it('silently skips logged-in session without writing to DB', async () => {
    // Auth IS present
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'logged-in-user', email: 'marc@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    } as any)
    mockPrisma.page.findUnique.mockResolvedValue({
      id: VALID_PAGE_ID,
      title: 'Survey',
      content: 'Some intro\n<survey>\n<question id="q1">...</question>\n</survey>',
    })

    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.skipped).toBe('authenticated')

    // No writes occurred
    expect(mockPrisma.class.upsert).not.toHaveBeenCalled()
    expect(mockPrisma.user.upsert).not.toHaveBeenCalled()
    expect(mockPrisma.userData.create).not.toHaveBeenCalled()
  })

  it('records an anonymous submission with 201', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    mockPrisma.page.findUnique.mockResolvedValue({
      id: VALID_PAGE_ID,
      title: 'Material-Alltag',
      content: '<survey><question id="q1">...</question></survey>',
    })

    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(201)

    // Implicit class upserted for the pageId
    expect(mockPrisma.class.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { implicitPageId: VALID_PAGE_ID },
        create: expect.objectContaining({
          isImplicit: true,
          implicitPageId: VALID_PAGE_ID,
          allowAnonymous: true,
        }),
      })
    )

    // Shell user upserted with oauthProvider="survey"
    expect(mockPrisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          oauthProvider_oauthProviderId: {
            oauthProvider: 'survey',
            oauthProviderId: VALID_SESSION_ID,
          },
        },
        create: expect.objectContaining({
          accountType: 'student',
          oauthProvider: 'survey',
          oauthProviderId: VALID_SESSION_ID,
        }),
      })
    )

    // One userData row per answer (2 in valid body)
    expect(mockPrisma.userData.create).toHaveBeenCalledTimes(2)
  })

  it('returns 200 idempotent on Prisma P2002 unique-constraint violation', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    mockPrisma.page.findUnique.mockResolvedValue({
      id: VALID_PAGE_ID,
      title: 'x',
      content: '<survey><question id="q1">y</question></survey>',
    })

    // Make the transaction throw a P2002 the way Prisma would
    mockPrisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.0.0',
      })
    )

    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deduplicated).toBe(true)
  })

  it('rate-limits 6th submission from same IP within an hour', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    mockPrisma.page.findUnique.mockResolvedValue({
      id: VALID_PAGE_ID,
      title: 'x',
      content: '<survey><question id="q1">y</question></survey>',
    })

    // 5 submissions allowed, 6th must be 429.
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeRequest({
        ...validBody,
        sessionId: `${VALID_SESSION_ID.slice(0, -3)}${(100 + i).toString()}`.slice(0, 36)
      }, '203.0.113.1'))
      expect([200, 201]).toContain(res.status)
    }

    const sixth = await POST(makeRequest({
      ...validBody,
      sessionId: '99999999-9999-9999-9999-999999999999',
    }, '203.0.113.1'))
    expect(sixth.status).toBe(429)
  })
})
