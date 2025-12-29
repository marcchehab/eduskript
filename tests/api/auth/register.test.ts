import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

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
      create: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
    organizationMember: {
      create: vi.fn(),
    },
    verificationToken: {
      create: vi.fn(),
    },
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  registrationRateLimiter: {
    check: vi.fn(() => ({ allowed: true, remaining: 5 })),
  },
  getClientIdentifier: vi.fn(() => 'test-client'),
}))

vi.mock('@/lib/password-validation', () => ({
  validatePassword: vi.fn(() => ({ valid: true, strength: 'strong', errors: [] })),
}))

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(() => Promise.resolve()),
  generateVerificationEmailContent: vi.fn(() => ({
    htmlContent: '<p>Verify</p>',
    textContent: 'Verify',
  })),
}))

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(() => Promise.resolve('hashed-password')),
  },
}))

import { POST } from '@/app/api/auth/register/route'
import { prisma } from '@/lib/prisma'
import { registrationRateLimiter } from '@/lib/rate-limit'
import { validatePassword } from '@/lib/password-validation'

function createRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Registration API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mocks - rate limiter allows by default
    vi.mocked(registrationRateLimiter.check).mockReturnValue({
      allowed: true,
      remaining: 5,
      resetAt: Date.now() + 3600000,
    })
    vi.mocked(validatePassword).mockReturnValue({
      valid: true,
      strength: 'strong',
      errors: [],
    })
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null)
  })

  describe('POST /api/auth/register', () => {
    describe('Rate Limiting', () => {
      it('should return 429 when rate limit exceeded', async () => {
        vi.mocked(registrationRateLimiter.check).mockReturnValue({
          allowed: false,
          remaining: 0,
          retryAfter: 3600,
          resetAt: Date.now() + 3600000,
        })

        const request = createRequest({
          name: 'Test User',
          email: 'test@example.com',
          password: 'SecurePass123!',
        })

        const response = await POST(request)

        expect(response.status).toBe(429)
        const data = await response.json()
        expect(data.error).toContain('Too many registration attempts')
        expect(data.retryAfter).toBe(3600)
      })

      it('should include rate limit headers when blocked', async () => {
        vi.mocked(registrationRateLimiter.check).mockReturnValue({
          allowed: false,
          remaining: 0,
          retryAfter: 3600,
          resetAt: Date.now() + 3600000,
        })

        const request = createRequest({
          name: 'Test User',
          email: 'test@example.com',
          password: 'SecurePass123!',
        })

        const response = await POST(request)

        expect(response.headers.get('Retry-After')).toBe('3600')
        expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
      })
    })

    describe('Input Validation', () => {
      it('should return 400 when name is missing', async () => {
        const request = createRequest({
          email: 'test@example.com',
          password: 'SecurePass123!',
        })

        const response = await POST(request)

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toBe('Name, email, and password are required')
      })

      it('should return 400 when email is missing', async () => {
        const request = createRequest({
          name: 'Test User',
          password: 'SecurePass123!',
        })

        const response = await POST(request)

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toBe('Name, email, and password are required')
      })

      it('should return 400 when password is missing', async () => {
        const request = createRequest({
          name: 'Test User',
          email: 'test@example.com',
        })

        const response = await POST(request)

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toBe('Name, email, and password are required')
      })

      it('should return 400 when password is weak', async () => {
        vi.mocked(validatePassword).mockReturnValue({
          valid: false,
          strength: 'weak',
          errors: ['Password must be at least 8 characters'],
        })

        const request = createRequest({
          name: 'Test User',
          email: 'test@example.com',
          password: 'weak',
        })

        const response = await POST(request)

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toBe('Password does not meet security requirements')
        expect(data.details).toContain('Password must be at least 8 characters')
      })
    })

    describe('Email Enumeration Prevention', () => {
      it('should return success-like response for existing email', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
          id: 'existing-user',
          email: 'test@example.com',
        } as never)

        const request = createRequest({
          name: 'Test User',
          email: 'test@example.com',
          password: 'SecurePass123!',
        })

        const response = await POST(request)

        // Should return 200, not 400/409, to prevent email enumeration
        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.message).toContain('If this email is not already registered')
        expect(data.requiresEmailVerification).toBe(true)
      })
    })

    describe('Page Slug Handling', () => {
      it('should return 400 when requested pageSlug is taken', async () => {
        // First call: check email (not found)
        // Second call: check pageSlug (found - taken)
        vi.mocked(prisma.user.findUnique)
          .mockResolvedValueOnce(null) // email check
          .mockResolvedValueOnce({ id: 'other-user', pageSlug: 'taken-slug' } as never) // pageSlug check

        const request = createRequest({
          name: 'Test User',
          email: 'test@example.com',
          password: 'SecurePass123!',
          pageSlug: 'taken-slug',
        })

        const response = await POST(request)

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error).toBe('This page slug is already taken')
      })
    })

    describe('Successful Registration', () => {
      it('should create user and return success', async () => {
        const mockUser = {
          id: 'new-user-id',
          name: 'Test User',
          email: 'test@example.com',
          pageSlug: 'test-user',
          emailVerified: null,
        }

        vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
        vi.mocked(prisma.user.create).mockResolvedValue(mockUser as never)
        vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as never)

        const request = createRequest({
          name: 'Test User',
          email: 'test@example.com',
          password: 'SecurePass123!',
        })

        const response = await POST(request)

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.message).toContain('User created successfully')
        expect(data.user.id).toBe('new-user-id')
        expect(data.user.email).toBe('test@example.com')
        expect(data.requiresEmailVerification).toBe(true)
      })

      it('should hash password before storing', async () => {
        const bcrypt = await import('bcryptjs')

        vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
        vi.mocked(prisma.user.create).mockResolvedValue({
          id: 'new-user',
          name: 'Test',
          email: 'test@example.com',
          pageSlug: 'test',
          emailVerified: null,
        } as never)
        vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as never)

        const request = createRequest({
          name: 'Test',
          email: 'test@example.com',
          password: 'SecurePass123!',
        })

        await POST(request)

        expect(bcrypt.default.hash).toHaveBeenCalledWith('SecurePass123!', 12)
        expect(prisma.user.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              hashedPassword: 'hashed-password',
            }),
          })
        )
      })

      it('should auto-assign user to default organization if exists', async () => {
        const mockOrg = { id: 'default-org', slug: 'eduskript' }

        vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
        vi.mocked(prisma.user.create).mockResolvedValue({
          id: 'new-user',
          name: 'Test',
          email: 'test@example.com',
          pageSlug: 'test',
          emailVerified: null,
        } as never)
        vi.mocked(prisma.organization.findUnique).mockResolvedValue(mockOrg as never)
        vi.mocked(prisma.organizationMember.create).mockResolvedValue({} as never)
        vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as never)

        const request = createRequest({
          name: 'Test',
          email: 'test@example.com',
          password: 'SecurePass123!',
        })

        await POST(request)

        expect(prisma.organizationMember.create).toHaveBeenCalledWith({
          data: {
            organizationId: 'default-org',
            userId: 'new-user',
            role: 'member',
          },
        })
      })

      it('should create verification token', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
        vi.mocked(prisma.user.create).mockResolvedValue({
          id: 'new-user',
          name: 'Test',
          email: 'test@example.com',
          pageSlug: 'test',
          emailVerified: null,
        } as never)
        vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as never)

        const request = createRequest({
          name: 'Test',
          email: 'test@example.com',
          password: 'SecurePass123!',
        })

        await POST(request)

        expect(prisma.verificationToken.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            identifier: 'test@example.com',
            token: expect.any(String),
            expires: expect.any(Date),
          }),
        })
      })
    })

    describe('Error Handling', () => {
      it('should return 500 on database error', async () => {
        vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('Database error'))

        const request = createRequest({
          name: 'Test User',
          email: 'test@example.com',
          password: 'SecurePass123!',
        })

        const response = await POST(request)

        expect(response.status).toBe(500)
        const data = await response.json()
        expect(data.error).toBe('Internal server error')
      })

      it('should still succeed if email sending fails', async () => {
        const { sendEmail } = await import('@/lib/email')

        vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
        vi.mocked(prisma.user.create).mockResolvedValue({
          id: 'new-user',
          name: 'Test',
          email: 'test@example.com',
          pageSlug: 'test',
          emailVerified: null,
        } as never)
        vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as never)
        vi.mocked(sendEmail).mockRejectedValue(new Error('SMTP error'))

        const request = createRequest({
          name: 'Test',
          email: 'test@example.com',
          password: 'SecurePass123!',
        })

        const response = await POST(request)

        // Should still succeed - user can request email resend
        expect(response.status).toBe(200)
      })
    })
  })
})
