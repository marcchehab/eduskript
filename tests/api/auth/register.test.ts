import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/register/route'
import { NextRequest } from 'next/server'

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    verificationToken: {
      create: vi.fn(),
    },
  },
}))

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(),
  },
}))

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(),
  generateVerificationEmailContent: vi.fn(() => ({
    htmlContent: '<p>Verify your email</p>',
    textContent: 'Verify your email',
  })),
}))

vi.mock('@/lib/markdown', () => ({
  generateSlug: vi.fn((text: string) => text.toLowerCase().replace(/\s+/g, '-')),
}))

import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { sendEmail } from '@/lib/email'

describe('API /auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createRequest = (body: any) => {
    return new NextRequest('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  describe('Input validation', () => {
    it('should reject request with missing name', async () => {
      const request = createRequest({
        email: 'test@example.com',
        password: 'password123',
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('required')
    })

    it('should reject request with missing email', async () => {
      const request = createRequest({
        name: 'Test User',
        password: 'password123',
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('required')
    })

    it('should reject request with missing password', async () => {
      const request = createRequest({
        name: 'Test User',
        email: 'test@example.com',
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('required')
    })

    it('should accept request without subdomain (optional)', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never)
      vi.mocked(prisma.user.create).mockResolvedValue({
        id: 'user-123',
        name: 'Test User',
        email: 'test@example.com',
        emailVerified: null,
        subdomain: null,
      } as any)
      vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as any)

      const request = createRequest({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
    })
  })

  describe('Duplicate user detection', () => {
    it('should reject if email already exists', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'existing-user',
        email: 'test@example.com',
      } as any)

      const request = createRequest({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('already exists')
    })

    it('should check subdomain uniqueness if provided', async () => {
      vi.mocked(prisma.user.findUnique)
        .mockResolvedValueOnce(null) // Email check
        .mockResolvedValueOnce({     // Subdomain check
          id: 'user-with-subdomain',
          subdomain: 'testuser',
        } as any)

      const request = createRequest({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
        subdomain: 'testuser',
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('subdomain')
      expect(data.error).toContain('taken')
    })
  })

  describe('Password hashing', () => {
    it('should hash password with bcrypt cost factor 12', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never)
      vi.mocked(prisma.user.create).mockResolvedValue({
        id: 'user-123',
        name: 'Test User',
        email: 'test@example.com',
        emailVerified: null,
        hashedPassword: 'hashed-password',
      } as any)
      vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as any)

      const request = createRequest({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      })

      await POST(request)

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 12)
    })

    // Security test: Ensure different passwords produce different hashes
    it('should produce different hashes for different passwords', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

      const hashes: string[] = []
      vi.mocked(bcrypt.hash).mockImplementation((password: string) => {
        const hash = `hashed-${password}`
        hashes.push(hash)
        return Promise.resolve(hash as never)
      })

      vi.mocked(prisma.user.create).mockResolvedValue({
        id: 'user-123',
        name: 'Test User',
        email: 'test@example.com',
      } as any)
      vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as any)

      const request1 = createRequest({
        name: 'User 1',
        email: 'user1@example.com',
        password: 'password1',
      })

      const request2 = createRequest({
        name: 'User 2',
        email: 'user2@example.com',
        password: 'password2',
      })

      await POST(request1)
      await POST(request2)

      expect(hashes[0]).not.toBe(hashes[1])
    })
  })

  describe('User creation', () => {
    it('should create user with correct data', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never)
      vi.mocked(prisma.user.create).mockResolvedValue({
        id: 'user-123',
        name: 'Test User',
        email: 'test@example.com',
        emailVerified: null,
        hashedPassword: 'hashed-password',
        subdomain: null,
      } as any)
      vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as any)

      const request = createRequest({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      })

      await POST(request)

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          name: 'Test User',
          email: 'test@example.com',
          hashedPassword: 'hashed-password',
          subdomain: null,
          emailVerified: null,
        },
      })
    })

    it('should create user with subdomain if provided', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never)
      vi.mocked(prisma.user.create).mockResolvedValue({
        id: 'user-123',
        name: 'Test User',
        email: 'test@example.com',
        emailVerified: null,
        subdomain: 'testuser',
      } as any)
      vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as any)

      const request = createRequest({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
        subdomain: 'TestUser', // Should be normalized
      })

      await POST(request)

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subdomain: 'testuser',
        }),
      })
    })

    it('should set emailVerified to null explicitly', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never)
      vi.mocked(prisma.user.create).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        emailVerified: null,
      } as any)
      vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as any)

      const request = createRequest({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      })

      await POST(request)

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          emailVerified: null,
        }),
      })
    })
  })

  describe('Email verification', () => {
    it('should create verification token', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never)
      vi.mocked(prisma.user.create).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        emailVerified: null,
      } as any)
      vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as any)

      const request = createRequest({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      })

      await POST(request)

      expect(prisma.verificationToken.create).toHaveBeenCalledWith({
        data: {
          identifier: 'test@example.com',
          token: expect.any(String),
          expires: expect.any(Date),
        },
      })

      const tokenCall = vi.mocked(prisma.verificationToken.create).mock.calls[0][0]
      const expiresDate = tokenCall.data.expires as Date
      const now = new Date()
      const hoursDiff = (expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60)

      expect(hoursDiff).toBeGreaterThan(23) // ~24 hours
      expect(hoursDiff).toBeLessThan(25)
    })

    it('should generate cryptographically random token', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never)
      vi.mocked(prisma.user.create).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
      } as any)

      const tokens: string[] = []
      vi.mocked(prisma.verificationToken.create).mockImplementation((args) => {
        tokens.push(args.data.token as string)
        return Promise.resolve({} as any)
      })

      for (let i = 0; i < 10; i++) {
        const request = createRequest({
          name: `User ${i}`,
          email: `user${i}@example.com`,
          password: 'password123',
        })
        await POST(request)
      }

      // All tokens should be unique
      const uniqueTokens = new Set(tokens)
      expect(uniqueTokens.size).toBe(10)

      // Tokens should be hex strings
      tokens.forEach(token => {
        expect(token).toMatch(/^[a-f0-9]+$/)
        expect(token.length).toBeGreaterThan(32) // 32 bytes = 64 hex chars
      })
    })

    it('should send verification email', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never)
      vi.mocked(prisma.user.create).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
      } as any)
      vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as any)

      const request = createRequest({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      })

      await POST(request)

      expect(sendEmail).toHaveBeenCalledWith({
        to: 'test@example.com',
        subject: expect.stringContaining('Verify'),
        htmlContent: expect.any(String),
        textContent: expect.any(String),
      })
    })

    it('should not fail registration if email sending fails', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never)
      vi.mocked(prisma.user.create).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
      } as any)
      vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as any)
      vi.mocked(sendEmail).mockRejectedValue(new Error('Email service down'))

      const request = createRequest({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      })

      const response = await POST(request)

      expect(response.status).toBe(200) // Should still succeed
    })
  })

  describe('Response format', () => {
    it('should return success response with user data (no password)', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never)
      vi.mocked(prisma.user.create).mockResolvedValue({
        id: 'user-123',
        name: 'Test User',
        email: 'test@example.com',
        emailVerified: null,
        subdomain: 'testuser',
        hashedPassword: 'hashed-password',
      } as any)
      vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as any)

      const request = createRequest({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
        subdomain: 'testuser',
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        message: expect.stringContaining('verify'),
        user: {
          id: 'user-123',
          name: 'Test User',
          email: 'test@example.com',
          subdomain: 'testuser',
          emailVerified: null,
        },
        requiresEmailVerification: true,
      })

      // Ensure password is not in response
      expect(data.user.hashedPassword).toBeUndefined()
      expect(data.user.password).toBeUndefined()
    })
  })

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('Database error'))

      const request = createRequest({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
    })

    it('should handle malformed JSON', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json{',
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
    })
  })

  describe('Security tests', () => {
    it('should not expose database errors to client', async () => {
      vi.mocked(prisma.user.findUnique).mockRejectedValue(
        new Error('SQLITE_ERROR: table users does not exist')
      )

      const request = createRequest({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      })

      const response = await POST(request)
      const data = await response.json()

      expect(data.error).toBe('Internal server error')
      expect(data.error).not.toContain('SQLITE')
      expect(data.error).not.toContain('table')
    })

    // Security: Test for SQL injection attempts (should be prevented by Prisma)
    it('should safely handle SQL injection attempts in email', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never)
      vi.mocked(prisma.user.create).mockResolvedValue({
        id: 'user-123',
        email: "test'; DROP TABLE users; --",
      } as any)
      vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as any)

      const request = createRequest({
        name: 'Test User',
        email: "test'; DROP TABLE users; --",
        password: 'password123',
      })

      const response = await POST(request)

      // Should handle safely (Prisma prevents SQL injection)
      expect(response.status).toBeLessThan(500)
    })

    // Security: Test for XSS in name field
    it('should store XSS attempts verbatim (sanitization should happen on output)', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never)
      vi.mocked(prisma.user.create).mockResolvedValue({
        id: 'user-123',
        name: '<script>alert("xss")</script>',
        email: 'test@example.com',
      } as any)
      vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as any)

      const request = createRequest({
        name: '<script>alert("xss")</script>',
        email: 'test@example.com',
        password: 'password123',
      })

      await POST(request)

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: '<script>alert("xss")</script>',
        }),
      })
    })
  })
})
