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
    user: {
      findUnique: vi.fn(),
    },
    class: {
      findUnique: vi.fn(),
    },
    classMembership: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    preAuthorizedStudent: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  inviteCodeRateLimiter: {
    check: vi.fn(() => ({ allowed: true, remaining: 5 })),
  },
  getClientIdentifier: vi.fn(() => 'test-client'),
}))

import { GET, POST } from '@/app/api/classes/join/[inviteCode]/route'
import { prisma } from '@/lib/prisma'
import { inviteCodeRateLimiter } from '@/lib/rate-limit'

function createPostRequest(inviteCode: string, body: object = {}): NextRequest {
  return new NextRequest(`http://localhost:3000/api/classes/join/${inviteCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function createGetRequest(inviteCode: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/classes/join/${inviteCode}`, {
    method: 'GET',
  })
}

const mockParams = (inviteCode: string) => ({ params: Promise.resolve({ inviteCode }) })

describe('Class Join API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(inviteCodeRateLimiter.check).mockReturnValue({
      allowed: true,
      remaining: 5,
      resetAt: Date.now() + 3600000,
    })
  })

  describe('POST /api/classes/join/[inviteCode]', () => {
    describe('Rate Limiting', () => {
      it('should return 429 when rate limit exceeded', async () => {
        vi.mocked(inviteCodeRateLimiter.check).mockReturnValue({
          allowed: false,
          remaining: 0,
          retryAfter: 60,
          resetAt: Date.now() + 60000,
        })

        const request = createPostRequest('ABC123')
        const response = await POST(request, mockParams('ABC123'))

        expect(response.status).toBe(429)
        const data = await response.json()
        expect(data.error).toContain('Too many attempts')
      })
    })

    describe('Authentication', () => {
      it('should return 401 when not authenticated', async () => {
        vi.mocked(getServerSession).mockResolvedValue(null)

        const request = createPostRequest('ABC123')
        const response = await POST(request, mockParams('ABC123'))

        expect(response.status).toBe(401)
        const data = await response.json()
        expect(data.error).toBe('Unauthorized')
      })

      it('should return 404 when user not found', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'user-1' },
        } as never)
        vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

        const request = createPostRequest('ABC123')
        const response = await POST(request, mockParams('ABC123'))

        expect(response.status).toBe(404)
        const data = await response.json()
        expect(data.error).toBe('User not found')
      })

      it('should return 403 when user is not a student', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'teacher-1' },
        } as never)
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
          accountType: 'teacher',
          studentPseudonym: null,
        } as never)

        const request = createPostRequest('ABC123')
        const response = await POST(request, mockParams('ABC123'))

        expect(response.status).toBe(403)
        const data = await response.json()
        expect(data.error).toBe('Only students can join classes')
      })
    })

    describe('Class Validation', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'student-1' },
        } as never)
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
          accountType: 'student',
          studentPseudonym: 'pseudo-student1',
        } as never)
      })

      it('should return 404 when invite code is invalid', async () => {
        vi.mocked(prisma.class.findUnique).mockResolvedValue(null)

        const request = createPostRequest('INVALID')
        const response = await POST(request, mockParams('INVALID'))

        expect(response.status).toBe(404)
        const data = await response.json()
        expect(data.error).toBe('Invalid invite code')
      })

      it('should return 403 when class is inactive', async () => {
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          isActive: false,
          teacher: { name: 'Teacher', pageSlug: 'teacher' },
        } as never)

        const request = createPostRequest('ABC123')
        const response = await POST(request, mockParams('ABC123'))

        expect(response.status).toBe(403)
        const data = await response.json()
        expect(data.error).toBe('This class is no longer active')
      })
    })

    describe('Already Member Handling', () => {
      it('should return success with alreadyMember flag when already joined', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'student-1' },
        } as never)
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
          accountType: 'student',
          studentPseudonym: null,
        } as never)
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          name: 'Test Class',
          description: 'A test class',
          isActive: true,
          allowAnonymous: true,
          teacher: { name: 'Teacher', pageSlug: 'teacher' },
        } as never)
        vi.mocked(prisma.classMembership.findUnique).mockResolvedValue({
          id: 'membership-1',
        } as never)

        const request = createPostRequest('ABC123')
        const response = await POST(request, mockParams('ABC123'))

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.alreadyMember).toBe(true)
        expect(data.message).toBe('Already a member of this class')
      })
    })

    describe('Non-Anonymous Class (allowAnonymous=false)', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'student-1' },
        } as never)
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          name: 'Test Class',
          description: 'A test class',
          isActive: true,
          allowAnonymous: false,
          teacher: { name: 'Teacher', pageSlug: 'teacher' },
        } as never)
        vi.mocked(prisma.classMembership.findUnique).mockResolvedValue(null)
      })

      it('should return 403 when student is not pre-authorized', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
          accountType: 'student',
          studentPseudonym: 'pseudo-student1',
        } as never)
        vi.mocked(prisma.preAuthorizedStudent.findUnique).mockResolvedValue(null)

        const request = createPostRequest('ABC123', { identityConsent: true })
        const response = await POST(request, mockParams('ABC123'))

        expect(response.status).toBe(403)
        const data = await response.json()
        expect(data.requiresPreAuthorization).toBe(true)
        expect(data.error).toContain('requires teacher approval')
      })

      it('should return 400 when pre-authorized but no consent given', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
          accountType: 'student',
          studentPseudonym: 'pseudo-student1',
        } as never)
        vi.mocked(prisma.preAuthorizedStudent.findUnique).mockResolvedValue({
          classId: 'class-1',
          pseudonym: 'pseudo-student1',
        } as never)

        const request = createPostRequest('ABC123', { identityConsent: false })
        const response = await POST(request, mockParams('ABC123'))

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.requiresConsent).toBe(true)
      })

      it('should allow join when pre-authorized with consent', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
          accountType: 'student',
          studentPseudonym: 'pseudo-student1',
        } as never)
        vi.mocked(prisma.preAuthorizedStudent.findUnique).mockResolvedValue({
          classId: 'class-1',
          pseudonym: 'pseudo-student1',
        } as never)
        vi.mocked(prisma.classMembership.create).mockResolvedValue({} as never)
        vi.mocked(prisma.preAuthorizedStudent.deleteMany).mockResolvedValue({ count: 1 })

        const request = createPostRequest('ABC123', { identityConsent: true })
        const response = await POST(request, mockParams('ABC123'))

        expect(response.status).toBe(201)
        const data = await response.json()
        expect(data.message).toBe('Successfully joined class')
        expect(data.identityRevealed).toBe(true)
        // Should delete pre-authorization after join
        expect(prisma.preAuthorizedStudent.deleteMany).toHaveBeenCalled()
      })
    })

    describe('Anonymous Class (allowAnonymous=true)', () => {
      beforeEach(() => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'student-1' },
        } as never)
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          name: 'Test Class',
          description: 'A test class',
          isActive: true,
          allowAnonymous: true,
          teacher: { name: 'Teacher', pageSlug: 'teacher' },
        } as never)
        vi.mocked(prisma.classMembership.findUnique).mockResolvedValue(null)
      })

      it('should allow any student to join without consent', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
          accountType: 'student',
          studentPseudonym: null,
        } as never)
        vi.mocked(prisma.classMembership.create).mockResolvedValue({} as never)

        const request = createPostRequest('ABC123', { identityConsent: false })
        const response = await POST(request, mockParams('ABC123'))

        expect(response.status).toBe(201)
        const data = await response.json()
        expect(data.message).toBe('Successfully joined class')
        expect(data.identityRevealed).toBe(false)
      })

      it('should reveal identity when consent given', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
          accountType: 'student',
          studentPseudonym: null,
        } as never)
        vi.mocked(prisma.classMembership.create).mockResolvedValue({} as never)

        const request = createPostRequest('ABC123', { identityConsent: true })
        const response = await POST(request, mockParams('ABC123'))

        expect(response.status).toBe(201)
        const data = await response.json()
        expect(data.identityRevealed).toBe(true)
      })

      it('should require consent when pre-authorized even in anonymous class', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
          accountType: 'student',
          studentPseudonym: 'pseudo-student1',
        } as never)
        vi.mocked(prisma.preAuthorizedStudent.findUnique).mockResolvedValue({
          classId: 'class-1',
          pseudonym: 'pseudo-student1',
        } as never)

        const request = createPostRequest('ABC123', { identityConsent: false })
        const response = await POST(request, mockParams('ABC123'))

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.requiresConsent).toBe(true)
      })
    })

    describe('Error Handling', () => {
      it('should return 500 on database error', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'student-1' },
        } as never)
        vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('Database error'))

        const request = createPostRequest('ABC123')
        const response = await POST(request, mockParams('ABC123'))

        expect(response.status).toBe(500)
        const data = await response.json()
        expect(data.error).toBe('Failed to join class')
      })
    })
  })

  describe('GET /api/classes/join/[inviteCode]', () => {
    describe('Rate Limiting', () => {
      it('should return 429 when rate limit exceeded', async () => {
        vi.mocked(inviteCodeRateLimiter.check).mockReturnValue({
          allowed: false,
          remaining: 0,
          retryAfter: 60,
          resetAt: Date.now() + 60000,
        })

        const request = createGetRequest('ABC123')
        const response = await GET(request, mockParams('ABC123'))

        expect(response.status).toBe(429)
      })
    })

    describe('Class Preview', () => {
      it('should return 404 for invalid invite code', async () => {
        vi.mocked(prisma.class.findUnique).mockResolvedValue(null)

        const request = createGetRequest('INVALID')
        const response = await GET(request, mockParams('INVALID'))

        expect(response.status).toBe(404)
        const data = await response.json()
        expect(data.error).toBe('Invalid invite code')
      })

      it('should return 403 for inactive class', async () => {
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          isActive: false,
          teacher: { name: 'Teacher', pageSlug: 'teacher' },
          _count: { memberships: 10 },
        } as never)

        const request = createGetRequest('ABC123')
        const response = await GET(request, mockParams('ABC123'))

        expect(response.status).toBe(403)
        const data = await response.json()
        expect(data.error).toBe('This class is no longer active')
      })

      it('should return class info for unauthenticated user', async () => {
        vi.mocked(getServerSession).mockResolvedValue(null)
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          name: 'Test Class',
          description: 'A test class',
          isActive: true,
          allowAnonymous: true,
          teacher: { name: 'Teacher', pageSlug: 'teacher' },
          _count: { memberships: 10 },
        } as never)

        const request = createGetRequest('ABC123')
        const response = await GET(request, mockParams('ABC123'))

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.class.name).toBe('Test Class')
        expect(data.class.memberCount).toBe(10)
        expect(data.isPreAuthorized).toBe(false)
        expect(data.isAlreadyMember).toBe(false)
      })

      it('should indicate if authenticated user is pre-authorized', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'student-1' },
        } as never)
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          name: 'Test Class',
          description: 'A test class',
          isActive: true,
          allowAnonymous: false,
          teacher: { name: 'Teacher', pageSlug: 'teacher' },
          _count: { memberships: 10 },
        } as never)
        vi.mocked(prisma.classMembership.findUnique).mockResolvedValue(null)
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
          studentPseudonym: 'pseudo-student1',
        } as never)
        vi.mocked(prisma.preAuthorizedStudent.findUnique).mockResolvedValue({
          classId: 'class-1',
          pseudonym: 'pseudo-student1',
        } as never)

        const request = createGetRequest('ABC123')
        const response = await GET(request, mockParams('ABC123'))

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.isPreAuthorized).toBe(true)
        expect(data.isAlreadyMember).toBe(false)
      })

      it('should indicate if authenticated user is already a member', async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: 'student-1' },
        } as never)
        vi.mocked(prisma.class.findUnique).mockResolvedValue({
          id: 'class-1',
          name: 'Test Class',
          description: 'A test class',
          isActive: true,
          allowAnonymous: true,
          teacher: { name: 'Teacher', pageSlug: 'teacher' },
          _count: { memberships: 10 },
        } as never)
        vi.mocked(prisma.classMembership.findUnique).mockResolvedValue({
          id: 'membership-1',
        } as never)

        const request = createGetRequest('ABC123')
        const response = await GET(request, mockParams('ABC123'))

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.isAlreadyMember).toBe(true)
      })
    })

    describe('Error Handling', () => {
      it('should return 500 on database error', async () => {
        vi.mocked(prisma.class.findUnique).mockRejectedValue(new Error('Database error'))

        const request = createGetRequest('ABC123')
        const response = await GET(request, mockParams('ABC123'))

        expect(response.status).toBe(500)
        const data = await response.json()
        expect(data.error).toBe('Failed to preview class')
      })
    })
  })
})
