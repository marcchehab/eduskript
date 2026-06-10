import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  mockPrisma: {
    site: { findUnique: vi.fn() },
    class: { findFirst: vi.fn() },
  },
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.mockPrisma }))

import { getServerSession } from 'next-auth'
import { GET } from '@/app/api/internal/check-lockdown/route'

const mockPrisma = mocks.mockPrisma
const mockSession = getServerSession as unknown as ReturnType<typeof vi.fn>

function req(pageSlug?: string) {
  const url = pageSlug
    ? `http://localhost/api/internal/check-lockdown?pageSlug=${pageSlug}`
    : 'http://localhost/api/internal/check-lockdown'
  return new NextRequest(url)
}

describe('GET /api/internal/check-lockdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('400s without pageSlug', async () => {
    const res = await GET(req())
    expect(res.status).toBe(400)
  })

  it('not locked for anonymous (no session)', async () => {
    mockSession.mockResolvedValue(null)
    const res = await GET(req('teacher-a'))
    expect(await res.json()).toEqual({ locked: false })
    expect(mockPrisma.class.findFirst).not.toHaveBeenCalled()
  })

  it('not locked for a teacher account', async () => {
    mockSession.mockResolvedValue({ user: { id: 't1', accountType: 'teacher' } })
    const res = await GET(req('teacher-a'))
    expect(await res.json()).toEqual({ locked: false })
    expect(mockPrisma.class.findFirst).not.toHaveBeenCalled()
  })

  it('not locked when the slug is an org site (no teacher userId)', async () => {
    mockSession.mockResolvedValue({ user: { id: 's1', accountType: 'student' } })
    mockPrisma.site.findUnique.mockResolvedValue({ userId: null })
    const res = await GET(req('some-org'))
    expect(await res.json()).toEqual({ locked: false })
    expect(mockPrisma.class.findFirst).not.toHaveBeenCalled()
  })

  it('locked when student is in a lockdown class of the site teacher', async () => {
    mockSession.mockResolvedValue({ user: { id: 's1', accountType: 'student' } })
    mockPrisma.site.findUnique.mockResolvedValue({ userId: 'teacher-1' })
    mockPrisma.class.findFirst.mockResolvedValue({ id: 'class-1' })
    const res = await GET(req('teacher-a'))
    expect(await res.json()).toEqual({ locked: true })
    // Scoped to this teacher + lockdown + active + this student.
    expect(mockPrisma.class.findFirst).toHaveBeenCalledWith({
      where: {
        teacherId: 'teacher-1',
        lockdownMode: true,
        isActive: true,
        memberships: { some: { studentId: 's1' } },
      },
      select: { id: true },
    })
  })

  it('not locked when student is in no lockdown class of the teacher', async () => {
    mockSession.mockResolvedValue({ user: { id: 's1', accountType: 'student' } })
    mockPrisma.site.findUnique.mockResolvedValue({ userId: 'teacher-1' })
    mockPrisma.class.findFirst.mockResolvedValue(null)
    const res = await GET(req('teacher-a'))
    expect(await res.json()).toEqual({ locked: false })
  })

  it('fails open (not locked) on a DB error', async () => {
    mockSession.mockResolvedValue({ user: { id: 's1', accountType: 'student' } })
    mockPrisma.site.findUnique.mockRejectedValue(new Error('db down'))
    const res = await GET(req('teacher-a'))
    expect(await res.json()).toEqual({ locked: false })
  })
})
