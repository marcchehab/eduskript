import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Session } from 'next-auth'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    file: { findMany: vi.fn() },
  },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET } from '@/app/api/files/search/route'

const mockSession: Session = {
  user: {
    id: 'user-1',
    email: 'a@b.com',
    name: 'A',
    username: 'a',
    title: 'T',
    isAdmin: false,
    requirePasswordReset: false,
  },
  expires: new Date(Date.now() + 86400000).toISOString(),
}

const makeReq = (qs = '') =>
  new NextRequest(`http://localhost/api/files/search${qs}`)

describe('GET /api/files/search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('issues a Prisma findMany scoped to author skripts', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.file.findMany).mockResolvedValue([])

    await GET(makeReq('?q=net&excludeSkriptId=skr-current'))

    const args = vi.mocked(prisma.file.findMany).mock.calls[0][0]!
    expect(args.where).toMatchObject({
      isDirectory: false,
      hash: { not: null },
      skriptId: { not: 'skr-current' },
      name: { contains: 'net', mode: 'insensitive' },
      skript: {
        authors: {
          some: { userId: 'user-1', permission: 'author' },
        },
      },
    })
    expect(args.take).toBe(50)
    expect(args.orderBy).toEqual({ updatedAt: 'desc' })
  })

  it('omits the name filter when q is empty', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.file.findMany).mockResolvedValue([])

    await GET(makeReq(''))

    const where = vi.mocked(prisma.file.findMany).mock.calls[0][0]!.where!
    expect('name' in where).toBe(false)
  })

  it('omits the excludeSkriptId filter when not provided', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.file.findMany).mockResolvedValue([])

    await GET(makeReq('?q=foo'))

    const where = vi.mocked(prisma.file.findMany).mock.calls[0][0]!.where!
    expect('skriptId' in where).toBe(false)
  })

  it('flattens results into the wire shape', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.file.findMany).mockResolvedValue([
      {
        id: 'f1',
        name: 'netflix.db',
        hash: 'abc',
        contentType: 'application/octet-stream',
        size: BigInt(1234),
        skriptId: 'skr-A',
        skript: { title: 'Skript A' },
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.file.findMany>>)

    const res = await GET(makeReq('?q=net'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.files).toEqual([
      {
        id: 'f1',
        name: 'netflix.db',
        hash: 'abc',
        contentType: 'application/octet-stream',
        size: 1234,
        sourceSkriptId: 'skr-A',
        sourceSkriptTitle: 'Skript A',
      },
    ])
  })

  it('handles null size gracefully', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.file.findMany).mockResolvedValue([
      {
        id: 'f1',
        name: 'foo.png',
        hash: 'x',
        contentType: 'image/png',
        size: null,
        skriptId: 'skr-A',
        skript: { title: 'Skript A' },
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.file.findMany>>)

    const body = await (await GET(makeReq())).json()
    expect(body.files[0].size).toBeNull()
  })
})
