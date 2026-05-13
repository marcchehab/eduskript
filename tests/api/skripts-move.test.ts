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
    skript: {
      findUnique: vi.fn(),
    },
    collection: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    site: {
      findUnique: vi.fn(),
    },
    organizationMember: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { POST } from '@/app/api/skripts/move/route'

describe('Skripts Move API', () => {
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

  const mockSkript = {
    id: 'skript-123',
    title: 'Test Skript',
    slug: 'test-skript',
    authors: [
      {
        id: 'author-1',
        userId: 'user-123',
        skriptId: 'skript-123',
        permission: 'author' as const,
        user: { id: 'user-123', name: 'Test User', email: 'test@example.com' },
      },
    ],
    collectionSkripts: [
      {
        id: 'cs-1',
        collectionId: 'col-123',
        collection: {
          id: 'col-123',
          title: 'Source Collection',
          slug: 'source-collection',
          site: { userId: 'user-123', organizationId: null },
        },
      },
    ],
  }

  const mockTargetCollection = {
    id: 'col-456',
    title: 'Target Collection',
    slug: 'target-collection',
    site: { userId: 'user-123', organizationId: null },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createRequest = (body: object) =>
    new NextRequest('http://localhost/api/skripts/move', {
      method: 'POST',
      body: JSON.stringify(body),
    })

  describe('POST /api/skripts/move', () => {
    describe('Authentication', () => {
      it('should return 401 when not authenticated', async () => {
        vi.mocked(getServerSession).mockResolvedValue(null)

        const request = createRequest({ skriptId: 'skript-123' })
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

      it('should return 400 when skriptId is missing', async () => {
        const request = createRequest({})
        const response = await POST(request)

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toBe('skriptId is required')
      })
    })

    describe('Skript Lookup', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
      })

      it('should return 404 when skript not found', async () => {
        vi.mocked(prisma.skript.findUnique).mockResolvedValue(null)

        const request = createRequest({ skriptId: 'nonexistent' })
        const response = await POST(request)

        expect(response.status).toBe(404)
        const data = await response.json()
        expect(data.error).toBe('Skript not found')
      })
    })

    describe('Source Permission Check', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
      })

      it('should return 403 when user has no edit permission on skript or collection', async () => {
        const skriptWithNoPermission = {
          ...mockSkript,
          authors: [
            {
              ...mockSkript.authors[0],
              userId: 'other-user',
              permission: 'viewer' as const,
            },
          ],
          collectionSkripts: [
            {
              ...mockSkript.collectionSkripts[0],
              collection: {
                ...mockSkript.collectionSkripts[0].collection,
                site: { userId: 'other-user', organizationId: null },
              },
            },
          ],
        }
        vi.mocked(prisma.skript.findUnique).mockResolvedValue(skriptWithNoPermission)

        const request = createRequest({ skriptId: 'skript-123' })
        const response = await POST(request)

        expect(response.status).toBe(403)
        const data = await response.json()
        expect(data.error).toContain('edit permissions')
      })

      it('should allow move when user has skript author permission', async () => {
        vi.mocked(prisma.skript.findUnique).mockResolvedValue(mockSkript)
        vi.mocked(prisma.$transaction).mockResolvedValue(mockSkript)
        vi.mocked(prisma.site.findUnique).mockResolvedValue({ slug: 'testuser' } as never)

        const request = createRequest({ skriptId: 'skript-123' })
        const response = await POST(request)

        expect(response.status).toBe(200)
      })

      it('should allow move when user owns the collection site', async () => {
        // No direct SkriptAuthor; instead the user owns the site that the
        // collection belongs to, which under the new model authorises the
        // move and grants edit rights on the skript.
        const skriptWithCollectionPermission = {
          ...mockSkript,
          authors: [],
          collectionSkripts: [
            {
              ...mockSkript.collectionSkripts[0],
              collection: {
                ...mockSkript.collectionSkripts[0].collection,
                site: { userId: 'user-123', organizationId: null },
              },
            },
          ],
        }
        vi.mocked(prisma.skript.findUnique).mockResolvedValue(skriptWithCollectionPermission)
        vi.mocked(prisma.$transaction).mockResolvedValue(mockSkript)
        vi.mocked(prisma.site.findUnique).mockResolvedValue({ slug: 'testuser' } as never)

        const request = createRequest({ skriptId: 'skript-123' })
        const response = await POST(request)

        expect(response.status).toBe(200)
      })
    })

    describe('Target Collection Permission Check', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
        vi.mocked(prisma.skript.findUnique).mockResolvedValue(mockSkript)
      })

      it('should return 404 when target collection not found', async () => {
        vi.mocked(prisma.collection.findUnique).mockResolvedValue(null)

        const request = createRequest({
          skriptId: 'skript-123',
          targetCollectionId: 'nonexistent',
        })
        const response = await POST(request)

        expect(response.status).toBe(404)
        const data = await response.json()
        expect(data.error).toBe('Target collection not found')
      })

      it('should return 403 when user cannot edit target collection', async () => {
        vi.mocked(prisma.collection.findUnique).mockResolvedValue({
          ...mockTargetCollection,
          site: { userId: 'other-user', organizationId: null },
        } as never)

        const request = createRequest({
          skriptId: 'skript-123',
          targetCollectionId: 'col-456',
        })
        const response = await POST(request)

        expect(response.status).toBe(403)
        const data = await response.json()
        expect(data.error).toContain('target collection')
      })
    })

    describe('Successful Move', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
        vi.mocked(prisma.skript.findUnique).mockResolvedValue(mockSkript)
        vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockTargetCollection)
        vi.mocked(prisma.site.findUnique).mockResolvedValue({ slug: 'testuser' } as never)
      })

      it('should move skript to target collection', async () => {
        vi.mocked(prisma.$transaction).mockResolvedValue({
          ...mockSkript,
          collectionSkripts: [
            { collectionId: 'col-456', collection: mockTargetCollection },
          ],
        })

        const request = createRequest({
          skriptId: 'skript-123',
          targetCollectionId: 'col-456',
          order: 0,
        })
        const response = await POST(request)

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.success).toBe(true)
        expect(prisma.$transaction).toHaveBeenCalled()
      })

      it('should move skript to root level when no targetCollectionId', async () => {
        vi.mocked(prisma.$transaction).mockResolvedValue({
          ...mockSkript,
          collectionSkripts: [],
        })

        const request = createRequest({
          skriptId: 'skript-123',
        })
        const response = await POST(request)

        expect(response.status).toBe(200)
      })
    })

    describe('Error Handling', () => {
      it('should return 500 on database error', async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
        vi.mocked(prisma.skript.findUnique).mockRejectedValue(
          new Error('Database error')
        )

        const request = createRequest({ skriptId: 'skript-123' })
        const response = await POST(request)

        expect(response.status).toBe(500)
        const data = await response.json()
        expect(data.error).toBe('Internal server error')
      })
    })
  })
})
