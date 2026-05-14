import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Session } from 'next-auth'

// Mock next-auth
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    collection: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    site: {
      findUnique: vi.fn(),
    },
    organizationMember: {
      findMany: vi.fn(),
    },
  },
}))

// Import after mocks are set up
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '@/app/api/collections/route'

describe('Collections API', () => {
  const mockSession: Session = {
    user: {
      id: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      title: 'Teacher',
      isAdmin: false,
      requirePasswordReset: false,
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }

  const mockCollection = {
    id: 'col-123',
    title: 'Test Collection',
    description: 'A test collection',
    createdAt: new Date(),
    updatedAt: new Date(),
    authors: [
      {
        id: 'author-1',
        userId: 'user-123',
        collectionId: 'col-123',
        permission: 'author',
        user: {
          id: 'user-123',
          name: 'Test User',
          email: 'test@example.com',
        },
      },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /api/collections', () => {
    const createRequest = (body: object) =>
      new NextRequest('http://localhost/api/collections', {
        method: 'POST',
        body: JSON.stringify(body),
      })

    describe('Authentication', () => {
      it('should return 401 when not authenticated', async () => {
        vi.mocked(getServerSession).mockResolvedValue(null)

        const request = createRequest({ title: 'Test' })
        const response = await POST(request)

        expect(response.status).toBe(401)
        const data = await response.json()
        expect(data.error).toBe('Unauthorized')
      })

      it('should return 401 when session has no user id', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          ...mockSession,
          user: { ...mockSession.user, id: undefined as any },
        })

        const request = createRequest({ title: 'Test' })
        const response = await POST(request)

        expect(response.status).toBe(401)
      })
    })

    describe('Validation', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
      })

      it('should return 400 when title is missing', async () => {
        const request = createRequest({})
        const response = await POST(request)

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toBe('Title is required')
      })

      it('should return 400 when title is an empty string', async () => {
        const request = createRequest({ title: '   ' })
        const response = await POST(request)

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toBe('Title is required')
      })
    })

    describe('Successful Creation', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
        // Site lookup now precedes Collection.create — every successful path
        // requires the user to have a Site (a public page).
        vi.mocked(prisma.site.findUnique).mockResolvedValue({ id: 'site-123' } as never)
      })

      it('should create collection scoped to the user site', async () => {
        vi.mocked(prisma.collection.create).mockResolvedValue(mockCollection)

        // description is dropped — collections no longer have one. The
        // request body field is silently ignored.
        const request = createRequest({
          title: 'New Collection',
          description: 'ignored',
        })
        const response = await POST(request)

        expect(response.status).toBe(200)
        expect(prisma.collection.create).toHaveBeenCalledWith({
          data: {
            title: 'New Collection',
            siteId: 'site-123',
          },
        })
      })

      it('should return created collection data', async () => {
        vi.mocked(prisma.collection.create).mockResolvedValue(mockCollection)

        const request = createRequest({
          title: 'New Collection',
        })
        const response = await POST(request)

        const data = await response.json()
        expect(data.success).toBe(true)
        expect(data.data.id).toBe('col-123')
        expect(data.data.title).toBe('Test Collection')
      })

      it('should 400 when user has no Site', async () => {
        vi.mocked(prisma.site.findUnique).mockResolvedValue(null as never)

        const request = createRequest({ title: 'My Collection' })
        const response = await POST(request)

        expect(response.status).toBe(400)
      })
    })

    describe('Error Handling', () => {
      it('should return 500 on database error', async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
        vi.mocked(prisma.site.findUnique).mockResolvedValue({ id: 'site-123' } as never)
        vi.mocked(prisma.collection.create).mockRejectedValue(
          new Error('Database error')
        )

        const request = createRequest({
          title: 'My Collection',
        })
        const response = await POST(request)

        expect(response.status).toBe(500)
        const data = await response.json()
        expect(data.error).toBe('Failed to create collection')
      })
    })
  })

  describe('GET /api/collections', () => {
    const createRequest = (params?: Record<string, string>) => {
      const url = new URL('http://localhost/api/collections')
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
        const data = await response.json()
        expect(data.error).toBe('Unauthorized')
      })
    })

    describe('Fetching Collections', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
        vi.mocked(prisma.organizationMember.findMany).mockResolvedValue([] as never)
      })

      it('should fetch collections owned by the user site', async () => {
        vi.mocked(prisma.collection.findMany).mockResolvedValue([mockCollection])

        const request = createRequest()
        const response = await GET(request)

        expect(response.status).toBe(200)
        const call = vi.mocked(prisma.collection.findMany).mock.calls[0][0]!
        expect(call.where).toEqual({
          OR: [{ site: { userId: 'user-123' } }],
        })
      })

      it('should return collections with nested data', async () => {
        const collectionWithSkripts = {
          ...mockCollection,
          collectionSkripts: [
            {
              id: 'cs-1',
              skript: {
                id: 'skript-1',
                title: 'Test Skript',
                pages: [],
                authors: [],
              },
            },
          ],
        }
        vi.mocked(prisma.collection.findMany).mockResolvedValue([
          collectionWithSkripts,
        ])

        const request = createRequest()
        const response = await GET(request)

        const data = await response.json()
        expect(data.success).toBe(true)
        expect(data.data).toHaveLength(1)
        expect(data.data[0].collectionSkripts).toHaveLength(1)
      })

      it('should return empty array when user has no collections', async () => {
        vi.mocked(prisma.collection.findMany).mockResolvedValue([])

        const request = createRequest()
        const response = await GET(request)

        const data = await response.json()
        expect(data.success).toBe(true)
        expect(data.data).toEqual([])
      })

      it('should also fetch collections owned by org sites the user is a member of', async () => {
        vi.mocked(prisma.organizationMember.findMany).mockResolvedValue([
          { organizationId: 'org-1' },
        ] as never)
        vi.mocked(prisma.collection.findMany).mockResolvedValue([mockCollection])

        const request = createRequest()
        await GET(request)

        const call = vi.mocked(prisma.collection.findMany).mock.calls[0][0]!
        expect(call.where).toEqual({
          OR: [
            { site: { userId: 'user-123' } },
            { site: { organizationId: { in: ['org-1'] } } },
          ],
        })
      })

      it('should order collections by updatedAt descending', async () => {
        vi.mocked(prisma.collection.findMany).mockResolvedValue([])

        const request = createRequest()
        await GET(request)

        expect(prisma.collection.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: { updatedAt: 'desc' },
          })
        )
      })
    })

    describe('Error Handling', () => {
      it('should return 500 on database error', async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
        vi.mocked(prisma.organizationMember.findMany).mockResolvedValue([] as never)
        vi.mocked(prisma.collection.findMany).mockRejectedValue(
          new Error('Database error')
        )

        const request = createRequest()
        const response = await GET(request)

        expect(response.status).toBe(500)
        const data = await response.json()
        expect(data.error).toBe('Failed to fetch collections')
      })
    })
  })
})
