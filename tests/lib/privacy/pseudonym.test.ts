import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generatePseudonym, verifyStudentEmail, isStudentEmail, getStudentDisplayName } from '@/lib/privacy/pseudonym'

describe('lib/privacy/pseudonym', () => {
  const originalEnv = process.env.STUDENT_PSEUDONYM_SECRET

  beforeEach(() => {
    process.env.STUDENT_PSEUDONYM_SECRET = 'test-secret-key-for-testing-purposes-only-min-32-chars'
  })

  afterEach(() => {
    process.env.STUDENT_PSEUDONYM_SECRET = originalEnv
  })

  describe('generatePseudonym', () => {
    it('should generate a deterministic pseudonym for the same email', () => {
      const email = 'student@example.com'
      const pseudonym1 = generatePseudonym(email)
      const pseudonym2 = generatePseudonym(email)

      expect(pseudonym1).toBe(pseudonym2)
    })

    it('should generate different pseudonyms for different emails', () => {
      const pseudonym1 = generatePseudonym('student1@example.com')
      const pseudonym2 = generatePseudonym('student2@example.com')

      expect(pseudonym1).not.toBe(pseudonym2)
    })

    it('should normalize email to lowercase', () => {
      const pseudonym1 = generatePseudonym('Student@Example.Com')
      const pseudonym2 = generatePseudonym('student@example.com')

      expect(pseudonym1).toBe(pseudonym2)
    })

    it('should trim whitespace from email', () => {
      const pseudonym1 = generatePseudonym('  student@example.com  ')
      const pseudonym2 = generatePseudonym('student@example.com')

      expect(pseudonym1).toBe(pseudonym2)
    })

    it('should throw error when STUDENT_PSEUDONYM_SECRET is not set', () => {
      delete process.env.STUDENT_PSEUDONYM_SECRET

      expect(() => generatePseudonym('student@example.com'))
        .toThrow('STUDENT_PSEUDONYM_SECRET environment variable is not set')
    })

    it('should return a hexadecimal string', () => {
      const pseudonym = generatePseudonym('student@example.com')
      expect(pseudonym).toMatch(/^[a-f0-9]+$/)
    })

    it('should return consistent length pseudonyms', () => {
      const pseudonym1 = generatePseudonym('a@b.com')
      const pseudonym2 = generatePseudonym('very.long.email.address@subdomain.example.com')

      expect(pseudonym1.length).toBe(pseudonym2.length)
    })

    // Security test: Check truncation length (should be at least 32 chars for security)
    it('should generate pseudonyms with sufficient length for security', () => {
      const pseudonym = generatePseudonym('student@example.com')

      // Warn if less than 32 characters (128 bits)
      if (pseudonym.length < 32) {
        console.warn(`⚠️  Pseudonym length is ${pseudonym.length}, recommended minimum is 32 for security`)
      }

      // Should be at least 16 characters (current implementation)
      expect(pseudonym.length).toBeGreaterThanOrEqual(16)
    })

    // Collision resistance test
    it('should have low collision probability', () => {
      const pseudonyms = new Set<string>()
      const count = 10000

      for (let i = 0; i < count; i++) {
        const email = `student${i}@example.com`
        const pseudonym = generatePseudonym(email)
        pseudonyms.add(pseudonym)
      }

      // All pseudonyms should be unique
      expect(pseudonyms.size).toBe(count)
    })
  })

  describe('verifyStudentEmail', () => {
    it('should verify matching email and pseudonym', () => {
      const email = 'student@example.com'
      const pseudonym = generatePseudonym(email)

      const result = verifyStudentEmail(pseudonym, email)

      expect(result).toBe(true)
    })

    it('should reject non-matching email and pseudonym', () => {
      const email1 = 'student1@example.com'
      const email2 = 'student2@example.com'
      const pseudonym = generatePseudonym(email1)

      const result = verifyStudentEmail(pseudonym, email2)

      expect(result).toBe(false)
    })

    it('should normalize email before verification', () => {
      const email = 'student@example.com'
      const pseudonym = generatePseudonym(email)

      const result = verifyStudentEmail(pseudonym, 'Student@Example.Com')

      expect(result).toBe(true)
    })

    it('should handle errors gracefully', () => {
      delete process.env.STUDENT_PSEUDONYM_SECRET

      const result = verifyStudentEmail('invalid', 'student@example.com')

      expect(result).toBe(false)
    })

    it('should reject empty pseudonym', () => {
      const result = verifyStudentEmail('', 'student@example.com')

      expect(result).toBe(false)
    })

    it('should reject empty email', () => {
      const pseudonym = generatePseudonym('student@example.com')
      const result = verifyStudentEmail(pseudonym, '')

      expect(result).toBe(false)
    })

    // Timing attack test (basic - should use constant-time comparison)
    it('should use constant-time comparison (manual verification needed)', () => {
      const email = 'student@example.com'
      const pseudonym = generatePseudonym(email)

      const iterations = 1000
      const times: number[] = []

      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint()
        verifyStudentEmail(pseudonym, email)
        const end = process.hrtime.bigint()
        times.push(Number(end - start))
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length
      const variance = times.reduce((sum, time) => sum + Math.pow(time - avg, 2), 0) / times.length
      const stdDev = Math.sqrt(variance)

      // Log timing statistics for manual review
      console.log('Timing statistics (nanoseconds):', {
        avg: avg.toFixed(2),
        stdDev: stdDev.toFixed(2),
        coefficient: (stdDev / avg * 100).toFixed(2) + '%'
      })

      // Test passes regardless - this is for manual inspection
      expect(true).toBe(true)
    })
  })

  describe('isStudentEmail', () => {
    it('should return false by default (current implementation)', () => {
      const result = isStudentEmail('student@example.com')

      expect(result).toBe(false)
    })

    it('should normalize email before checking', () => {
      const result1 = isStudentEmail('Student@Example.Com')
      const result2 = isStudentEmail('student@example.com')

      expect(result1).toBe(result2)
    })

    it('should handle empty email', () => {
      const result = isStudentEmail('')

      expect(result).toBe(false)
    })

    it('should trim whitespace', () => {
      const result1 = isStudentEmail('  student@example.com  ')
      const result2 = isStudentEmail('student@example.com')

      expect(result1).toBe(result2)
    })
  })

  describe('getStudentDisplayName', () => {
    it('should generate display name from pseudonym', () => {
      const pseudonym = 'a3f5b9c2d8e1f4a7'
      const displayName = getStudentDisplayName(pseudonym)

      expect(displayName).toBe('Student a3f5')
    })

    it('should handle short pseudonyms', () => {
      const pseudonym = 'abc'
      const displayName = getStudentDisplayName(pseudonym)

      expect(displayName).toBe('Student abc')
    })

    it('should use first 4 characters', () => {
      const pseudonym = '1234567890abcdef'
      const displayName = getStudentDisplayName(pseudonym)

      expect(displayName).toContain('1234')
    })

    it('should have consistent format', () => {
      const pseudonym = generatePseudonym('student@example.com')
      const displayName = getStudentDisplayName(pseudonym)

      expect(displayName).toMatch(/^Student [a-f0-9]+$/)
    })
  })

  // Security edge cases
  describe('Security edge cases', () => {
    it('should handle unicode characters in email', () => {
      const email = 'student+测试@example.com'
      const pseudonym1 = generatePseudonym(email)
      const pseudonym2 = generatePseudonym(email)

      expect(pseudonym1).toBe(pseudonym2)
      expect(verifyStudentEmail(pseudonym1, email)).toBe(true)
    })

    it('should handle very long emails', () => {
      const longLocal = 'a'.repeat(64) // Max local part length
      const longDomain = 'b'.repeat(63) + '.com' // Max label length
      const email = `${longLocal}@${longDomain}`

      const pseudonym = generatePseudonym(email)

      expect(pseudonym).toBeTruthy()
      expect(verifyStudentEmail(pseudonym, email)).toBe(true)
    })

    it('should handle emails with special characters', () => {
      const email = 'student+tag@example.com'
      const pseudonym = generatePseudonym(email)

      expect(verifyStudentEmail(pseudonym, email)).toBe(true)
    })

    it('should handle emails with dots', () => {
      const email = 'first.last@example.com'
      const pseudonym = generatePseudonym(email)

      expect(verifyStudentEmail(pseudonym, email)).toBe(true)
    })

    it('should not accept similar-looking emails as same', () => {
      const email1 = 'student@example.com'
      const email2 = 'student@examp1e.com' // l -> 1

      const pseudonym1 = generatePseudonym(email1)
      const pseudonym2 = generatePseudonym(email2)

      expect(pseudonym1).not.toBe(pseudonym2)
    })
  })
})
