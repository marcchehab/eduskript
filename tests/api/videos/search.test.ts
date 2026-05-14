import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Session } from 'next-auth'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    video: { findMany: vi.fn() },
  },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET } from '@/app/api/videos/search/route'

const mockSession: Session = {
  user: {
    id: 'user-1',
    email: 'a@b.com',
    name: 'A',
    title: 'T',
    isAdmin: false,
    requirePasswordReset: false,
  },
  expires: new Date(Date.now() + 86400000).toISOString(),
}

const makeReq = (qs = '') =>
  new NextRequest(`http://localhost/api/videos/search${qs}`)

describe('GET /api/videos/search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('issues a Prisma findMany scoped to uploads + authored skripts', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.video.findMany).mockResolvedValue([])

    await GET(makeReq('?q=lecture&excludeSkriptId=skr-current'))

    const args = vi.mocked(prisma.video.findMany).mock.calls[0][0]!
    expect(args.where).toMatchObject({
      OR: [
        { uploadedById: 'user-1' },
        { skripts: { some: { authors: { some: { userId: 'user-1', permission: 'author' } } } } },
      ],
      skripts: { none: { id: 'skr-current' } },
      filename: { contains: 'lecture', mode: 'insensitive' },
    })
    expect(args.take).toBe(50)
    expect(args.orderBy).toEqual({ updatedAt: 'desc' })
  })

  it('omits the filename filter when q is empty', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.video.findMany).mockResolvedValue([])

    await GET(makeReq(''))

    const where = vi.mocked(prisma.video.findMany).mock.calls[0][0]!.where!
    expect('filename' in where).toBe(false)
  })

  it('omits the excludeSkriptId filter when not provided', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.video.findMany).mockResolvedValue([])

    await GET(makeReq('?q=foo'))

    const where = vi.mocked(prisma.video.findMany).mock.calls[0][0]!.where!
    expect('skripts' in where).toBe(false)
  })

  it('flattens results into the wire shape', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.video.findMany).mockResolvedValue([
      {
        id: 'v1',
        filename: 'lecture.mp4',
        provider: 'mux',
        metadata: { poster: 'https://img/poster.jpg', status: 'ready' },
        skripts: [{ title: 'Skript A' }, { title: 'Skript B' }],
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.video.findMany>>)

    const res = await GET(makeReq('?q=lec'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.videos).toEqual([
      {
        id: 'v1',
        filename: 'lecture.mp4',
        provider: 'mux',
        poster: 'https://img/poster.jpg',
        status: 'ready',
        skriptTitles: ['Skript A', 'Skript B'],
      },
    ])
  })

  it('defaults poster to null and status to ready when metadata is sparse', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.video.findMany).mockResolvedValue([
      {
        id: 'v1',
        filename: 'raw.mp4',
        provider: 'mux',
        metadata: {},
        skripts: [],
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.video.findMany>>)

    const body = await (await GET(makeReq())).json()
    expect(body.videos[0]).toMatchObject({ poster: null, status: 'ready', skriptTitles: [] })
  })
})
