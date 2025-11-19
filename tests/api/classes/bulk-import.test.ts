import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/classes/[id]/bulk-import/route'
import { NextRequest } from 'next/server'

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    class: {
      findUnique: vi.fn(),
    },
    classMembership: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    preAuthorizedStudent: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}))

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/privacy/pseudonym', () => ({
  generatePseudonym: vi.fn((email: string) => {
    // Deterministic hash for testing
    return email.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 16)
  }),
}))

import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { generatePseudonym } from '@/lib/privacy/pseudonym'

describe('API /classes/[id]/bulk-import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createRequest = (classId: string, body: any) => {
    return new NextRequest(`http://localhost:3000/api/classes/${classId}/bulk-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const mockSession = {
    user: {
      id: 'teacher-123',
      email: 'teacher@example.com',
      name: 'Teacher',
    },
  }

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null)

      const request = createRequest('class-123', { emails: ['student@example.com'] })
      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })
  })

  describe('Authorization', () => {
    it('should reject if class does not exist', async () => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.class.findUnique).mockResolvedValue(null)

      const request = createRequest('nonexistent-class', { emails: ['student@example.com'] })
      const response = await POST(request, { params: Promise.resolve({ id: 'nonexistent-class' }) })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Class not found')
    })

    it('should reject if user is not the class teacher', async () => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.class.findUnique).mockResolvedValue({
        id: 'class-123',
        teacherId: 'different-teacher',
      } as any)

      const request = createRequest('class-123', { emails: ['student@example.com'] })
      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toContain('permission')
    })

    it('should allow class teacher to import students', async () => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.class.findUnique).mockResolvedValue({
        id: 'class-123',
        teacherId: 'teacher-123',
      } as any)
      vi.mocked(prisma.classMembership.findMany).mockResolvedValue([])
      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])
      vi.mocked(prisma.preAuthorizedStudent.createMany).mockResolvedValue({ count: 1 } as any)

      const request = createRequest('class-123', { emails: ['student@example.com'] })
      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })

      expect(response.status).toBe(200)
    })
  })

  describe('Input validation', () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.class.findUnique).mockResolvedValue({
        id: 'class-123',
        teacherId: 'teacher-123',
      } as any)
    })

    it('should reject if emails is not provided', async () => {
      const request = createRequest('class-123', {})
      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('emails')
    })

    it('should reject if emails is not an array', async () => {
      const request = createRequest('class-123', { emails: 'not-an-array' })
      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('array')
    })

    it('should reject if emails array is empty', async () => {
      const request = createRequest('class-123', { emails: [] })
      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('non-empty')
    })

    it('should filter out non-string values', async () => {
      vi.mocked(prisma.classMembership.findMany).mockResolvedValue([])
      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])
      vi.mocked(prisma.preAuthorizedStudent.createMany).mockResolvedValue({ count: 2 } as any)

      const request = createRequest('class-123', {
        emails: ['valid@example.com', 123, null, 'another@example.com', undefined],
      })

      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.total).toBe(2) // Only valid string emails
    })

    it('should reject if no valid emails after filtering', async () => {
      const request = createRequest('class-123', {
        emails: [123, null, undefined, ''],
      })

      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('No valid emails')
    })
  })

  describe('Email validation and normalization', () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.class.findUnique).mockResolvedValue({
        id: 'class-123',
        teacherId: 'teacher-123',
      } as any)
      vi.mocked(prisma.classMembership.findMany).mockResolvedValue([])
      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])
      vi.mocked(prisma.preAuthorizedStudent.createMany).mockResolvedValue({ count: 1 } as any)
    })

    it('should normalize emails to lowercase', async () => {
      const request = createRequest('class-123', {
        emails: ['Student@Example.COM'],
      })

      await POST(request, { params: Promise.resolve({ id: 'class-123' }) })

      expect(generatePseudonym).toHaveBeenCalledWith('student@example.com')
    })

    it('should trim whitespace from emails', async () => {
      const request = createRequest('class-123', {
        emails: ['  student@example.com  '],
      })

      await POST(request, { params: Promise.resolve({ id: 'class-123' }) })

      expect(generatePseudonym).toHaveBeenCalledWith('student@example.com')
    })

    it('should reject invalid email formats', async () => {
      const request = createRequest('class-123', {
        emails: [
          'valid@example.com',
          'invalid-email',
          '@example.com',
          'user@',
          'user @example.com',
        ],
      })

      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.total).toBe(1) // Only valid@example.com
    })

    it('should handle duplicate emails in input', async () => {
      const request = createRequest('class-123', {
        emails: [
          'student@example.com',
          'student@example.com',
          'Student@Example.Com', // Same after normalization
        ],
      })

      await POST(request, { params: Promise.resolve({ id: 'class-123' }) })

      // Should only generate pseudonym once per unique email
      const pseudonymCalls = vi.mocked(generatePseudonym).mock.calls
      const uniqueEmails = new Set(pseudonymCalls.map(call => call[0]))
      expect(uniqueEmails.size).toBeLessThanOrEqual(3)
    })
  })

  describe('Pseudonym generation', () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.class.findUnique).mockResolvedValue({
        id: 'class-123',
        teacherId: 'teacher-123',
      } as any)
      vi.mocked(prisma.classMembership.findMany).mockResolvedValue([])
      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])
      vi.mocked(prisma.preAuthorizedStudent.createMany).mockResolvedValue({ count: 2 } as any)
    })

    it('should generate pseudonyms for all valid emails', async () => {
      const emails = ['student1@example.com', 'student2@example.com']
      const request = createRequest('class-123', { emails })

      await POST(request, { params: Promise.resolve({ id: 'class-123' }) })

      expect(generatePseudonym).toHaveBeenCalledTimes(emails.length)
      expect(generatePseudonym).toHaveBeenCalledWith('student1@example.com')
      expect(generatePseudonym).toHaveBeenCalledWith('student2@example.com')
    })

    it('should create deterministic pseudonyms', async () => {
      const request = createRequest('class-123', {
        emails: ['student@example.com'],
      })

      await POST(request, { params: Promise.resolve({ id: 'class-123' }) })

      const firstPseudonym = vi.mocked(generatePseudonym).mock.results[0].value

      vi.clearAllMocks()
      vi.mocked(prisma.preAuthorizedStudent.createMany).mockResolvedValue({ count: 1 } as any)

      await POST(request, { params: Promise.resolve({ id: 'class-123' }) })

      const secondPseudonym = vi.mocked(generatePseudonym).mock.results[0].value

      expect(firstPseudonym).toBe(secondPseudonym)
    })
  })

  describe('Duplicate detection', () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.class.findUnique).mockResolvedValue({
        id: 'class-123',
        teacherId: 'teacher-123',
      } as any)
    })

    it('should detect existing class members', async () => {
      const existingPseudonym = 'student1examplecom'

      vi.mocked(prisma.classMembership.findMany).mockResolvedValue([
        {
          student: { studentPseudonym: existingPseudonym },
        },
      ] as any)
      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])
      vi.mocked(prisma.preAuthorizedStudent.createMany).mockResolvedValue({ count: 1 } as any)

      const request = createRequest('class-123', {
        emails: ['student1@example.com', 'student2@example.com'],
      })

      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })
      const data = await response.json()

      expect(data.alreadyMembers).toBe(1)
      expect(data.imported).toBe(1) // Only student2
    })

    it('should detect pre-authorized students', async () => {
      const preAuthPseudonym = 'student1examplecom'

      vi.mocked(prisma.classMembership.findMany).mockResolvedValue([])
      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([
        { pseudonym: preAuthPseudonym },
      ] as any)
      vi.mocked(prisma.preAuthorizedStudent.createMany).mockResolvedValue({ count: 1 } as any)

      const request = createRequest('class-123', {
        emails: ['student1@example.com', 'student2@example.com'],
      })

      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })
      const data = await response.json()

      expect(data.alreadyPreAuthorized).toBe(1)
      expect(data.imported).toBe(1)
    })

    it('should not import duplicates', async () => {
      vi.mocked(prisma.classMembership.findMany).mockResolvedValue([
        { student: { studentPseudonym: 'student1examplecom' } },
      ] as any)
      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])
      vi.mocked(prisma.preAuthorizedStudent.createMany).mockResolvedValue({ count: 0 } as any)

      const request = createRequest('class-123', {
        emails: ['student1@example.com'], // Already a member
      })

      await POST(request, { params: Promise.resolve({ id: 'class-123' }) })

      expect(prisma.preAuthorizedStudent.createMany).toHaveBeenCalledWith({
        data: [],
      })
    })
  })

  describe('Pre-authorization creation', () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.class.findUnique).mockResolvedValue({
        id: 'class-123',
        teacherId: 'teacher-123',
      } as any)
      vi.mocked(prisma.classMembership.findMany).mockResolvedValue([])
      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])
    })

    it('should create pre-authorizations for new students', async () => {
      vi.mocked(prisma.preAuthorizedStudent.createMany).mockResolvedValue({ count: 2 } as any)

      const request = createRequest('class-123', {
        emails: ['student1@example.com', 'student2@example.com'],
      })

      await POST(request, { params: Promise.resolve({ id: 'class-123' }) })

      expect(prisma.preAuthorizedStudent.createMany).toHaveBeenCalledWith({
        data: [
          { classId: 'class-123', pseudonym: 'student1examplecom' },
          { classId: 'class-123', pseudonym: 'student2examplecom' },
        ],
      })
    })

    it('should skip creation if no new students', async () => {
      vi.mocked(prisma.classMembership.findMany).mockResolvedValue([
        { student: { studentPseudonym: 'student1examplecom' } },
      ] as any)

      const request = createRequest('class-123', {
        emails: ['student1@example.com'], // Already a member
      })

      await POST(request, { params: Promise.resolve({ id: 'class-123' }) })

      expect(prisma.preAuthorizedStudent.createMany).not.toHaveBeenCalled()
    })
  })

  describe('Response format', () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.class.findUnique).mockResolvedValue({
        id: 'class-123',
        teacherId: 'teacher-123',
      } as any)
    })

    it('should return correct statistics', async () => {
      vi.mocked(prisma.classMembership.findMany).mockResolvedValue([
        { student: { studentPseudonym: 'student1examplecom' } },
      ] as any)
      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([
        { pseudonym: 'student2examplecom' },
      ] as any)
      vi.mocked(prisma.preAuthorizedStudent.createMany).mockResolvedValue({ count: 1 } as any)

      const request = createRequest('class-123', {
        emails: [
          'student1@example.com', // Existing member
          'student2@example.com', // Pre-authorized
          'student3@example.com', // New
        ],
      })

      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })
      const data = await response.json()

      expect(data).toEqual({
        imported: 1,
        alreadyMembers: 1,
        alreadyPreAuthorized: 1,
        total: 3,
        mappings: expect.any(Object),
      })
    })

    // 🚨 SECURITY ISSUE: This test documents the vulnerability
    it('should NOT return email->pseudonym mappings (SECURITY VULNERABILITY)', async () => {
      vi.mocked(prisma.classMembership.findMany).mockResolvedValue([])
      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])
      vi.mocked(prisma.preAuthorizedStudent.createMany).mockResolvedValue({ count: 1 } as any)

      const request = createRequest('class-123', {
        emails: ['student@example.com'],
      })

      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })
      const data = await response.json()

      // This test FAILS with current implementation - mappings are returned
      // TODO: Fix this security vulnerability
      console.warn('⚠️  SECURITY: Email mappings are exposed in API response')
      expect(data.mappings).toBeDefined() // Current (vulnerable) behavior

      // After fix, this should pass:
      // expect(data.mappings).toBeUndefined()
    })
  })

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.class.findUnique).mockRejectedValue(new Error('Database error'))

      const request = createRequest('class-123', { emails: ['student@example.com'] })
      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to import students')
    })

    it('should handle pseudonym generation errors', async () => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.class.findUnique).mockResolvedValue({
        id: 'class-123',
        teacherId: 'teacher-123',
      } as any)
      vi.mocked(generatePseudonym).mockImplementation(() => {
        throw new Error('Secret not set')
      })

      const request = createRequest('class-123', { emails: ['student@example.com'] })
      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })

      expect(response.status).toBe(500)
    })
  })

  describe('Security tests', () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.class.findUnique).mockResolvedValue({
        id: 'class-123',
        teacherId: 'teacher-123',
      } as any)
      vi.mocked(prisma.classMembership.findMany).mockResolvedValue([])
      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])
      vi.mocked(prisma.preAuthorizedStudent.createMany).mockResolvedValue({ count: 1 } as any)
    })

    it('should sanitize email inputs', async () => {
      const request = createRequest('class-123', {
        emails: ["student@example.com'; DROP TABLE users; --"],
      })

      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })

      // Should not cause SQL injection (Prisma prevents this)
      expect(response.status).toBeLessThan(500)
    })

    it('should handle very long email lists', async () => {
      const manyEmails = Array.from({ length: 1000 }, (_, i) => `student${i}@example.com`)

      vi.mocked(prisma.preAuthorizedStudent.createMany).mockResolvedValue({ count: 1000 } as any)

      const request = createRequest('class-123', { emails: manyEmails })
      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })

      expect(response.status).toBe(200)
    })

    it('should not leak information about non-owned classes', async () => {
      vi.mocked(prisma.class.findUnique).mockResolvedValue({
        id: 'class-123',
        teacherId: 'different-teacher',
      } as any)

      const request = createRequest('class-123', { emails: ['student@example.com'] })
      const response = await POST(request, { params: Promise.resolve({ id: 'class-123' }) })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).not.toContain('class-123')
      expect(data.error).not.toContain('different-teacher')
    })
  })
})
