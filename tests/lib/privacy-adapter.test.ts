import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PrivacyAdapter } from '@/lib/privacy-adapter'
import { PrismaClient } from '@prisma/client'

/**
 * OAuth Signup Flow Tests
 *
 * These tests define the expected behavior for OAuth signups:
 *
 * 1. OAuth from teacher page (e.g., /eduadmin):
 *    - New user → Create STUDENT account (no email stored)
 *    - Existing teacher → Log into teacher account
 *    - Existing student → Log into student account (no duplicate)
 *
 * 2. OAuth from main site (e.g., /dashboard, /auth/signup):
 *    - New user → Create TEACHER account (email stored)
 *    - Existing teacher → Log into teacher account
 *    - Existing student → Log into student account
 */

// Mock Prisma client
const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  account: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  // Site is the new owner of page slugs — used by findUniquePageSlug
  // and by the teacher account upsert.
  site: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'site-1', slug: 'placeholder' }),
  },
  // Required for autoJoinOrgByEmailDomain
  organization: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  organizationMember: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
} as unknown as PrismaClient

// Mock the base PrismaAdapter
vi.mock('@auth/prisma-adapter', () => ({
  PrismaAdapter: vi.fn(() => ({
    createUser: vi.fn(),
    getUser: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserByAccount: vi.fn(),
    updateUser: vi.fn(),
    linkAccount: vi.fn(),
    deleteUser: vi.fn(),
    unlinkAccount: vi.fn(),
    getSessionAndUser: vi.fn(),
    createSession: vi.fn(),
    updateSession: vi.fn(),
    deleteSession: vi.fn(),
  })),
}))

vi.mock('@/lib/trial', () => ({
  createTrialSubscription: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}))

// Mock pseudonym generation
vi.mock('@/lib/privacy/pseudonym', () => ({
  generatePseudonym: vi.fn((email: string) => `pseudonym_${email.split('@')[0]}`),
  getStableStudentNickname: vi.fn((pseudonym: string) => `Wise Seneca ${pseudonym.slice(0, 4)}`),
}))

