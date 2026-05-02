import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'

// Mock dependencies before imports
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    class: {
      findUnique: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    classMembership: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    preAuthorizedStudent: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  bulkImportRateLimiter: {
    check: vi.fn(() => ({ allowed: true, remaining: 5 })),
  },
}))

vi.mock('@/lib/privacy/pseudonym', () => ({
  generatePseudonym: vi.fn((email: string) => `pseudo-${email.split('@')[0]}`),
}))

vi.mock('@/lib/events', () => ({
  eventBus: {
    publish: vi.fn(() => Promise.resolve()),
  },
}))

import { POST, DELETE } from '@/app/api/classes/[id]/bulk-import/route'
import { prisma } from '@/lib/prisma'
import { bulkImportRateLimiter } from '@/lib/rate-limit'

function createPostRequest(classId: string, body: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/classes/${classId}/bulk-import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function createDeleteRequest(classId: string, body: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/classes/${classId}/bulk-import`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const mockParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe('Bulk Import API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mocks
    vi.mocked(bulkImportRateLimiter.check).mockReturnValue({
      allowed: true,
      remaining: 5,
      resetAt: Date.now() + 3600000,
    })
  })

  describe('POST /api/classes/[id]/bulk-import', () => {
    describe('Authentication & Authorization', () => {
      it('should return 401 when not authenticated', async () => {
        vi.mocked(getServerSession).mockResolvedValue(null)

        const request = createPostRequest('class-1', { emails: ['test@example.com'] })
        const response = await POST(request, mockParams('class-1'))

        expect(response.status).toBe(401)
        const data = await response.json()
        expect(data.error).toBe('Unauthorized')
      })

      it('should return 404 when class not found', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'teacher-1', billingPlan: 'pro' },
        } as never)
        vi.mocked(prisma.class.findUnique).mockResolvedValue(null)

        const request = createPostRequest('nonexistent', { emails: ['test@example.com'] })
        const response = await POST(request, mockParams('nonexistent'))

        expect(response.status).toBe(404)
        const data = await response.json()
        expect(data.error).toBe('Class not found')
      })

      it('should return 403 when user is not the class owner', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'other-teacher', billingPlan: 'pro' },
        } as never)
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          teacherId: 'teacher-1',
          name: 'Test Class',
        } as never)

        const request = createPostRequest('class-1', { emails: ['test@example.com'] })
        const response = await POST(request, mockParams('class-1'))

        expect(response.status).toBe(403)
        const data = await response.json()
        expect(data.error).toContain('do not have permission')
      })
    })

    describe('Rate Limiting', () => {
      it('should return 429 when rate limit exceeded', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'teacher-1', billingPlan: 'pro' },
        } as never)
        vi.mocked(bulkImportRateLimiter.check).mockReturnValue({
          allowed: false,
          remaining: 0,
          retryAfter: 600,
          resetAt: Date.now() + 600000,
        })

        const request = createPostRequest('class-1', { emails: ['test@example.com'] })
        const response = await POST(request, mockParams('class-1'))

        expect(response.status).toBe(429)
        const data = await response.json()
        expect(data.error).toContain('Too many bulk imports')
      })
    })

    describe('Input Validation', () => {
      it('should return 400 when emails is not an array', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'teacher-1', billingPlan: 'pro' },
        } as never)
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          teacherId: 'teacher-1',
          name: 'Test Class',
        } as never)

        const request = createPostRequest('class-1', { emails: 'not-an-array' })
        const response = await POST(request, mockParams('class-1'))

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toBe('emails must be a non-empty array')
      })

      it('should return 400 when emails array is empty', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'teacher-1', billingPlan: 'pro' },
        } as never)
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          teacherId: 'teacher-1',
          name: 'Test Class',
        } as never)

        const request = createPostRequest('class-1', { emails: [] })
        const response = await POST(request, mockParams('class-1'))

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toBe('emails must be a non-empty array')
      })

      it('should return 400 when no valid emails provided', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'teacher-1', billingPlan: 'pro' },
        } as never)
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          teacherId: 'teacher-1',
          name: 'Test Class',
        } as never)

        const request = createPostRequest('class-1', { emails: ['invalid', 'also-invalid'] })
        const response = await POST(request, mockParams('class-1'))

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toBe('No valid emails provided')
      })
    })

    describe('Successful Import', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'teacher-1', billingPlan: 'pro' },
        } as never)
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          teacherId: 'teacher-1',
          name: 'Test Class',
        } as never)
      })

      it('should pre-authorize new student emails', async () => {
        vi.mocked(prisma.user.findMany).mockResolvedValue([])
        vi.mocked(prisma.classMembership.findMany).mockResolvedValue([])
        vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])
        vi.mocked(prisma.preAuthorizedStudent.createMany).mockResolvedValue({ count: 2 })

        const request = createPostRequest('class-1', {
          emails: ['student1@example.com', 'student2@example.com'],
        })
        const response = await POST(request, mockParams('class-1'))

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.imported).toBe(2)
        expect(prisma.preAuthorizedStudent.createMany).toHaveBeenCalled()
      })

      it('should directly add existing users to class', async () => {
        vi.mocked(prisma.user.findMany).mockResolvedValue([
          { id: 'user-1', email: 'existing@example.com', name: 'Existing User' },
        ] as never)
        vi.mocked(prisma.classMembership.findMany).mockResolvedValue([])
        vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])
        vi.mocked(prisma.classMembership.createMany).mockResolvedValue({ count: 1 })
        vi.mocked(prisma.preAuthorizedStudent.deleteMany).mockResolvedValue({ count: 0 })

        const request = createPostRequest('class-1', {
          emails: ['existing@example.com'],
        })
        const response = await POST(request, mockParams('class-1'))

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.directlyAdded).toBe(1)
        expect(prisma.classMembership.createMany).toHaveBeenCalled()
      })

      it('should skip already-member users', async () => {
        vi.mocked(prisma.user.findMany).mockResolvedValue([
          { id: 'user-1', email: 'member@example.com', name: 'Member' },
        ] as never)
        vi.mocked(prisma.classMembership.findMany)
          .mockResolvedValueOnce([{ studentId: 'user-1' }] as never) // existing members check
          .mockResolvedValueOnce([]) // pseudonym members check
        vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])

        const request = createPostRequest('class-1', {
          emails: ['member@example.com'],
        })
        const response = await POST(request, mockParams('class-1'))

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.directlyAdded).toBe(0)
        expect(data.alreadyMembers).toBeGreaterThanOrEqual(1)
      })

      it('should skip already pre-authorized emails', async () => {
        vi.mocked(prisma.user.findMany).mockResolvedValue([])
        vi.mocked(prisma.classMembership.findMany).mockResolvedValue([])
        vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([
          { pseudonym: 'pseudo-student1' },
        ] as never)

        const request = createPostRequest('class-1', {
          emails: ['student1@example.com'],
        })
        const response = await POST(request, mockParams('class-1'))

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.imported).toBe(0)
        expect(data.alreadyPreAuthorized).toBe(1)
      })

      it('should normalize emails to lowercase', async () => {
        vi.mocked(prisma.user.findMany).mockResolvedValue([])
        vi.mocked(prisma.classMembership.findMany).mockResolvedValue([])
        vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])
        vi.mocked(prisma.preAuthorizedStudent.createMany).mockResolvedValue({ count: 1 })

        const request = createPostRequest('class-1', {
          emails: ['STUDENT@EXAMPLE.COM'],
        })
        const response = await POST(request, mockParams('class-1'))

        expect(response.status).toBe(200)
        // Verify the email was normalized (the pseudonym check uses lowercase)
        expect(prisma.user.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              email: expect.objectContaining({
                in: ['student@example.com'],
              }),
            }),
          })
        )
      })

      it('should filter out invalid emails', async () => {
        vi.mocked(prisma.user.findMany).mockResolvedValue([])
        vi.mocked(prisma.classMembership.findMany).mockResolvedValue([])
        vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])
        vi.mocked(prisma.preAuthorizedStudent.createMany).mockResolvedValue({ count: 1 })

        const request = createPostRequest('class-1', {
          emails: ['valid@example.com', 'invalid-email', 'also@valid.org'],
        })
        const response = await POST(request, mockParams('class-1'))

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.total).toBe(2) // Only valid emails counted
      })
    })

    describe('Error Handling', () => {
      it('should return 500 on database error', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'teacher-1', billingPlan: 'pro' },
        } as never)
        vi.mocked(prisma.class.findUnique).mockRejectedValue(new Error('Database error'))

        const request = createPostRequest('class-1', { emails: ['test@example.com'] })
        const response = await POST(request, mockParams('class-1'))

        expect(response.status).toBe(500)
        const data = await response.json()
        expect(data.error).toBe('Failed to import students')
      })
    })
  })

  describe('DELETE /api/classes/[id]/bulk-import', () => {
    describe('Authentication & Authorization', () => {
      it('should return 401 when not authenticated', async () => {
        vi.mocked(getServerSession).mockResolvedValue(null)

        const request = createDeleteRequest('class-1', { email: 'test@example.com' })
        const response = await DELETE(request, mockParams('class-1'))

        expect(response.status).toBe(401)
      })

      it('should return 404 when class not found', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'teacher-1', billingPlan: 'pro' },
        } as never)
        vi.mocked(prisma.class.findUnique).mockResolvedValue(null)

        const request = createDeleteRequest('class-1', { email: 'test@example.com' })
        const response = await DELETE(request, mockParams('class-1'))

        expect(response.status).toBe(404)
      })

      it('should return 403 when not class owner', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'other-teacher', billingPlan: 'pro' },
        } as never)
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          teacherId: 'teacher-1',
        } as never)

        const request = createDeleteRequest('class-1', { email: 'test@example.com' })
        const response = await DELETE(request, mockParams('class-1'))

        expect(response.status).toBe(403)
      })
    })

    describe('Input Validation', () => {
      it('should return 400 when email is missing', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'teacher-1', billingPlan: 'pro' },
        } as never)
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          teacherId: 'teacher-1',
        } as never)

        const request = createDeleteRequest('class-1', {})
        const response = await DELETE(request, mockParams('class-1'))

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toBe('email is required')
      })
    })

    describe('Successful Deletion', () => {
      it('should delete pre-authorization and return success', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'teacher-1', billingPlan: 'pro' },
        } as never)
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          teacherId: 'teacher-1',
        } as never)
        vi.mocked(prisma.preAuthorizedStudent.deleteMany).mockResolvedValue({ count: 1 })

        const request = createDeleteRequest('class-1', { email: 'student@example.com' })
        const response = await DELETE(request, mockParams('class-1'))

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.success).toBe(true)
      })

      it('should return 404 when pre-authorization not found', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'teacher-1', billingPlan: 'pro' },
        } as never)
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          teacherId: 'teacher-1',
        } as never)
        vi.mocked(prisma.preAuthorizedStudent.deleteMany).mockResolvedValue({ count: 0 })

        const request = createDeleteRequest('class-1', { email: 'notfound@example.com' })
        const response = await DELETE(request, mockParams('class-1'))

        expect(response.status).toBe(404)
        const data = await response.json()
        expect(data.error).toBe('Pre-authorization not found')
      })
    })
  })
})
