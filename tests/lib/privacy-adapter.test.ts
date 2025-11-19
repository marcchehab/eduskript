import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PrivacyAdapter } from '@/lib/privacy-adapter'
import type { AdapterUser } from 'next-auth/adapters'

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      create: vi.fn(),
      update: vi.fn(),
    },
    preAuthorizedStudent: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    classMembership: {
      createMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/privacy/pseudonym', () => ({
  generatePseudonym: vi.fn((email: string) => {
    // Simple hash for testing
    return `pseudonym_${email.toLowerCase().replace(/[^a-z0-9]/g, '')}`
  }),
}))

vi.mock('@auth/prisma-adapter', () => ({
  PrismaAdapter: vi.fn(() => ({
    createUser: vi.fn(),
  })),
}))

import { prisma } from '@/lib/prisma'
import { generatePseudonym } from '@/lib/privacy/pseudonym'
import { PrismaAdapter } from '@auth/prisma-adapter'

describe('lib/privacy-adapter', () => {
  const originalEnv = process.env.STUDENT_PSEUDONYM_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STUDENT_PSEUDONYM_SECRET = 'test-secret-key-for-testing-purposes-only-min-32-chars'
  })

  afterEach(() => {
    process.env.STUDENT_PSEUDONYM_SECRET = originalEnv
  })

  describe('PrivacyAdapter - createUser', () => {
    const mockUser: Omit<AdapterUser, 'id'> = {
      email: 'student@example.com',
      emailVerified: new Date(),
      name: 'Test Student',
      image: 'https://example.com/avatar.jpg',
    }

    it('should create student with hashed email when isStudentSignup returns true', async () => {
      const isStudentSignup = vi.fn().mockResolvedValue(true)

      const adapter = PrivacyAdapter({
        prisma: prisma as any,
        isStudentSignup,
      })

      const mockCreatedUser = {
        id: 'user-123',
        email: 'student_pseudonymstudentexamplecom@eduskript.local',
        emailVerified: mockUser.emailVerified,
        name: 'Student pseu',
        image: null,
      }

      vi.mocked(prisma.user.create).mockResolvedValue(mockCreatedUser as any)
      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])

      const result = await adapter.createUser!(mockUser)

      expect(isStudentSignup).toHaveBeenCalledWith('student@example.com', mockUser)
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: expect.stringContaining('student_'),
          email: expect.stringContaining('@eduskript.local'),
          name: expect.stringContaining('Student'),
          image: null, // Student images not stored
          accountType: 'student',
          studentPseudonym: expect.any(String),
        }),
      })

      expect(result.email).toContain('student_')
      expect(result.email).toContain('@eduskript.local')
    })

    it('should create teacher with real email when isStudentSignup returns false', async () => {
      const isStudentSignup = vi.fn().mockResolvedValue(false)

      const mockBaseAdapter = {
        createUser: vi.fn().mockResolvedValue({
          id: 'user-123',
          email: mockUser.email,
          emailVerified: mockUser.emailVerified,
          name: mockUser.name,
          image: mockUser.image,
        }),
      }

      vi.mocked(PrismaAdapter).mockReturnValue(mockBaseAdapter as any)

      const adapter = PrivacyAdapter({
        prisma: prisma as any,
        isStudentSignup,
      })

      vi.mocked(prisma.user.update).mockResolvedValue({} as any)

      const result = await adapter.createUser!(mockUser)

      expect(isStudentSignup).toHaveBeenCalledWith('student@example.com', mockUser)
      expect(mockBaseAdapter.createUser).toHaveBeenCalledWith(mockUser)
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          accountType: 'teacher',
          lastSeenAt: expect.any(Date),
        },
      })

      expect(result.email).toBe(mockUser.email)
    })

    it('should auto-enroll student in pre-authorized classes', async () => {
      const isStudentSignup = vi.fn().mockResolvedValue(true)
      const pseudonym = 'pseudonymstudentexamplecom'

      const mockCreatedUser = {
        id: 'user-123',
        email: `student_${pseudonym}@eduskript.local`,
        emailVerified: mockUser.emailVerified,
        name: 'Student pseu',
        image: null,
      }

      const mockPreAuths = [
        { classId: 'class-1' },
        { classId: 'class-2' },
      ]

      vi.mocked(prisma.user.create).mockResolvedValue(mockCreatedUser as any)
      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue(mockPreAuths as any)
      vi.mocked(prisma.classMembership.createMany).mockResolvedValue({ count: 2 } as any)
      vi.mocked(prisma.preAuthorizedStudent.deleteMany).mockResolvedValue({ count: 2 } as any)

      const adapter = PrivacyAdapter({
        prisma: prisma as any,
        isStudentSignup,
      })

      await adapter.createUser!(mockUser)

      expect(prisma.preAuthorizedStudent.findMany).toHaveBeenCalledWith({
        where: { pseudonym },
        select: { classId: true },
      })

      expect(prisma.classMembership.createMany).toHaveBeenCalledWith({
        data: [
          { classId: 'class-1', studentId: 'user-123' },
          { classId: 'class-2', studentId: 'user-123' },
        ],
      })

      expect(prisma.preAuthorizedStudent.deleteMany).toHaveBeenCalledWith({
        where: { pseudonym },
      })
    })

    it('should not auto-enroll if no pre-authorizations exist', async () => {
      const isStudentSignup = vi.fn().mockResolvedValue(true)

      const mockCreatedUser = {
        id: 'user-123',
        email: 'student_pseudonym@eduskript.local',
        emailVerified: mockUser.emailVerified,
        name: 'Student pseu',
        image: null,
      }

      vi.mocked(prisma.user.create).mockResolvedValue(mockCreatedUser as any)
      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])

      const adapter = PrivacyAdapter({
        prisma: prisma as any,
        isStudentSignup,
      })

      await adapter.createUser!(mockUser)

      expect(prisma.classMembership.createMany).not.toHaveBeenCalled()
      expect(prisma.preAuthorizedStudent.deleteMany).not.toHaveBeenCalled()
    })

    it('should use default isStudentSignup if not provided', async () => {
      const adapter = PrivacyAdapter({
        prisma: prisma as any,
        // No isStudentSignup provided
      })

      const mockBaseAdapter = {
        createUser: vi.fn().mockResolvedValue({
          id: 'user-123',
          email: mockUser.email,
          emailVerified: mockUser.emailVerified,
          name: mockUser.name,
          image: mockUser.image,
        }),
      }

      vi.mocked(PrismaAdapter).mockReturnValue(mockBaseAdapter as any)
      vi.mocked(prisma.user.update).mockResolvedValue({} as any)

      await adapter.createUser!(mockUser)

      // Default should treat as teacher
      expect(mockBaseAdapter.createUser).toHaveBeenCalled()
    })

    it('should handle student with null emailVerified', async () => {
      const isStudentSignup = vi.fn().mockResolvedValue(true)
      const userWithoutVerification = { ...mockUser, emailVerified: null }

      const mockCreatedUser = {
        id: 'user-123',
        email: 'student_pseudonym@eduskript.local',
        emailVerified: null,
        name: 'Student pseu',
        image: null,
      }

      vi.mocked(prisma.user.create).mockResolvedValue(mockCreatedUser as any)
      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])

      const adapter = PrivacyAdapter({
        prisma: prisma as any,
        isStudentSignup,
      })

      const result = await adapter.createUser!(userWithoutVerification)

      expect(result.emailVerified).toBeNull()
    })

    it('should throw error if base adapter createUser is not implemented', async () => {
      const isStudentSignup = vi.fn().mockResolvedValue(false)

      const mockBaseAdapter = {
        // createUser not implemented
      }

      vi.mocked(PrismaAdapter).mockReturnValue(mockBaseAdapter as any)

      const adapter = PrivacyAdapter({
        prisma: prisma as any,
        isStudentSignup,
      })

      await expect(adapter.createUser!(mockUser))
        .rejects.toThrow('createUser not implemented in base adapter')
    })

    // Security test: Ensure student profile images are not stored
    it('should not store student profile images', async () => {
      const isStudentSignup = vi.fn().mockResolvedValue(true)
      const userWithImage = {
        ...mockUser,
        image: 'https://oauth-provider.com/profile.jpg',
      }

      const mockCreatedUser = {
        id: 'user-123',
        email: 'student_pseudonym@eduskript.local',
        emailVerified: mockUser.emailVerified,
        name: 'Student pseu',
        image: null, // Should be null
      }

      vi.mocked(prisma.user.create).mockResolvedValue(mockCreatedUser as any)
      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])

      const adapter = PrivacyAdapter({
        prisma: prisma as any,
        isStudentSignup,
      })

      await adapter.createUser!(userWithImage)

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          image: null,
        }),
      })
    })

    // Security test: Ensure pseudonym is deterministic
    it('should generate consistent pseudonyms for same email', async () => {
      const isStudentSignup = vi.fn().mockResolvedValue(true)

      vi.mocked(prisma.preAuthorizedStudent.findMany).mockResolvedValue([])

      const adapter = PrivacyAdapter({
        prisma: prisma as any,
        isStudentSignup,
      })

      const calls: any[] = []
      vi.mocked(prisma.user.create).mockImplementation((args) => {
        calls.push(args)
        return Promise.resolve({
          id: `user-${calls.length}`,
          ...args.data,
        } as any)
      })

      await adapter.createUser!(mockUser)
      await adapter.createUser!(mockUser)

      expect(calls[0].data.studentPseudonym).toBe(calls[1].data.studentPseudonym)
      expect(calls[0].data.email).toBe(calls[1].data.email)
    })
  })

  describe('Edge cases and error handling', () => {
    it('should handle database errors gracefully', async () => {
      const isStudentSignup = vi.fn().mockResolvedValue(true)

      vi.mocked(prisma.user.create).mockRejectedValue(new Error('Database error'))

      const adapter = PrivacyAdapter({
        prisma: prisma as any,
        isStudentSignup,
      })

      await expect(adapter.createUser!({ email: 'test@example.com' } as AdapterUser))
        .rejects.toThrow('Database error')
    })

    it('should handle isStudentSignup throwing error', async () => {
      const isStudentSignup = vi.fn().mockRejectedValue(new Error('Signup check failed'))

      const adapter = PrivacyAdapter({
        prisma: prisma as any,
        isStudentSignup,
      })

      await expect(adapter.createUser!({ email: 'test@example.com' } as AdapterUser))
        .rejects.toThrow('Signup check failed')
    })

    it('should handle pre-auth query errors gracefully', async () => {
      const isStudentSignup = vi.fn().mockResolvedValue(true)

      vi.mocked(prisma.user.create).mockResolvedValue({
        id: 'user-123',
        email: 'student_pseudonym@eduskript.local',
      } as any)

      vi.mocked(prisma.preAuthorizedStudent.findMany).mockRejectedValue(new Error('Query failed'))

      const adapter = PrivacyAdapter({
        prisma: prisma as any,
        isStudentSignup,
      })

      // Should throw the error up
      await expect(adapter.createUser!({ email: 'test@example.com' } as AdapterUser))
        .rejects.toThrow('Query failed')
    })
  })
})