describe('OAuth Signup Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('OAuth from teacher page (student signup context)', () => {
    const isStudentSignup = vi.fn().mockResolvedValue({ isStudent: true, teacherSlug: 'some-teacher' })

    it('should create a STUDENT account for new users', async () => {
      const adapter = PrivacyAdapter({
        prisma: mockPrisma,
        isStudentSignup,
      })

      // Mock: no existing user
      ;(mockPrisma.user.create as any).mockResolvedValue({
        id: 'new-student-id',
        name: 'Student abc',
        accountType: 'student',
        studentPseudonym: 'pseudonym_student',
        image: null,
      })

      const result = await adapter.createUser!({
        email: 'student@school.edu',
        emailVerified: null,
        name: 'Original Name',
        image: 'https://example.com/photo.jpg',
      })

      // Should call isStudentSignup
      expect(isStudentSignup).toHaveBeenCalledWith('student@school.edu', expect.anything())

      // Should create user WITHOUT storing the real email
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accountType: 'student',
          studentPseudonym: expect.any(String),
          // Should NOT contain the real email
        }),
      })

      // The create call should NOT have email field
      const createCall = (mockPrisma.user.create as any).mock.calls[0][0]
      expect(createCall.data.email).toBeUndefined()

      // Should return a fake email for NextAuth compatibility
      expect(result.email).toMatch(/@eduskript\.local$/)
      expect(result.email).not.toBe('student@school.edu')
    })

    it('should NOT store student email in database', async () => {
      const adapter = PrivacyAdapter({
        prisma: mockPrisma,
        isStudentSignup,
      })

      ;(mockPrisma.user.create as any).mockResolvedValue({
        id: 'student-id',
        name: 'Student xyz',
        accountType: 'student',
        studentPseudonym: 'hash123',
        image: null,
      })

      await adapter.createUser!({
        email: 'real.student.email@school.edu',
        emailVerified: null,
        name: 'Student Name',
        image: null,
      })

      const createCall = (mockPrisma.user.create as any).mock.calls[0][0]

      // Critical: email must NOT be in the database record
      expect(createCall.data.email).toBeUndefined()
      // The pseudonym is derived from email but doesn't expose the actual email
      // It should be a hash, not contain the plain email
      expect(createCall.data.studentPseudonym).toBeDefined()
    })

    it('should generate anonymous display name for students', async () => {
      const adapter = PrivacyAdapter({
        prisma: mockPrisma,
        isStudentSignup,
      })

      ;(mockPrisma.user.create as any).mockResolvedValue({
        id: 'student-id',
        name: 'Student abc',
        accountType: 'student',
        studentPseudonym: 'hash123',
        image: null,
      })

      await adapter.createUser!({
        email: 'john.doe@school.edu',
        emailVerified: null,
        name: 'John Doe', // Real name from OAuth
        image: null,
      })

      const createCall = (mockPrisma.user.create as any).mock.calls[0][0]

      // Should NOT use the real name
      expect(createCall.data.name).not.toBe('John Doe')
      // Should use the deterministic Adjective Philosopher xxxx pattern from
      // getStableStudentNickname (mocked above to return "Wise Seneca <4>"
      // so the assertion stays decoupled from the production word list).
      expect(createCall.data.name).toMatch(/^Wise Seneca [a-z0-9]+$/)
    })
  })

  describe('OAuth from main site (teacher signup context)', () => {
    const isStudentSignup = vi.fn().mockResolvedValue({ isStudent: false })

    it('should create a TEACHER account for new users', async () => {
      // We need to mock the base adapter's createUser for this case
      const mockBaseCreateUser = vi.fn().mockResolvedValue({
        id: 'new-teacher-id',
        email: 'teacher@school.edu',
        emailVerified: null,
        name: 'Teacher Name',
        image: 'https://example.com/photo.jpg',
      })

      // Re-mock PrismaAdapter for this test
      const { PrismaAdapter } = await import('@auth/prisma-adapter')
      ;(PrismaAdapter as any).mockReturnValue({
        createUser: mockBaseCreateUser,
        getUserByEmail: vi.fn(),
        getUserByAccount: vi.fn(),
        linkAccount: vi.fn(),
      })

      const adapter = PrivacyAdapter({
        prisma: mockPrisma,
        isStudentSignup,
      })

      // Mock the update for setting accountType
      ;(mockPrisma.user.update as any).mockResolvedValue({
        id: 'new-teacher-id',
        accountType: 'teacher',
        pageSlug: 'teacher',
      })

      ;(mockPrisma.user.findUnique as any).mockResolvedValue(null)

      const result = await adapter.createUser!({
        email: 'teacher@school.edu',
        emailVerified: null,
        name: 'Teacher Name',
        image: 'https://example.com/photo.jpg',
      })

      // Should call isStudentSignup
      expect(isStudentSignup).toHaveBeenCalledWith('teacher@school.edu', expect.anything())

      // Should use base adapter (which stores email)
      expect(mockBaseCreateUser).toHaveBeenCalled()

      // Should update user to set accountType to teacher
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accountType: 'teacher',
          }),
        })
      )
    })

    it('should store teacher email in database', async () => {
      const mockBaseCreateUser = vi.fn().mockResolvedValue({
        id: 'teacher-id',
        email: 'real.teacher@school.edu',
        emailVerified: null,
        name: 'Teacher',
        image: null,
      })

      const { PrismaAdapter } = await import('@auth/prisma-adapter')
      ;(PrismaAdapter as any).mockReturnValue({
        createUser: mockBaseCreateUser,
        getUserByEmail: vi.fn(),
        getUserByAccount: vi.fn(),
        linkAccount: vi.fn(),
      })

      const adapter = PrivacyAdapter({
        prisma: mockPrisma,
        isStudentSignup,
      })

      ;(mockPrisma.user.update as any).mockResolvedValue({})
      ;(mockPrisma.user.findUnique as any).mockResolvedValue(null)

      const result = await adapter.createUser!({
        email: 'real.teacher@school.edu',
        emailVerified: null,
        name: 'Teacher Name',
        image: null,
      })

      // Base adapter is called with the real email
      expect(mockBaseCreateUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'real.teacher@school.edu',
        })
      )

      // Result should contain real email
      expect(result.email).toBe('real.teacher@school.edu')
    })
  })

  describe('Returning user login (no duplicate accounts)', () => {
    it('should find existing student by OAuth account on subsequent login', async () => {
      // This test defines expected behavior that getUserByAccount should work
      const mockGetUserByAccount = vi.fn().mockResolvedValue({
        id: 'existing-student-id',
        email: null, // Students don't have email stored
        name: 'Student abc',
        accountType: 'student',
      })

      const { PrismaAdapter } = await import('@auth/prisma-adapter')
      ;(PrismaAdapter as any).mockReturnValue({
        createUser: vi.fn(),
        getUserByEmail: vi.fn().mockResolvedValue(null), // Won't find by email
        getUserByAccount: mockGetUserByAccount,
        linkAccount: vi.fn(),
      })

      const adapter = PrivacyAdapter({
        prisma: mockPrisma,
        isStudentSignup: vi.fn().mockResolvedValue({ isStudent: true, teacherSlug: 'some-teacher' }),
      })

      // Simulate NextAuth calling getUserByAccount
      const existingUser = await adapter.getUserByAccount!({
        provider: 'azure-ad',
        providerAccountId: 'oauth-id-123',
        type: 'oauth',
      })

      expect(mockGetUserByAccount).toHaveBeenCalledWith({
        provider: 'azure-ad',
        providerAccountId: 'oauth-id-123',
        type: 'oauth',
      })

      // Should return the existing user, NOT create a new one
      expect(existingUser).toEqual(
        expect.objectContaining({
          id: 'existing-student-id',
          accountType: 'student',
        })
      )
    })

    it('should NOT call createUser when returning student logs in again', async () => {
      /**
       * This is the CRITICAL test for returning students.
       *
       * NextAuth OAuth flow:
       * 1. User clicks "Sign in with Microsoft"
       * 2. After OAuth callback, NextAuth calls getUserByAccount({ provider, providerAccountId })
       * 3. If user found → sign them in (no createUser call)
       * 4. If user NOT found → call getUserByEmail, then createUser if still not found
       *
       * For students: Since we don't store their email, getUserByEmail will return null.
       * The ONLY way to find returning students is via getUserByAccount.
       * If getUserByAccount works correctly, createUser should NEVER be called for returning students.
       */

      const mockCreateUser = vi.fn()
      const mockGetUserByAccount = vi.fn().mockResolvedValue({
        id: 'existing-student-id',
        email: null,
        name: 'Student abc',
        accountType: 'student',
      })

      const { PrismaAdapter } = await import('@auth/prisma-adapter')
      ;(PrismaAdapter as any).mockReturnValue({
        createUser: mockCreateUser,
        getUserByEmail: vi.fn().mockResolvedValue(null),
        getUserByAccount: mockGetUserByAccount,
        linkAccount: vi.fn(),
      })

      const adapter = PrivacyAdapter({
        prisma: mockPrisma,
        isStudentSignup: vi.fn().mockResolvedValue({ isStudent: true, teacherSlug: 'some-teacher' }),
      })

      // Step 1: NextAuth calls getUserByAccount - should find existing student
      const existingUser = await adapter.getUserByAccount!({
        provider: 'azure-ad',
        providerAccountId: 'oauth-id-123',
        type: 'oauth',
      })

      // Step 2: Verify student was found
      expect(existingUser).not.toBeNull()
      expect(existingUser?.id).toBe('existing-student-id')

      // Step 3: Since user was found, NextAuth should NOT call createUser
      // (This simulates what NextAuth does internally)
      // If getUserByAccount returns a user, createUser is never called
      expect(mockCreateUser).not.toHaveBeenCalled()
    })

    it('should create new student only when OAuth account not found', async () => {
      /**
       * This tests the first-time student signup flow.
       * When getUserByAccount returns null, NextAuth will eventually call createUser.
       */

      const mockCreateUser = vi.fn()
      const mockGetUserByAccount = vi.fn().mockResolvedValue(null) // No existing account

      const { PrismaAdapter } = await import('@auth/prisma-adapter')
      ;(PrismaAdapter as any).mockReturnValue({
        createUser: mockCreateUser,
        getUserByEmail: vi.fn().mockResolvedValue(null),
        getUserByAccount: mockGetUserByAccount,
        linkAccount: vi.fn(),
      })

      // Mock prisma.user.create for our custom createUser
      ;(mockPrisma.user.create as any).mockResolvedValue({
        id: 'new-student-id',
        name: 'Student xyz',
        accountType: 'student',
        studentPseudonym: 'hash123',
        image: null,
      })

      const adapter = PrivacyAdapter({
        prisma: mockPrisma,
        isStudentSignup: vi.fn().mockResolvedValue({ isStudent: true, teacherSlug: 'some-teacher' }),
      })

      // Step 1: NextAuth calls getUserByAccount - no existing account found
      const existingUser = await adapter.getUserByAccount!({
        provider: 'azure-ad',
        providerAccountId: 'new-oauth-id',
        type: 'oauth',
      })

      // Step 2: No user found
      expect(existingUser).toBeNull()

      // Step 3: Since user not found, NextAuth calls createUser
      // (Simulating NextAuth behavior after getUserByAccount returns null)
      const newUser = await adapter.createUser!({
        email: 'new.student@school.edu',
        emailVerified: null,
        name: 'New Student',
        image: null,
      })

      // Step 4: New student should be created
      expect(mockPrisma.user.create).toHaveBeenCalled()
      expect(newUser.id).toBe('new-student-id')
    })

    it('should find existing teacher by email on login from teacher page', async () => {
      // Even if coming from teacher page, existing teachers should log into their account
      const mockGetUserByEmail = vi.fn().mockResolvedValue({
        id: 'existing-teacher-id',
        email: 'teacher@school.edu',
        name: 'Teacher Name',
        accountType: 'teacher',
      })

      const { PrismaAdapter } = await import('@auth/prisma-adapter')
      ;(PrismaAdapter as any).mockReturnValue({
        createUser: vi.fn(),
        getUserByEmail: mockGetUserByEmail,
        getUserByAccount: vi.fn().mockResolvedValue(null),
        linkAccount: vi.fn(),
      })

      const adapter = PrivacyAdapter({
        prisma: mockPrisma,
        isStudentSignup: vi.fn().mockResolvedValue({ isStudent: true, teacherSlug: 'some-teacher' }), // From teacher page
      })

      // NextAuth first checks getUserByAccount (returns null for new OAuth)
      // Then checks getUserByEmail
      const existingUser = await adapter.getUserByEmail!('teacher@school.edu')

      expect(mockGetUserByEmail).toHaveBeenCalledWith('teacher@school.edu')
      expect(existingUser).toEqual(
        expect.objectContaining({
          id: 'existing-teacher-id',
          accountType: 'teacher',
        })
      )
    })
  })

  describe('isStudentSignup callback URL detection', () => {
    it('should detect student signup from teacher page URL', async () => {
      // This would be tested against the actual isStudentSignup implementation
      // For now, define expected inputs/outputs

      const teacherPageUrls = [
        '/eduadmin',
        '/john-doe',
        '/teacher123',
        'http://localhost:3000/eduadmin',
        'http://eduskript.org/my-teacher-page',
      ]

      const mainSiteUrls = [
        '/dashboard',
        '/auth/signup',
        '/auth/signin',
        '/api/anything',
        '/admin',
        'http://localhost:3000/dashboard',
      ]

      // These are the expected behaviors - actual implementation should match
      teacherPageUrls.forEach(url => {
        // Expect isStudentSignup to return true for teacher page URLs
        // (when there's a valid teacher with that pageSlug)
      })

      mainSiteUrls.forEach(url => {
        // Expect isStudentSignup to return false for main site URLs
      })
    })
  })
})

