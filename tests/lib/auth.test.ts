import { describe, it, expect, vi, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'

/**
 * Authentication Tests
 *
 * These tests verify the core authentication utilities used by the auth system.
 * Note: NextAuth configuration (authOptions) is integration-tested via API routes.
 */

describe('Authentication Utilities', () => {
  describe('Password Hashing (bcrypt)', () => {
    it('should hash passwords with sufficient rounds', async () => {
      const password = 'SecurePassword123!'
      const hashedPassword = await bcrypt.hash(password, 12)

      // Verify hash format (bcrypt hashes start with $2a$ or $2b$)
      expect(hashedPassword).toMatch(/^\$2[ab]\$12\$/)
      expect(hashedPassword).not.toBe(password)
      expect(hashedPassword.length).toBeGreaterThan(50)
    })

    it('should verify correct passwords', async () => {
      const password = 'SecurePassword123!'
      const hashedPassword = await bcrypt.hash(password, 12)

      const isValid = await bcrypt.compare(password, hashedPassword)
      expect(isValid).toBe(true)
    })

    it('should reject incorrect passwords', async () => {
      const password = 'SecurePassword123!'
      const hashedPassword = await bcrypt.hash(password, 12)

      const isValid = await bcrypt.compare('WrongPassword', hashedPassword)
      expect(isValid).toBe(false)
    })

    // Four bcrypt(cost=12) ops in one test: ~3s baseline, easily 5s+ on a busy
    // machine. Vitest's 5000ms default was too tight and made this flake.
    it('should generate unique hashes for same password (salt)', async () => {
      const password = 'SamePassword123!'
      const hash1 = await bcrypt.hash(password, 12)
      const hash2 = await bcrypt.hash(password, 12)

      // Hashes should be different (different salts)
      expect(hash1).not.toBe(hash2)

      // But both should verify against the original password
      expect(await bcrypt.compare(password, hash1)).toBe(true)
      expect(await bcrypt.compare(password, hash2)).toBe(true)
    }, 15000)

    it('should handle empty passwords correctly', async () => {
      const emptyHash = await bcrypt.hash('', 12)

      expect(await bcrypt.compare('', emptyHash)).toBe(true)
      expect(await bcrypt.compare('something', emptyHash)).toBe(false)
    })

    it('should handle unicode passwords', async () => {
      const unicodePassword = '密码123!パスワード'
      const hashedPassword = await bcrypt.hash(unicodePassword, 12)

      expect(await bcrypt.compare(unicodePassword, hashedPassword)).toBe(true)
      expect(await bcrypt.compare('wrong', hashedPassword)).toBe(false)
    })

    it('should handle very long passwords', async () => {
      // bcrypt has a max input length of 72 bytes
      const longPassword = 'A'.repeat(100)
      const hashedPassword = await bcrypt.hash(longPassword, 12)

      // Note: bcrypt truncates at 72 bytes, so this tests the truncation behavior
      expect(await bcrypt.compare(longPassword, hashedPassword)).toBe(true)
    })
  })

  describe('Session Structure Validation', () => {
    // These tests document the expected session structure

    it('should have required teacher session fields', () => {
      const teacherSession = {
        user: {
          id: 'user-123',
          email: 'teacher@example.com',
          name: 'Teacher Name',
          accountType: 'teacher',
          pageSlug: 'teacher-name',
          isAdmin: false,
        },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }

      // Validate required fields
      expect(teacherSession.user.id).toBeTruthy()
      expect(teacherSession.user.email).toContain('@')
      expect(teacherSession.user.accountType).toBe('teacher')
      expect(teacherSession.user.pageSlug).toBeTruthy()
      expect(teacherSession.expires).toBeTruthy()
    })

    it('should have required student session fields', () => {
      const studentSession = {
        user: {
          id: 'user-456',
          email: 'student_abc123@eduskript.local', // Fake email
          name: null, // Students may not have names
          accountType: 'student',
          studentPseudonym: 'abc123def456',
          oauthEmail: 'real.student@school.edu', // Real email in JWT only
        },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }

      // Validate required fields
      expect(studentSession.user.id).toBeTruthy()
      expect(studentSession.user.accountType).toBe('student')
      expect(studentSession.user.studentPseudonym).toBeTruthy()
      // Student email should be the fake local email
      expect(studentSession.user.email).toContain('@eduskript.local')
      // Real OAuth email should be preserved for display
      expect(studentSession.user.oauthEmail).toContain('@school.edu')
    })

    it('should have valid expiration timestamp', () => {
      const session = {
        user: { id: 'user-123', email: 'test@example.com' },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }

      const expiresDate = new Date(session.expires)
      const now = new Date()

      // Session should expire in the future
      expect(expiresDate.getTime()).toBeGreaterThan(now.getTime())
    })
  })

  describe('JWT Token Requirements', () => {
    // Document the expected JWT token structure

    it('should contain user identification fields', () => {
      const jwtToken = {
        id: 'user-123',
        email: 'user@example.com',
        name: 'User Name',
        accountType: 'teacher',
        pageSlug: 'user-name',
        isAdmin: false,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
      }

      expect(jwtToken.id).toBeTruthy()
      expect(jwtToken.email).toBeTruthy()
      expect(jwtToken.exp).toBeGreaterThan(jwtToken.iat)
    })

    it('should distinguish between teacher and student tokens', () => {
      const teacherToken = {
        id: 'teacher-1',
        accountType: 'teacher',
        pageSlug: 'my-page',
        isAdmin: false,
      }

      const studentToken = {
        id: 'student-1',
        accountType: 'student',
        studentPseudonym: 'pseudo123',
        oauthEmail: 'student@school.edu',
      }

      expect(teacherToken.accountType).toBe('teacher')
      expect(teacherToken.pageSlug).toBeTruthy()

      expect(studentToken.accountType).toBe('student')
      expect(studentToken.studentPseudonym).toBeTruthy()
    })
  })

  describe('Reserved Path Detection', () => {
    // Test the logic used to detect student vs teacher signup

    const reservedPaths = ['auth', 'api', 'dashboard', 'admin', '_next', 'favicon.ico', 'robots.txt', 'sitemap.xml']

    function isTeacherPage(path: string): boolean {
      const segments = path.split('/').filter(Boolean)
      if (segments.length === 0) return false
      const firstSegment = segments[0].toLowerCase()
      return !reservedPaths.includes(firstSegment)
    }

    it('should identify reserved paths correctly', () => {
      expect(isTeacherPage('/auth/login')).toBe(false)
      expect(isTeacherPage('/api/health')).toBe(false)
      expect(isTeacherPage('/dashboard')).toBe(false)
      expect(isTeacherPage('/admin/users')).toBe(false)
      expect(isTeacherPage('/_next/static/chunks')).toBe(false)
    })

    it('should identify teacher pages correctly', () => {
      expect(isTeacherPage('/john-doe')).toBe(true)
      expect(isTeacherPage('/teacher-name/collection/skript')).toBe(true)
      expect(isTeacherPage('/my-page')).toBe(true)
    })

    it('should handle edge cases', () => {
      expect(isTeacherPage('/')).toBe(false) // Root is not a teacher page
      expect(isTeacherPage('')).toBe(false) // Empty is not a teacher page
    })
  })
})
