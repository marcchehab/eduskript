import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Session } from 'next-auth'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    skript: { findFirst: vi.fn() },
    video: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { POST } from '@/app/api/videos/import/route'

const userId = 'user-1'
const mockSession: Session = {
  user: {
    id: userId,
    email: 'a@b.com',
    name: 'A',
    title: 'T',
    isAdmin: false,
    requirePasswordReset: false,
  },
  expires: new Date(Date.now() + 86400000).toISOString(),
}

// Video reusable by the user, not yet linked to the target skript.
const videoBase = {
  id: 'vid-1',
  filename: 'lecture.mp4',
  provider: 'mux',
  metadata: { poster: 'https://img/p.jpg', status: 'ready' },
  skripts: [] as { id: string }[],
}

const makeReq = (body: object) =>
  new NextRequest('http://localhost/api/videos/import', {
    method: 'POST',
    body: JSON.stringify(body),
  })

describe('POST /api/videos/import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const res = await POST(makeReq({ sourceVideoId: 's', targetSkriptId: 't' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 on invalid body', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    const res = await POST(makeReq({ sourceVideoId: 1, targetSkriptId: null }))
    expect(res.status).toBe(400)
  })

  it('returns 403 when user is not author of target skript', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.skript.findFirst).mockResolvedValue(null)

    const res = await POST(makeReq({ sourceVideoId: 'vid-1', targetSkriptId: 'skr-target' }))
    expect(res.status).toBe(403)
  })

  it('returns 404 when the video is not found or not accessible', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.skript.findFirst).mockResolvedValue({ id: 'skr-target' } as Awaited<ReturnType<typeof prisma.skript.findFirst>>)
    vi.mocked(prisma.video.findFirst).mockResolvedValue(null)

    const res = await POST(makeReq({ sourceVideoId: 'vid-1', targetSkriptId: 'skr-target' }))
    expect(res.status).toBe(404)
  })

  it('returns 409 when the video is already linked to the target skript', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.skript.findFirst).mockResolvedValue({ id: 'skr-target' } as Awaited<ReturnType<typeof prisma.skript.findFirst>>)
    vi.mocked(prisma.video.findFirst).mockResolvedValue({
      ...videoBase,
      skripts: [{ id: 'skr-target' }],
    } as unknown as Awaited<ReturnType<typeof prisma.video.findFirst>>)

    const res = await POST(makeReq({ sourceVideoId: 'vid-1', targetSkriptId: 'skr-target' }))
    expect(res.status).toBe(409)
    expect(prisma.video.update).not.toHaveBeenCalled()
  })

  it('connects the video to the target skript on the happy path', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.skript.findFirst).mockResolvedValue({ id: 'skr-target' } as Awaited<ReturnType<typeof prisma.skript.findFirst>>)
    vi.mocked(prisma.video.findFirst).mockResolvedValue(
      videoBase as unknown as Awaited<ReturnType<typeof prisma.video.findFirst>>
    )
    vi.mocked(prisma.video.update).mockResolvedValue({} as Awaited<ReturnType<typeof prisma.video.update>>)

    const res = await POST(makeReq({ sourceVideoId: 'vid-1', targetSkriptId: 'skr-target' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.video).toMatchObject({
      id: 'vid-1',
      filename: 'lecture.mp4',
      provider: 'mux',
      poster: 'https://img/p.jpg',
      status: 'ready',
    })

    const updateArgs = vi.mocked(prisma.video.update).mock.calls[0][0]
    expect(updateArgs).toMatchObject({
      where: { id: 'vid-1' },
      data: { skripts: { connect: { id: 'skr-target' } } },
    })
  })
})