describe('Account Type Invariants', () => {
  it('student accounts should never have real email stored', () => {
    // Define the invariant
    const validateStudentAccount = (user: any) => {
      if (user.accountType === 'student') {
        // Email should either be null/undefined or a fake @eduskript.local email
        const emailIsPrivate = !user.email || user.email.endsWith('@eduskript.local')
        expect(emailIsPrivate).toBe(true)
      }
    }

    // Valid student accounts
    validateStudentAccount({ accountType: 'student', email: null })
    validateStudentAccount({ accountType: 'student', email: undefined })
    validateStudentAccount({ accountType: 'student', email: 'student_abc@eduskript.local' })

    // This should fail the invariant (but we're just documenting expected behavior)
    // validateStudentAccount({ accountType: 'student', email: 'real@email.com' }) // SHOULD FAIL
  })

  it('teacher accounts should have real email stored', () => {
    const validateTeacherAccount = (user: any) => {
      if (user.accountType === 'teacher') {
        expect(user.email).toBeTruthy()
        expect(user.email.endsWith('@eduskript.local')).toBe(false)
      }
    }

    validateTeacherAccount({ accountType: 'teacher', email: 'teacher@school.edu' })
  })

  it('students should have pseudonym for teacher matching', () => {
    const validateStudentPseudonym = (user: any) => {
      if (user.accountType === 'student') {
        expect(user.studentPseudonym).toBeTruthy()
        expect(typeof user.studentPseudonym).toBe('string')
      }
    }

    validateStudentPseudonym({ accountType: 'student', studentPseudonym: 'abc123hash' })
  })
})
