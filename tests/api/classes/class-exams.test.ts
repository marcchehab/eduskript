import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    class: { findUnique: vi.fn() },
    classMembership: { findMany: vi.fn() },
    page: { findMany: vi.fn() },
    examSubmission: { findMany: vi.fn() },
    componentScore: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/scoring/return-state', () => ({ getCurrentReturnsForPage: vi.fn() }))
vi.mock('@/lib/scoring/auth', () => ({ getExamUrl: vi.fn() }))

import { GET } from '@/app/api/classes/[id]/exams/route'
import { prisma } from '@/lib/prisma'
import { getCurrentReturnsForPage } from '@/lib/scoring/return-state'
import { getExamUrl } from '@/lib/scoring/auth'

const req = () => new NextRequest('http://localhost:3000/api/classes/c1/exams')
const params = { params: Promise.resolve({ id: 'c1' }) }

describe('GET /api/classes/[id]/exams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 't1' } } as never)
    vi.mocked(prisma.class.findUnique).mockResolvedValue({ teacherId: 't1' } as never)
  })

  it('rejects a teacher who does not own the class', async () => {
    vi.mocked(prisma.class.findUnique).mockResolvedValue({ teacherId: 'other' } as never)
    const res = await GET(req(), params)
    expect(res.status).toBe(403)
  })

  it('lists the class exams with handed-in / graded / returned counts and a grading link', async () => {
    vi.mocked(prisma.classMembership.findMany).mockResolvedValue([
      { studentId: 's1' },
      { studentId: 's2' },
      { studentId: 's3' },
    ] as never)
    vi.mocked(prisma.page.findMany).mockResolvedValue([{ id: 'p1', title: 'Klassenarbeit 2' }] as never)
    vi.mocked(prisma.examSubmission.findMany).mockResolvedValue([
      { pageId: 'p1', studentId: 's1', submittedAt: new Date('2026-10-01T10:00:00Z') },
      { pageId: 'p1', studentId: 's2', submittedAt: new Date('2026-10-01T11:00:00Z') },
    ] as never)
    // s1 has a teacher override -> graded; s2 nothing yet
    vi.mocked(prisma.componentScore.findMany).mockResolvedValue([
      { pageId: 'p1', studentId: 's1' },
    ] as never)
    vi.mocked(getCurrentReturnsForPage).mockResolvedValue(
      new Map([['s1', { returned: true, score: 5, at: new Date(), by: 't1' }]]),
    )
    vi.mocked(getExamUrl).mockResolvedValue('/exam/site/skript/klassenarbeit2')

    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.exams).toEqual([
      {
        pageId: 'p1',
        title: 'Klassenarbeit 2',
        memberCount: 3,
        handedIn: 2,
        graded: 1,
        returned: 1,
        lastSubmittedAt: '2026-10-01T11:00:00.000Z',
        gradingUrl: '/dashboard/exams/p1/grading?classId=c1',
        examUrl: '/exam/site/skript/klassenarbeit2',
      },
    ])
    // Only exams the teacher authors (grading page requires authorship).
    const where = vi.mocked(prisma.page.findMany).mock.calls[0][0]!.where as Record<string, unknown>
    expect(where.authors).toEqual({ some: { userId: 't1' } })
  })
})
