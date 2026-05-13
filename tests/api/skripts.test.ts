import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Session } from 'next-auth'

// Mock dependencies
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    collection: {
      findUnique: vi.fn(),
    },
    skript: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    collectionSkript: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    organizationMember: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '@/app/api/skripts/route'

describe('Skripts API', () => {
  const mockSession: Session = {
    user: {
      id: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      username: 'testuser',
      title: 'Teacher',
      isAdmin: false,
      requirePasswordReset: false,
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }

  // Collection now owned by a Site (1:1 with the user). `site.userId === user-123`
  // is what grants edit rights for skript-creation here.
  const mockCollection = {
    id: 'col-123',
    title: 'Test Collection',
    site: { userId: 'user-123', organizationId: null },
  }

  const mockSkript = {
    id: 'skript-123',
    title: 'Test Skript',
    slug: 'test-skript',
    description: 'A test skript',
    authors: [
      {
        id: 'author-1',
        userId: 'user-123',
        permission: 'author',
        user: { id: 'user-123', name: 'Test User', email: 'test@example.com' },
      },
    ],
    collectionSkripts: [
      {
        collection: mockCollection,
      },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /api/skripts', () => {
    const createRequest = (body: object) =>
      new NextRequest('http://localhost/api/skripts', {
        method: 'POST',
        body: JSON.stringify(body),
      })

    describe('Authentication', () => {
      it('should return 401 when not authenticated', async () => {
        vi.mocked(getServerSession).mockResolvedValue(null)

        const request = createRequest({
          title: 'Test',
          slug: 'test-skript',
          collectionId: 'col-123',
        })
        const response = await POST(request)

        expect(response.status).toBe(401)
        const data = await response.json()
        expect(data.error).toBe('Unauthorized')
      })
    })

    describe('Validation', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
      })

      it('should return 400 when title is missing', async () => {
        const request = createRequest({
          slug: 'test-skript',
          collectionId: 'col-123',
        })
        const response = await POST(request)

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toBe('Title, slug, and collection ID are required')
      })

      it('should return 400 when slug is missing', async () => {
        const request = createRequest({
          title: 'Test',
          collectionId: 'col-123',
        })
        const response = await POST(request)

        expect(response.status).toBe(400)
      })

      it('should return 400 when collectionId is missing', async () => {
        const request = createRequest({
          title: 'Test',
          slug: 'test-skript',
        })
        const response = await POST(request)

        expect(response.status).toBe(400)
      })

      it('should return 400 for reserved slugs', async () => {
        vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollection)

        const request = createRequest({
          title: 'Dashboard',
          slug: 'dashboard',
          collectionId: 'col-123',
        })
        const response = await POST(request)

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toContain('reserved')
      })
    })

    describe('Authorization', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
      })

      it('should return 404 when collection not found', async () => {
        vi.mocked(prisma.collection.findUnique).mockResolvedValue(null)

        const request = createRequest({
          title: 'Test',
          slug: 'new-skript',
          collectionId: 'nonexistent',
        })
        const response = await POST(request)

        expect(response.status).toBe(404)
        const data = await response.json()
        expect(data.error).toBe('Collection not found')
      })

      it('should return 403 when user cannot edit collection', async () => {
        vi.mocked(prisma.collection.findUnique).mockResolvedValue({
          ...mockCollection,
          site: { userId: 'other-user', organizationId: null },
        } as never)

        const request = createRequest({
          title: 'Test',
          slug: 'new-skript',
          collectionId: 'col-123',
        })
        const response = await POST(request)

        expect(response.status).toBe(403)
        const data = await response.json()
        expect(data.error).toContain('permission')
      })

      it('should return 403 when collection is owned by an org the user is not in', async () => {
        vi.mocked(prisma.collection.findUnique).mockResolvedValue({
          ...mockCollection,
          site: { userId: null, organizationId: 'org-1' },
        } as never)
        vi.mocked(prisma.organizationMember.findMany).mockResolvedValue([] as never)

        const request = createRequest({
          title: 'Test',
          slug: 'new-skript',
          collectionId: 'col-123',
        })
        const response = await POST(request)

        expect(response.status).toBe(403)
      })
    })

    describe('Slug Conflicts', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
        vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollection as never)
      })

      it('should return 409 when slug already exists', async () => {
        vi.mocked(prisma.skript.findFirst).mockResolvedValue(mockSkript)

        const request = createRequest({
          title: 'Test',
          slug: 'test-skript',
          collectionId: 'col-123',
        })
        const response = await POST(request)

        expect(response.status).toBe(409)
        const data = await response.json()
        expect(data.error).toContain('already have a skript')
      })
    })

    describe('Successful Creation', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
        vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollection as never)
        vi.mocked(prisma.skript.findFirst).mockResolvedValue(null)
        vi.mocked(prisma.collectionSkript.findFirst).mockResolvedValue(null)
      })

      it('should create skript via transaction', async () => {
        vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
          return fn({
            skript: {
              create: vi.fn().mockResolvedValue({ id: 'new-skript' }),
            },
            collectionSkript: {
              create: vi.fn().mockResolvedValue({}),
            },
          } as any)
        })
        vi.mocked(prisma.skript.findUnique).mockResolvedValue(mockSkript)

        const request = createRequest({
          title: 'New Skript',
          slug: 'new-skript',
          description: 'A new skript',
          collectionId: 'col-123',
        })
        const response = await POST(request)

        expect(response.status).toBe(200)
        expect(prisma.$transaction).toHaveBeenCalled()
      })
    })

    describe('Error Handling', () => {
      it('should return 500 on database error', async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
        vi.mocked(prisma.collection.findUnique).mockRejectedValue(
          new Error('Database error')
        )

        const request = createRequest({
          title: 'Test',
          slug: 'new-skript',
          collectionId: 'col-123',
        })
        const response = await POST(request)

        expect(response.status).toBe(500)
        const data = await response.json()
        expect(data.error).toBe('Internal server error')
      })
    })
  })

  describe('GET /api/skripts', () => {
    const createRequest = (params?: Record<string, string>) => {
      const url = new URL('http://localhost/api/skripts')
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          url.searchParams.set(key, value)
        })
      }
      return new NextRequest(url)
    }

    describe('Authentication', () => {
      it('should return 401 when not authenticated', async () => {
        vi.mocked(getServerSession).mockResolvedValue(null)

        const request = createRequest()
        const response = await GET(request)

        expect(response.status).toBe(401)
      })
    })

    describe('Fetching Skripts', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
      })

      it('should fetch skripts for authenticated user', async () => {
        vi.mocked(prisma.skript.findMany).mockResolvedValue([mockSkript])

        const request = createRequest()
        const response = await GET(request)

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.success).toBe(true)
        expect(data.data).toHaveLength(1)
      })

      it('should include shared skripts when requested', async () => {
        vi.mocked(prisma.skript.findMany).mockResolvedValue([mockSkript])

        const request = createRequest({ includeShared: 'true' })
        await GET(request)

        expect(prisma.skript.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  authors: { some: { userId: 'user-123' } },
                }),
              ]),
            }),
          })
        )
      })

      it('should return empty array when user has no skripts', async () => {
        vi.mocked(prisma.skript.findMany).mockResolvedValue([])

        const request = createRequest()
        const response = await GET(request)

        const data = await response.json()
        expect(data.data).toEqual([])
      })

      it('should order skripts by updatedAt descending', async () => {
        vi.mocked(prisma.skript.findMany).mockResolvedValue([])

        const request = createRequest()
        await GET(request)

        expect(prisma.skript.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: { updatedAt: 'desc' },
          })
        )
      })
    })

    describe('Error Handling', () => {
      it('should return 500 on database error', async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
        vi.mocked(prisma.skript.findMany).mockRejectedValue(
          new Error('Database error')
        )

        const request = createRequest()
        const response = await GET(request)

        expect(response.status).toBe(500)
        const data = await response.json()
        expect(data.error).toBe('Failed to fetch skripts')
      })
    })
  })
})
