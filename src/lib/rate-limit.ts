/**
 * Rate Limiting
 *
 * Implements in-memory rate limiting to prevent brute force attacks,
 * DoS attacks, and API abuse.
 *
 * For production with multiple servers, consider using Redis or a
 * distributed rate limiting service.
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

interface RateLimitStore {
  [key: string]: RateLimitEntry
}

const store: RateLimitStore = {}

// Clean up expired entries every minute
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    let cleaned = 0

    Object.keys(store).forEach(key => {
      if (store[key].resetAt < now) {
        delete store[key]
        cleaned++
      }
    })

    if (cleaned > 0) {
      console.log(`[RateLimit] Cleaned up ${cleaned} expired entries`)
    }
  }, 60000)
}

export interface RateLimitOptions {
  interval: number // Time window in milliseconds
  maxRequests: number // Maximum requests allowed in the interval
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
  retryAfter?: number // Seconds until reset (only when !allowed)
}

export class RateLimiter {
  private options: RateLimitOptions
  private name: string

  constructor(name: string, options: RateLimitOptions) {
    this.name = name
    this.options = options
  }

  /**
   * Checks if a request is allowed under the rate limit
   * @param identifier - Unique identifier (usually IP address)
   * @returns Rate limit result
   */
  check(identifier: string): RateLimitResult {
    const now = Date.now()
    const key = `${this.name}:${identifier}`

    // If no entry exists or it's expired, create a new one
    if (!store[key] || store[key].resetAt < now) {
      store[key] = {
        count: 1,
        resetAt: now + this.options.interval
      }

      return {
        allowed: true,
        remaining: this.options.maxRequests - 1,
        resetAt: store[key].resetAt
      }
    }

    // Check if limit is exceeded
    if (store[key].count >= this.options.maxRequests) {
      const retryAfter = Math.ceil((store[key].resetAt - now) / 1000)

      return {
        allowed: false,
        remaining: 0,
        resetAt: store[key].resetAt,
        retryAfter
      }
    }

    // Increment counter
    store[key].count++

    return {
      allowed: true,
      remaining: this.options.maxRequests - store[key].count,
      resetAt: store[key].resetAt
    }
  }

  /**
   * Resets the rate limit for an identifier (use carefully!)
   * @param identifier - Unique identifier to reset
   */
  reset(identifier: string): void {
    const key = `${this.name}:${identifier}`
    delete store[key]
    console.log(`[RateLimit] Reset limit for ${this.name}:${identifier}`)
  }
}

// Pre-configured rate limiters for common use cases

/**
 * Login rate limiter: 5 attempts per 15 minutes
 * Prevents brute force password attacks
 */
export const loginRateLimiter = new RateLimiter('login', {
  interval: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5
})

/**
 * Registration rate limiter: 3 attempts per hour
 * Prevents mass account creation
 */
export const registrationRateLimiter = new RateLimiter('registration', {
  interval: 60 * 60 * 1000, // 1 hour
  maxRequests: 3
})

/**
 * Email verification rate limiter: 5 attempts per hour
 * Prevents email verification abuse
 */
export const emailVerificationRateLimiter = new RateLimiter('email-verification', {
  interval: 60 * 60 * 1000, // 1 hour
  maxRequests: 5
})

/**
 * Invite code rate limiter: 10 attempts per minute
 * Prevents invite code enumeration
 */
export const inviteCodeRateLimiter = new RateLimiter('invite-code', {
  interval: 60 * 1000, // 1 minute
  maxRequests: 10
})

/**
 * Student verification rate limiter: 20 verifications per minute per teacher
 * Prevents abuse of the verification endpoint
 */
export const studentVerificationRateLimiter = new RateLimiter('student-verification', {
  interval: 60 * 1000, // 1 minute
  maxRequests: 20
})

/**
 * General API rate limiter: 60 requests per minute
 * Global rate limit for all authenticated API endpoints
 */
export const apiRateLimiter = new RateLimiter('api', {
  interval: 60 * 1000, // 1 minute
  maxRequests: 60
})

/**
 * Bulk import rate limiter: 5 imports per hour
 * Prevents abuse of bulk student import
 */
export const bulkImportRateLimiter = new RateLimiter('bulk-import', {
  interval: 60 * 60 * 1000, // 1 hour
  maxRequests: 5
})

/**
 * Extracts client identifier from request headers
 * Tries multiple headers to get the real IP address
 * @param request - The incoming request
 * @returns Client identifier (IP address or 'unknown')
 */
export function getClientIdentifier(request: Request): string {
  // Try to get real IP from various headers (in order of precedence)
  const forwarded = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const cfIp = request.headers.get('cf-connecting-ip') // Cloudflare
  const flyIp = request.headers.get('fly-client-ip') // Fly.io

  // x-forwarded-for can contain multiple IPs, take the first one
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }

  return realIp || cfIp || flyIp || 'unknown'
}

/**
 * Gets the current size of the rate limit store (for monitoring)
 */
export function getRateLimitStoreSize(): number {
  return Object.keys(store).size
}

/**
 * Clears all rate limits (for testing only!)
 */
export function clearAllRateLimits(): void {
  const size = Object.keys(store).length
  Object.keys(store).forEach(key => delete store[key])
  console.log(`[RateLimit] Cleared all rate limits (${size} entries)`)
}
