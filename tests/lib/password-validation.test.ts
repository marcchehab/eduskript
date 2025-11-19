import { describe, it, expect } from 'vitest'
import { validatePassword, generateSecurePassword } from '@/lib/password-validation'

describe('lib/password-validation', () => {
  describe('validatePassword', () => {
    describe('Length requirements', () => {
      it('should reject passwords shorter than 12 characters', () => {
        const result = validatePassword('Short1!')

        expect(result.valid).toBe(false)
        expect(result.errors).toContain('Password must be at least 12 characters long')
      })

      it('should accept passwords with 12 characters', () => {
        const result = validatePassword('ValidPass123!')

        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should give higher score to longer passwords', () => {
        const short = validatePassword('ValidPass123!')
        const long = validatePassword('ValidPassword1234!')

        expect(long.score).toBeGreaterThan(short.score)
      })
    })

    describe('Character variety requirements', () => {
      it('should require lowercase letters', () => {
        const result = validatePassword('UPPERCASE123!')

        expect(result.valid).toBe(false)
        expect(result.errors).toContain('Password must contain at least one lowercase letter')
      })

      it('should require uppercase letters', () => {
        const result = validatePassword('lowercase123!')

        expect(result.valid).toBe(false)
        expect(result.errors).toContain('Password must contain at least one uppercase letter')
      })

      it('should require numbers', () => {
        const result = validatePassword('NoNumbersHere!')

        expect(result.valid).toBe(false)
        expect(result.errors).toContain('Password must contain at least one number')
      })

      it('should accept passwords with all required character types', () => {
        const result = validatePassword('ValidPassword123')

        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should give bonus points for special characters', () => {
        const withoutSpecial = validatePassword('ValidPassword123')
        const withSpecial = validatePassword('ValidPassword123!')

        expect(withSpecial.score).toBeGreaterThan(withoutSpecial.score)
      })
    })

    describe('Common password detection', () => {
      it('should reject common passwords', () => {
        const commonPasswords = [
          'password123',
          'qwerty123456',
          '12345678901234',
          'Password123!', // Case insensitive
        ]

        commonPasswords.forEach(pwd => {
          const result = validatePassword(pwd)
          expect(result.valid).toBe(false)
          expect(result.errors.some(e => e.includes('too common'))).toBe(true)
        })
      })

      it('should accept unique passwords', () => {
        const result = validatePassword('MyUnique1Pass!')

        expect(result.errors.some(e => e.includes('too common'))).toBe(false)
      })
    })

    describe('Pattern detection', () => {
      it('should reject all same character', () => {
        const result = validatePassword('aaaaaaaaaaaa')

        expect(result.valid).toBe(false)
        expect(result.errors).toContain('Password cannot be all the same character')
      })

      it('should reject sequential numbers', () => {
        const result = validatePassword('Abc123456789!')

        expect(result.errors.some(e => e.includes('numeric pattern'))).toBe(true)
      })

      it('should reject sequential letters', () => {
        const result = validatePassword('Abcdefghij12!')

        expect(result.errors.some(e => e.includes('letter pattern'))).toBe(true)
      })

      it('should reject keyboard patterns', () => {
        const patterns = [
          'Qwerty123456!',
          'Asdfgh123456!',
          'Qazwsx123456!',
        ]

        patterns.forEach(pwd => {
          const result = validatePassword(pwd)
          expect(result.errors.some(e => e.includes('keyboard patterns'))).toBe(true)
        })
      })
    })

    describe('Strength assessment', () => {
      it('should classify weak passwords', () => {
        const result = validatePassword('weakpass1234') // Missing uppercase, common word

        expect(result.strength).toBe('weak')
        expect(result.score).toBeLessThanOrEqual(2)
      })

      it('should classify medium passwords', () => {
        const result = validatePassword('MediumPass12') // Meets requirements

        expect(result.strength).toBe('medium')
        expect(result.score).toBeGreaterThan(2)
        expect(result.score).toBeLessThanOrEqual(4)
      })

      it('should classify strong passwords', () => {
        const result = validatePassword('Str0ng!P@ssw0rdH3r3') // Long + variety

        expect(result.strength).toBe('strong')
        expect(result.score).toBeGreaterThan(4)
      })
    })

    describe('Edge cases', () => {
      it('should handle empty password', () => {
        const result = validatePassword('')

        expect(result.valid).toBe(false)
        expect(result.errors.length).toBeGreaterThan(0)
      })

      it('should handle very long passwords', () => {
        const longPassword = 'A1!' + 'x'.repeat(100)
        const result = validatePassword(longPassword)

        expect(result.valid).toBe(true)
      })

      it('should handle unicode characters', () => {
        const result = validatePassword('Pässw0rd123测试!')

        // Should still validate based on ASCII requirements
        expect(result.valid).toBe(true)
      })

      it('should handle passwords with only special characters', () => {
        const result = validatePassword('!@#$%^&*()_+')

        expect(result.valid).toBe(false)
        expect(result.errors).toContain('Password must contain at least one lowercase letter')
        expect(result.errors).toContain('Password must contain at least one uppercase letter')
        expect(result.errors).toContain('Password must contain at least one number')
      })
    })

    describe('Multiple errors', () => {
      it('should return all validation errors', () => {
        const result = validatePassword('short')

        expect(result.errors.length).toBeGreaterThan(1)
        expect(result.errors).toContain('Password must be at least 12 characters long')
        expect(result.errors).toContain('Password must contain at least one uppercase letter')
        expect(result.errors).toContain('Password must contain at least one number')
      })
    })
  })

  describe('generateSecurePassword', () => {
    it('should generate a password of specified length', () => {
      const password = generateSecurePassword(20)

      expect(password.length).toBe(20)
    })

    it('should generate a password with default length', () => {
      const password = generateSecurePassword()

      expect(password.length).toBe(16)
    })

    it('should generate passwords that pass validation', () => {
      const password = generateSecurePassword()
      const result = validatePassword(password)

      expect(result.valid).toBe(true)
      expect(result.strength).toMatch(/medium|strong/)
    })

    it('should generate unique passwords', () => {
      const passwords = new Set()

      for (let i = 0; i < 100; i++) {
        passwords.add(generateSecurePassword())
      }

      // All 100 passwords should be unique
      expect(passwords.size).toBe(100)
    })

    it('should include variety of characters', () => {
      const password = generateSecurePassword(20)

      expect(/[a-z]/.test(password)).toBe(true)
      expect(/[A-Z]/.test(password)).toBe(true)
      expect(/[0-9]/.test(password)).toBe(true)
      expect(/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)).toBe(true)
    })
  })
})
