import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { validateSecurityConfiguration, generateSecureSecret } from '@/lib/security-checks'

describe('lib/security-checks', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('validateSecurityConfiguration', () => {
    describe('STUDENT_PSEUDONYM_SECRET validation', () => {
      it('should fail when STUDENT_PSEUDONYM_SECRET is not set', () => {
        delete process.env.STUDENT_PSEUDONYM_SECRET

        const result = validateSecurityConfiguration()

        expect(result.passed).toBe(false)
        expect(result.errors).toContain('STUDENT_PSEUDONYM_SECRET is not set')
      })

      it('should fail when STUDENT_PSEUDONYM_SECRET is too short', () => {
        process.env.STUDENT_PSEUDONYM_SECRET = 'tooshort'

        const result = validateSecurityConfiguration()

        expect(result.passed).toBe(false)
        expect(result.errors.some(e => e.includes('too short'))).toBe(true)
      })

      it('should fail when STUDENT_PSEUDONYM_SECRET contains weak values', () => {
        const weakSecrets = [
          'change-this-to-a-random-secret-in-production-12345678',
          'your-secret-key-here-change-in-production-extra',
        ]

        weakSecrets.forEach(secret => {
          process.env.STUDENT_PSEUDONYM_SECRET = secret

          const result = validateSecurityConfiguration()

          expect(result.passed).toBe(false)
          expect(result.errors.some(e => e.includes('weak/default value'))).toBe(true)
        })
      })

      it('should warn when STUDENT_PSEUDONYM_SECRET has low entropy', () => {
        process.env.STUDENT_PSEUDONYM_SECRET = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' // 36 'a's

        const result = validateSecurityConfiguration()

        expect(result.warnings.some(w => w.includes('low entropy'))).toBe(true)
      })

      it('should warn when STUDENT_PSEUDONYM_SECRET lacks variety', () => {
        process.env.STUDENT_PSEUDONYM_SECRET = 'aaaabbbbccccddddeeeeffffgggghhhhiiii' // Only letters

        const result = validateSecurityConfiguration()

        expect(result.warnings.some(w => w.includes('letters and numbers'))).toBe(true)
      })

      it('should pass with a strong secret', () => {
        process.env.STUDENT_PSEUDONYM_SECRET = 'a3f5b9c2d8e1f4a7b6c3d9e2f5a8b1c4d7e9f2a5b8c1d4e7f9a2b5c8d1e4f7a9b2'

        const result = validateSecurityConfiguration()

        expect(result.errors.filter(e => e.includes('STUDENT_PSEUDONYM_SECRET'))).toHaveLength(0)
      })
    })

    describe('NEXTAUTH_SECRET validation', () => {
      it('should fail when NEXTAUTH_SECRET is not set', () => {
        delete process.env.NEXTAUTH_SECRET

        const result = validateSecurityConfiguration()

        expect(result.passed).toBe(false)
        expect(result.errors).toContain('NEXTAUTH_SECRET is not set')
      })

      it('should fail when NEXTAUTH_SECRET is too short', () => {
        process.env.NEXTAUTH_SECRET = 'short'

        const result = validateSecurityConfiguration()

        expect(result.passed).toBe(false)
        expect(result.errors.some(e => e.includes('NEXTAUTH_SECRET') && e.includes('too short'))).toBe(true)
      })

      it('should fail when NEXTAUTH_SECRET contains weak values', () => {
        process.env.NEXTAUTH_SECRET = 'your-secret-key-here-change-in-production'

        const result = validateSecurityConfiguration()

        expect(result.passed).toBe(false)
        expect(result.errors.some(e => e.includes('NEXTAUTH_SECRET') && e.includes('weak'))).toBe(true)
      })

      it('should pass with a strong secret', () => {
        process.env.NEXTAUTH_SECRET = 'a3f5b9c2d8e1f4a7b6c3d9e2f5a8b1c4d7e9f2a5b8c1d4e7f9a2b5c8d1e4f7a9b2'

        const result = validateSecurityConfiguration()

        expect(result.errors.filter(e => e.includes('NEXTAUTH_SECRET'))).toHaveLength(0)
      })
    })

    describe('NEXTAUTH_URL validation in production', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'production'
        process.env.STUDENT_PSEUDONYM_SECRET = 'a'.repeat(32)
        process.env.NEXTAUTH_SECRET = 'a'.repeat(32)
      })

      it('should fail when NEXTAUTH_URL is not set in production', () => {
        delete process.env.NEXTAUTH_URL

        const result = validateSecurityConfiguration()

        expect(result.passed).toBe(false)
        expect(result.errors).toContain('NEXTAUTH_URL is not set (required in production)')
      })

      it('should fail when NEXTAUTH_URL does not use HTTPS in production', () => {
        process.env.NEXTAUTH_URL = 'http://example.com'

        const result = validateSecurityConfiguration()

        expect(result.passed).toBe(false)
        expect(result.errors).toContain('NEXTAUTH_URL must use HTTPS in production')
      })

      it('should pass when NEXTAUTH_URL uses HTTPS in production', () => {
        process.env.NEXTAUTH_URL = 'https://example.com'

        const result = validateSecurityConfiguration()

        expect(result.errors.filter(e => e.includes('NEXTAUTH_URL'))).toHaveLength(0)
      })
    })

    describe('Email configuration warnings', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'production'
        process.env.STUDENT_PSEUDONYM_SECRET = 'a'.repeat(32)
        process.env.NEXTAUTH_SECRET = 'a'.repeat(32)
        process.env.NEXTAUTH_URL = 'https://example.com'
      })

      it('should warn when BREVO_API_KEY is not set in production', () => {
        delete process.env.BREVO_API_KEY

        const result = validateSecurityConfiguration()

        expect(result.warnings.some(w => w.includes('BREVO_API_KEY'))).toBe(true)
      })

      it('should warn when EMAIL_FROM is not set in production', () => {
        delete process.env.EMAIL_FROM

        const result = validateSecurityConfiguration()

        expect(result.warnings.some(w => w.includes('EMAIL_FROM'))).toBe(true)
      })
    })

    describe('Overall validation', () => {
      it('should pass with all valid configuration', () => {
        process.env.STUDENT_PSEUDONYM_SECRET = 'a3f5b9c2d8e1f4a7b6c3d9e2f5a8b1c4'
        process.env.NEXTAUTH_SECRET = 'd7e9f2a5b8c1d4e7f9a2b5c8d1e4f7a9'
        process.env.DATABASE_URL = 'file:./data/prod.db'

        const result = validateSecurityConfiguration()

        expect(result.passed).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should accumulate multiple errors', () => {
        delete process.env.STUDENT_PSEUDONYM_SECRET
        delete process.env.NEXTAUTH_SECRET

        const result = validateSecurityConfiguration()

        expect(result.passed).toBe(false)
        expect(result.errors.length).toBeGreaterThanOrEqual(2)
      })

      it('should accumulate multiple warnings', () => {
        process.env.STUDENT_PSEUDONYM_SECRET = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        process.env.NEXTAUTH_SECRET = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

        const result = validateSecurityConfiguration()

        expect(result.warnings.length).toBeGreaterThan(0)
      })
    })
  })

  describe('generateSecureSecret', () => {
    it('should generate a secret of default length (64 chars)', () => {
      const secret = generateSecureSecret()

      expect(secret.length).toBe(128) // 64 bytes = 128 hex chars
    })

    it('should generate a secret of specified length', () => {
      const secret = generateSecureSecret(32)

      expect(secret.length).toBe(64) // 32 bytes = 64 hex chars
    })

    it('should generate unique secrets', () => {
      const secrets = new Set()

      for (let i = 0; i < 100; i++) {
        secrets.add(generateSecureSecret(32))
      }

      expect(secrets.size).toBe(100)
    })

    it('should generate hex strings', () => {
      const secret = generateSecureSecret(16)

      expect(secret).toMatch(/^[a-f0-9]+$/)
    })

    it('should generate secrets that pass validation', () => {
      const secret = generateSecureSecret(32)

      process.env.STUDENT_PSEUDONYM_SECRET = secret
      process.env.NEXTAUTH_SECRET = generateSecureSecret(32)

      const result = validateSecurityConfiguration()

      expect(result.errors.filter(e =>
        e.includes('STUDENT_PSEUDONYM_SECRET') || e.includes('NEXTAUTH_SECRET')
      )).toHaveLength(0)
    })
  })

  describe('Security edge cases', () => {
    it('should handle missing NODE_ENV', () => {
      delete process.env.NODE_ENV
      process.env.STUDENT_PSEUDONYM_SECRET = 'a'.repeat(32)
      process.env.NEXTAUTH_SECRET = 'a'.repeat(32)

      const result = validateSecurityConfiguration()

      // Should not crash
      expect(result).toBeDefined()
    })

    it('should handle very long secrets', () => {
      process.env.STUDENT_PSEUDONYM_SECRET = 'a'.repeat(1000)
      process.env.NEXTAUTH_SECRET = 'b'.repeat(1000)

      const result = validateSecurityConfiguration()

      // Long secrets are fine
      expect(result.errors.filter(e =>
        e.includes('too short')
      )).toHaveLength(0)
    })

    it('should detect case-insensitive weak values', () => {
      process.env.STUDENT_PSEUDONYM_SECRET = 'CHANGE-THIS-TO-A-RANDOM-SECRET-IN-PRODUCTION'

      const result = validateSecurityConfiguration()

      expect(result.passed).toBe(false)
      expect(result.errors.some(e => e.includes('weak/default value'))).toBe(true)
    })
  })
})
