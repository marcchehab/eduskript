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
      findFirst: vi.fn(),
    },
    page: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    pageVersion: {
      create: vi.fn(),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { POST } from '@/app/api/pages/route'

describe('Pages API', () => {
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
  }

  const mockPage = {
    id: 'page-123',
    title: 'Test Page',
    slug: 'test-page',
    content: '# Hello',
    order: 1,
    skriptId: 'skript-123',
    authors: [
      {
        id: 'author-1',
        userId: 'user-123',
        permission: 'author',
        user: { id: 'user-123', name: 'Test User' },
      },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createRequest = (body: object) =>
    new NextRequest('http://localhost/api/pages', {
      method: 'POST',
      body: JSON.stringify(body),
    })

  describe('POST /api/pages', () => {
    describe('Authentication', () => {
      it('should return 401 when not authenticated', async () => {
        vi.mocked(getServerSession).mockResolvedValue(null)

        const request = createRequest({
          title: 'Test',
          slug: 'test',
          skriptId: 'skript-123',
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
        const request = createRequest({ slug: 'test', skriptId: 'skript-123' })
        const response = await POST(request)

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toBe('Title, slug, and skript ID are required')
      })

      it('should return 400 when slug is missing', async () => {
        const request = createRequest({ title: 'Test', skriptId: 'skript-123' })
        const response = await POST(request)

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toBe('Title, slug, and skript ID are required')
      })

      it('should return 400 when skriptId is missing', async () => {
        const request = createRequest({ title: 'Test', slug: 'test' })
        const response = await POST(request)

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toBe('Title, slug, and skript ID are required')
      })
    })

    describe('Authorization', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
      })

      it('should return 404 when skript not found', async () => {
        vi.mocked(prisma.skript.findFirst).mockResolvedValue(null)

        const request = createRequest({
          title: 'Test',
          slug: 'test',
          skriptId: 'nonexistent',
        })
        const response = await POST(request)

        expect(response.status).toBe(404)
        const data = await response.json()
        expect(data.error).toBe('Skript not found or access denied')
      })

      it('should return 404 when user is not author of skript', async () => {
        // findFirst with author check returns null
        vi.mocked(prisma.skript.findFirst).mockResolvedValue(null)

        const request = createRequest({
          title: 'Test',
          slug: 'test',
          skriptId: 'skript-123',
        })
        const response = await POST(request)

        expect(response.status).toBe(404)
        expect(prisma.skript.findFirst).toHaveBeenCalledWith({
          where: {
            id: 'skript-123',
            authors: {
              some: {
                userId: 'user-123',
              },
            },
          },
        })
      })
    })

    describe('Slug Conflicts', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
        vi.mocked(prisma.skript.findFirst).mockResolvedValue(mockSkript)
      })

      it('should return 409 when slug already exists in skript', async () => {
        vi.mocked(prisma.page.findFirst).mockResolvedValue(mockPage)

        const request = createRequest({
          title: 'Another Page',
          slug: 'test-page',
          skriptId: 'skript-123',
        })
        const response = await POST(request)

        expect(response.status).toBe(409)
        const data = await response.json()
        expect(data.error).toContain('already exists')
      })
    })

    describe('Successful Creation', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
        vi.mocked(prisma.skript.findFirst).mockResolvedValue(mockSkript)
        vi.mocked(prisma.page.findFirst).mockResolvedValue(null)
      })

      it('should create page with correct data', async () => {
        vi.mocked(prisma.page.create).mockResolvedValue(mockPage)
        vi.mocked(prisma.pageVersion.create).mockResolvedValue({} as any)

        const request = createRequest({
          title: 'New Page',
          slug: 'new-page',
          content: '# Content',
          skriptId: 'skript-123',
        })
        const response = await POST(request)

        expect(response.status).toBe(200)
        expect(prisma.page.create).toHaveBeenCalledWith({
          data: {
            title: 'New Page',
            slug: 'new-page',
            // POST omits description; service normalises undefined to null
            // (see createPageForUser in src/lib/services/pages.ts).
            description: null,
            content: '# Content',
            order: 1,
            skriptId: 'skript-123',
            authors: {
              create: {
                userId: 'user-123',
                permission: 'author',
              },
            },
          },
          include: {
            authors: {
              include: {
                user: true,
              },
            },
          },
        })
      })

      it('should create initial page version', async () => {
        vi.mocked(prisma.page.create).mockResolvedValue(mockPage)
        vi.mocked(prisma.pageVersion.create).mockResolvedValue({} as any)

        const request = createRequest({
          title: 'New Page',
          slug: 'new-page',
          content: '# Content',
          skriptId: 'skript-123',
        })
        await POST(request)

        expect(prisma.pageVersion.create).toHaveBeenCalledWith({
          data: {
            content: '# Content',
            version: 1,
            authorId: 'user-123',
            pageId: 'page-123',
            editSource: null,
            editClient: null,
          },
        })
      })

      it('should handle empty content', async () => {
        vi.mocked(prisma.page.create).mockResolvedValue(mockPage)
        vi.mocked(prisma.pageVersion.create).mockResolvedValue({} as any)

        const request = createRequest({
          title: 'New Page',
          slug: 'new-page',
          skriptId: 'skript-123',
        })
        await POST(request)

        expect(prisma.page.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              content: '',
            }),
          })
        )
      })

      it('should calculate correct order for new pages', async () => {
        vi.mocked(prisma.page.findFirst)
          .mockResolvedValueOnce(null) // No slug conflict
        // Mock for order calculation
        vi.mocked(prisma.page.findFirst).mockResolvedValueOnce({
          ...mockPage,
          order: 5,
        } as any)
        vi.mocked(prisma.page.create).mockResolvedValue(mockPage)
        vi.mocked(prisma.pageVersion.create).mockResolvedValue({} as any)

        const request = createRequest({
          title: 'New Page',
          slug: 'new-page',
          skriptId: 'skript-123',
        })
        await POST(request)

        // The order should be lastPage.order + 1 = 6
        expect(prisma.page.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              order: 6,
            }),
          })
        )
      })
    })

    describe('Error Handling', () => {
      it('should return 500 on database error', async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession)
        vi.mocked(prisma.skript.findFirst).mockRejectedValue(
          new Error('Database error')
        )

        const request = createRequest({
          title: 'Test',
          slug: 'my-page',
          skriptId: 'skript-123',
        })
        const response = await POST(request)

        expect(response.status).toBe(500)
        const data = await response.json()
        expect(data.error).toBe('Internal server error')
      })
    })
  })
})
