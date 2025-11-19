import { describe, it, expect, beforeEach } from 'vitest'
import {
  RateLimiter,
  clearAllRateLimits,
  getClientIdentifier,
  loginRateLimiter,
  registrationRateLimiter,
} from '@/lib/rate-limit'

describe('lib/rate-limit', () => {
  beforeEach(() => {
    // Clear all rate limits before each test
    clearAllRateLimits()
  })

  describe('RateLimiter', () => {
    it('should allow requests within the limit', () => {
      const limiter = new RateLimiter('test', {
        interval: 60000, // 1 minute
        maxRequests: 5
      })

      for (let i = 0; i < 5; i++) {
        const result = limiter.check('test-user')
        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(4 - i)
      }
    })

    it('should block requests over the limit', () => {
      const limiter = new RateLimiter('test', {
        interval: 60000,
        maxRequests: 3
      })

      // Make 3 allowed requests
      for (let i = 0; i < 3; i++) {
        expect(limiter.check('test-user').allowed).toBe(true)
      }

      // 4th request should be blocked
      const result = limiter.check('test-user')
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.retryAfter).toBeDefined()
    })

    it('should track different identifiers separately', () => {
      const limiter = new RateLimiter('test', {
        interval: 60000,
        maxRequests: 2
      })

      limiter.check('user-1')
      limiter.check('user-1')
      limiter.check('user-2')

      // user-1 should be blocked
      expect(limiter.check('user-1').allowed).toBe(false)

      // user-2 should still be allowed
      expect(limiter.check('user-2').allowed).toBe(true)
    })

    it('should reset after interval expires', () => {
      const limiter = new RateLimiter('test', {
        interval: 100, // 100ms for testing
        maxRequests: 2
      })

      // Use up the limit
      limiter.check('test-user')
      limiter.check('test-user')

      // Should be blocked
      expect(limiter.check('test-user').allowed).toBe(false)

      // Wait for interval to pass
      return new Promise(resolve => {
        setTimeout(() => {
          // Should be allowed again
          expect(limiter.check('test-user').allowed).toBe(true)
          resolve(undefined)
        }, 150)
      })
    })

    it('should provide correct remaining count', () => {
      const limiter = new RateLimiter('test', {
        interval: 60000,
        maxRequests: 5
      })

      expect(limiter.check('user').remaining).toBe(4)
      expect(limiter.check('user').remaining).toBe(3)
      expect(limiter.check('user').remaining).toBe(2)
      expect(limiter.check('user').remaining).toBe(1)
      expect(limiter.check('user').remaining).toBe(0)
      expect(limiter.check('user').remaining).toBe(0)
    })

    it('should provide resetAt timestamp', () => {
      const limiter = new RateLimiter('test', {
        interval: 60000,
        maxRequests: 5
      })

      const now = Date.now()
      const result = limiter.check('user')

      expect(result.resetAt).toBeGreaterThan(now)
      expect(result.resetAt).toBeLessThanOrEqual(now + 60000)
    })

    it('should provide retryAfter in seconds when blocked', () => {
      const limiter = new RateLimiter('test', {
        interval: 60000,
        maxRequests: 1
      })

      limiter.check('user') // Use up the limit

      const result = limiter.check('user')

      expect(result.retryAfter).toBeDefined()
      expect(result.retryAfter).toBeGreaterThan(0)
      expect(result.retryAfter).toBeLessThanOrEqual(60)
    })

    it('should reset manually', () => {
      const limiter = new RateLimiter('test', {
        interval: 60000,
        maxRequests: 1
      })

      limiter.check('user')

      // Should be blocked
      expect(limiter.check('user').allowed).toBe(false)

      // Reset manually
      limiter.reset('user')

      // Should be allowed again
      expect(limiter.check('user').allowed).toBe(true)
    })
  })

  describe('Pre-configured limiters', () => {
    it('loginRateLimiter should have correct settings', () => {
      clearAllRateLimits()

      // Should allow 5 requests
      for (let i = 0; i < 5; i++) {
        expect(loginRateLimiter.check('test').allowed).toBe(true)
      }

      // 6th should be blocked
      expect(loginRateLimiter.check('test').allowed).toBe(false)
    })

    it('registrationRateLimiter should have stricter limits', () => {
      clearAllRateLimits()

      // Should allow 3 requests
      for (let i = 0; i < 3; i++) {
        expect(registrationRateLimiter.check('test').allowed).toBe(true)
      }

      // 4th should be blocked
      expect(registrationRateLimiter.check('test').allowed).toBe(false)
    })
  })

  describe('getClientIdentifier', () => {
    it('should extract IP from x-forwarded-for header', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '192.168.1.1, 10.0.0.1'
        }
      })

      const identifier = getClientIdentifier(request)

      expect(identifier).toBe('192.168.1.1')
    })

    it('should extract IP from x-real-ip header', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-real-ip': '192.168.1.2'
        }
      })

      const identifier = getClientIdentifier(request)

      expect(identifier).toBe('192.168.1.2')
    })

    it('should prioritize x-forwarded-for over x-real-ip', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '192.168.1.1',
          'x-real-ip': '192.168.1.2'
        }
      })

      const identifier = getClientIdentifier(request)

      expect(identifier).toBe('192.168.1.1')
    })

    it('should extract IP from Cloudflare header', () => {
      const request = new Request('http://localhost', {
        headers: {
          'cf-connecting-ip': '192.168.1.3'
        }
      })

      const identifier = getClientIdentifier(request)

      expect(identifier).toBe('192.168.1.3')
    })

    it('should return "unknown" if no IP headers present', () => {
      const request = new Request('http://localhost')

      const identifier = getClientIdentifier(request)

      expect(identifier).toBe('unknown')
    })

    it('should trim whitespace from forwarded IP', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '  192.168.1.1  , 10.0.0.1'
        }
      })

      const identifier = getClientIdentifier(request)

      expect(identifier).toBe('192.168.1.1')
    })
  })

  describe('Security tests', () => {
    it('should prevent brute force attacks', () => {
      const limiter = new RateLimiter('brute-force-test', {
        interval: 60000,
        maxRequests: 5
      })

      let allowedRequests = 0
      let blockedRequests = 0

      // Simulate 100 rapid requests
      for (let i = 0; i < 100; i++) {
        const result = limiter.check('attacker')
        if (result.allowed) {
          allowedRequests++
        } else {
          blockedRequests++
        }
      }

      expect(allowedRequests).toBe(5)
      expect(blockedRequests).toBe(95)
    })

    it('should isolate different users', () => {
      const limiter = new RateLimiter('isolation-test', {
        interval: 60000,
        maxRequests: 1
      })

      // User 1 uses their limit
      expect(limiter.check('user-1').allowed).toBe(true)
      expect(limiter.check('user-1').allowed).toBe(false)

      // User 2 should not be affected
      expect(limiter.check('user-2').allowed).toBe(true)
      expect(limiter.check('user-2').allowed).toBe(false)

      // User 3 should not be affected
      expect(limiter.check('user-3').allowed).toBe(true)
    })

    it('should handle rapid concurrent requests', () => {
      const limiter = new RateLimiter('concurrent-test', {
        interval: 60000,
        maxRequests: 10
      })

      const results: boolean[] = []

      // Simulate concurrent requests
      for (let i = 0; i < 20; i++) {
        results.push(limiter.check('user').allowed)
      }

      const allowed = results.filter(r => r).length
      const blocked = results.filter(r => !r).length

      expect(allowed).toBe(10)
      expect(blocked).toBe(10)
    })
  })

  describe('Edge cases', () => {
    it('should handle very short intervals', () => {
      const limiter = new RateLimiter('short-interval', {
        interval: 1, // 1ms
        maxRequests: 2
      })

      limiter.check('user')
      limiter.check('user')

      expect(limiter.check('user').allowed).toBe(false)

      // Wait for reset
      return new Promise(resolve => {
        setTimeout(() => {
          expect(limiter.check('user').allowed).toBe(true)
          resolve(undefined)
        }, 10)
      })
    })

    it('should handle long identifier strings', () => {
      const limiter = new RateLimiter('long-id-test', {
        interval: 60000,
        maxRequests: 2
      })

      const longId = 'x'.repeat(1000)

      expect(limiter.check(longId).allowed).toBe(true)
      expect(limiter.check(longId).allowed).toBe(true)
      expect(limiter.check(longId).allowed).toBe(false)
    })

    it('should handle special characters in identifiers', () => {
      const limiter = new RateLimiter('special-char-test', {
        interval: 60000,
        maxRequests: 2
      })

      const specialId = 'user@example.com:192.168.1.1'

      expect(limiter.check(specialId).allowed).toBe(true)
      expect(limiter.check(specialId).allowed).toBe(true)
      expect(limiter.check(specialId).allowed).toBe(false)
    })
  })
})
