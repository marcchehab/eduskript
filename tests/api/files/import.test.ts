import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Session } from 'next-auth'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    file: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    skript: {
      findFirst: vi.fn(),
    },
  },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { POST } from '@/app/api/files/import/route'

const userId = 'user-1'
const mockSession: Session = {
  user: {
    id: userId,
    email: 'a@b.com',
    name: 'A',
    username: 'a',
    title: 'T',
    isAdmin: false,
    requirePasswordReset: false,
  },
  expires: new Date(Date.now() + 86400000).toISOString(),
}

const sourceFileBase = {
  id: 'src-1',
  name: 'netflix.db',
  isDirectory: false,
  hash: 'abc123',
  contentType: 'application/octet-stream',
  size: BigInt(4640768),
  width: null,
  height: null,
  skriptId: 'skr-source',
  skript: {
    id: 'skr-source',
    authors: [{ permission: 'author' as const }],
  },
}

const makeReq = (body: object) =>
  new NextRequest('http://localhost/api/files/import', {
    method: 'POST',
    body: JSON.stringify(body),
  })

describe('POST /api/files/import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const res = await POST(makeReq({ sourceFileId: 's', targetSkriptId: 't' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 on invalid body', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    const res = await POST(makeReq({ sourceFileId: 1, targetSkriptId: null }))
    expect(res.status).toBe(400)
  })

  it('returns 404 when source file not found', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.file.findUnique).mockResolvedValue(null)
    const res = await POST(makeReq({ sourceFileId: 'missing', targetSkriptId: 'skr-target' }))
    expect(res.status).toBe(404)
  })

  it('returns 403 when user is not author of source skript', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.file.findUnique).mockResolvedValue({
      ...sourceFileBase,
      skript: { id: 'skr-source', authors: [{ permission: 'viewer' as const }] },
    } as unknown as Awaited<ReturnType<typeof prisma.file.findUnique>>)

    const res = await POST(makeReq({ sourceFileId: 'src-1', targetSkriptId: 'skr-target' }))
    expect(res.status).toBe(403)
  })

  it('returns 403 when user is not author of target skript', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.file.findUnique).mockResolvedValue(
      sourceFileBase as unknown as Awaited<ReturnType<typeof prisma.file.findUnique>>
    )
    vi.mocked(prisma.skript.findFirst).mockResolvedValue(null)

    const res = await POST(makeReq({ sourceFileId: 'src-1', targetSkriptId: 'skr-target' }))
    expect(res.status).toBe(403)
  })

  it('refuses to import into the same skript', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.file.findUnique).mockResolvedValue(
      sourceFileBase as unknown as Awaited<ReturnType<typeof prisma.file.findUnique>>
    )
    vi.mocked(prisma.skript.findFirst).mockResolvedValue({ id: 'skr-source' } as Awaited<ReturnType<typeof prisma.skript.findFirst>>)

    const res = await POST(makeReq({ sourceFileId: 'src-1', targetSkriptId: 'skr-source' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/same/i)
  })

  it('returns 409 with existingFileId when name already taken in target', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.file.findUnique).mockResolvedValue(
      sourceFileBase as unknown as Awaited<ReturnType<typeof prisma.file.findUnique>>
    )
    vi.mocked(prisma.skript.findFirst).mockResolvedValue({ id: 'skr-target' } as Awaited<ReturnType<typeof prisma.skript.findFirst>>)
    vi.mocked(prisma.file.findFirst).mockResolvedValue({ id: 'existing-1' } as Awaited<ReturnType<typeof prisma.file.findFirst>>)

    const res = await POST(makeReq({ sourceFileId: 'src-1', targetSkriptId: 'skr-target' }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.existingFileId).toBe('existing-1')
  })

  it('creates a new File row with the source hash on the happy path', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.file.findUnique).mockResolvedValue(
      sourceFileBase as unknown as Awaited<ReturnType<typeof prisma.file.findUnique>>
    )
    vi.mocked(prisma.skript.findFirst).mockResolvedValue({ id: 'skr-target' } as Awaited<ReturnType<typeof prisma.skript.findFirst>>)
    vi.mocked(prisma.file.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.file.create).mockResolvedValue({
      id: 'new-1',
      name: 'netflix.db',
      hash: 'abc123',
      contentType: 'application/octet-stream',
      size: BigInt(4640768),
      skriptId: 'skr-target',
    } as unknown as Awaited<ReturnType<typeof prisma.file.create>>)

    const res = await POST(makeReq({ sourceFileId: 'src-1', targetSkriptId: 'skr-target' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.file).toMatchObject({
      id: 'new-1',
      hash: 'abc123',
      skriptId: 'skr-target',
      size: 4640768,
    })

    const createArgs = vi.mocked(prisma.file.create).mock.calls[0][0]
    expect(createArgs.data).toMatchObject({
      name: 'netflix.db',
      isDirectory: false,
      skriptId: 'skr-target',
      parentId: null,
      hash: 'abc123',
      createdBy: userId,
    })
  })

  it('rejects directory imports', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.file.findUnique).mockResolvedValue({
      ...sourceFileBase,
      isDirectory: true,
    } as unknown as Awaited<ReturnType<typeof prisma.file.findUnique>>)

    const res = await POST(makeReq({ sourceFileId: 'src-1', targetSkriptId: 'skr-target' }))
    expect(res.status).toBe(400)
  })

  it('rejects files without a hash (incomplete uploads)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    vi.mocked(prisma.file.findUnique).mockResolvedValue({
      ...sourceFileBase,
      hash: null,
    } as unknown as Awaited<ReturnType<typeof prisma.file.findUnique>>)

    const res = await POST(makeReq({ sourceFileId: 'src-1', targetSkriptId: 'skr-target' }))
    expect(res.status).toBe(400)
  })
})
