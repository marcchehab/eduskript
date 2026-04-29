/**
 * Regression test gating the pages-service extraction.
 *
 * Asserts the exact next/cache + PageVersion side effects of the current REST handlers
 * BEFORE we move them into src/lib/services/pages.ts. After the refactor, this test
 * must remain green — it's the contract the service is expected to preserve.
 *
 * Side effects under test (PATCH content update):
 *   - 4 static revalidateTag: pageBySlug, skriptBySlug, collectionBySlug, teacherContent
 *   - 1 per-org loop: revalidateTag(orgContent) for each OrganizationMember row
 *   - 2 revalidatePath: public page route + /dashboard
 *   - 1 PageVersion.create on content change (none on metadata-only)
 *
 * Side effects under test (POST):
 *   - 1 PageVersion.create
 *   - 1 revalidatePath('/dashboard')
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Session } from 'next-auth'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    skript: {
      findFirst: vi.fn(),
    },
    page: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    pageVersion: {
      create: vi.fn(),
    },
    organizationMember: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

import { getServerSession } from 'next-auth'
import { revalidatePath, revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { POST } from '@/app/api/pages/route'
import { PATCH } from '@/app/api/pages/[id]/route'

const session: Session = {
  user: {
    id: 'user-123',
    email: 'teacher@example.com',
    name: 'Teacher',
    username: 'teacher',
    title: 'Teacher',
    isAdmin: false,
    requirePasswordReset: false,
  },
  expires: new Date(Date.now() + 86_400_000).toISOString(),
}

const existingPage = {
  id: 'page-123',
  title: 'Old Title',
  slug: 'old-slug',
  content: '# Old content',
  skriptId: 'skript-123',
  isPublished: true,
  skript: {
    id: 'skript-123',
    slug: 'algebra-1',
    collectionSkripts: [{ collection: { slug: 'math' } }],
  },
  versions: [{ version: 3, content: '# Old content' }],
}

const buildPatchRequest = (body: object) =>
  new NextRequest('http://localhost/api/pages/page-123', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

const buildPostRequest = (body: object) =>
  new NextRequest('http://localhost/api/pages', {
    method: 'POST',
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getServerSession).mockResolvedValue(session)
})

describe('PATCH /api/pages/[id] — cache invalidation contract', () => {
  beforeEach(() => {
    vi.mocked(prisma.page.findFirst).mockResolvedValue(existingPage as never)
    vi.mocked(prisma.page.update).mockResolvedValue({
      ...existingPage,
      content: '# New content',
    } as never)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      pageSlug: 'teacher',
    } as never)
    vi.mocked(prisma.organizationMember.findMany).mockResolvedValue([])
  })

  it('fires the 4 static revalidateTag calls + 2 revalidatePath on content change', async () => {
    const response = await PATCH(buildPatchRequest({ content: '# New content' }), {
      params: Promise.resolve({ id: 'page-123' }),
    })
    expect(response.status).toBe(200)

    const tagCalls = vi.mocked(revalidateTag).mock.calls.map((c) => c[0])
    expect(tagCalls).toContain('page:teacher:algebra-1:old-slug')
    expect(tagCalls).toContain('skript:teacher:algebra-1')
    expect(tagCalls).toContain('collection:teacher:math')
    expect(tagCalls).toContain('teacher-content:teacher')
    expect(tagCalls).toHaveLength(4)

    const pathCalls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0])
    expect(pathCalls).toEqual(['/teacher/algebra-1/old-slug', '/dashboard'])
  })

  it('also fires orgContent revalidateTag once per org membership', async () => {
    vi.mocked(prisma.organizationMember.findMany).mockResolvedValue([
      { organization: { slug: 'school-a' } },
      { organization: { slug: 'school-b' } },
    ] as never)

    await PATCH(buildPatchRequest({ content: '# New content' }), {
      params: Promise.resolve({ id: 'page-123' }),
    })

    const tagCalls = vi.mocked(revalidateTag).mock.calls.map((c) => c[0])
    expect(tagCalls).toContain('org-content:school-a')
    expect(tagCalls).toContain('org-content:school-b')
    expect(tagCalls).toHaveLength(6) // 4 static + 2 per-org
  })

  it('creates a PageVersion when content changes', async () => {
    await PATCH(buildPatchRequest({ content: '# New content' }), {
      params: Promise.resolve({ id: 'page-123' }),
    })

    expect(vi.mocked(prisma.pageVersion.create)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.pageVersion.create).mock.calls[0][0]).toMatchObject({
      data: {
        pageId: 'page-123',
        content: '# New content',
        version: 4,
        authorId: 'user-123',
        editSource: null,
        editClient: null,
      },
    })
  })

  it('records editSource="ai-edit" when the dashboard AI Edit Apply tags it', async () => {
    await PATCH(buildPatchRequest({ content: '# New content', editSource: 'ai-edit' }), {
      params: Promise.resolve({ id: 'page-123' }),
    })

    expect(vi.mocked(prisma.pageVersion.create).mock.calls[0][0]).toMatchObject({
      data: { editSource: 'ai-edit', editClient: null },
    })
  })

  it('rejects editSource="mcp" from a REST body (cannot fake MCP attribution)', async () => {
    await PATCH(buildPatchRequest({ content: '# New content', editSource: 'mcp' }), {
      params: Promise.resolve({ id: 'page-123' }),
    })

    // Server normalises any non-"ai-edit" value to undefined → null in the row.
    expect(vi.mocked(prisma.pageVersion.create).mock.calls[0][0]).toMatchObject({
      data: { editSource: null, editClient: null },
    })
  })

  it('does NOT create a PageVersion on metadata-only updates', async () => {
    await PATCH(buildPatchRequest({ title: 'Renamed' }), {
      params: Promise.resolve({ id: 'page-123' }),
    })

    expect(vi.mocked(prisma.pageVersion.create)).not.toHaveBeenCalled()
  })

  it('returns 401 without auth and fires no cache calls', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const response = await PATCH(buildPatchRequest({ content: 'x' }), {
      params: Promise.resolve({ id: 'page-123' }),
    })
    expect(response.status).toBe(401)
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled()
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled()
  })
})

describe('POST /api/pages — cache invalidation contract', () => {
  beforeEach(() => {
    vi.mocked(prisma.skript.findFirst).mockResolvedValue({
      id: 'skript-123',
      slug: 'algebra-1',
    } as never)
    vi.mocked(prisma.page.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.page.create).mockResolvedValue({
      id: 'page-new',
      title: 'New page',
      slug: 'new-page',
      content: '# Hello',
      order: 1,
      skriptId: 'skript-123',
      authors: [],
    } as never)
  })

  it('creates a PageVersion and revalidates /dashboard', async () => {
    const response = await POST(
      buildPostRequest({
        title: 'New page',
        slug: 'new-page',
        skriptId: 'skript-123',
        content: '# Hello',
      })
    )
    expect(response.status).toBe(200)

    expect(vi.mocked(prisma.pageVersion.create)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.pageVersion.create).mock.calls[0][0]).toMatchObject({
      data: {
        version: 1,
        content: '# Hello',
        authorId: 'user-123',
        pageId: 'page-new',
      },
    })

    const pathCalls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0])
    expect(pathCalls).toEqual(['/dashboard'])
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled()
  })
})
