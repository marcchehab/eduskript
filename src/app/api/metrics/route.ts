/**
 * Client Metrics API
 *
 * POST /api/metrics - Record a metric from client-side code
 *
 * Body: { name: string, value: number }
 *
 * Security:
 * - Rate limited to 60 requests per minute per IP
 * - Metric name must be in registry with source: "client"
 * - Value must be finite number between 0 and 1,000,000
 */

import { NextRequest, NextResponse } from 'next/server'
import { RateLimiter } from '@/lib/rate-limit'
import { recordMetric } from '@/lib/metrics/buffer'
import { isValidMetricName, type MetricName } from '@/lib/metrics/registry'

// Rate limit: 60 metrics per minute per IP
const rateLimiter = new RateLimiter('metrics', {
  interval: 60 * 1000,
  maxRequests: 60,
})

// Value bounds
const MIN_VALUE = 0
const MAX_VALUE = 1_000_000

export async function POST(request: NextRequest) {
  // Get client IP for rate limiting
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown'

  // Check rate limit
  const rateResult = rateLimiter.check(ip)
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter: rateResult.retryAfter },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateResult.retryAfter ?? 60),
        },
      }
    )
  }

  // Parse body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  // Validate structure
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      { error: 'Body must be an object' },
      { status: 400 }
    )
  }

  const { name, value } = body as Record<string, unknown>

  // Validate metric name
  if (typeof name !== 'string') {
    return NextResponse.json(
      { error: 'name must be a string' },
      { status: 400 }
    )
  }

  if (!isValidMetricName(name)) {
    return NextResponse.json(
      { error: `Unknown metric: ${name}` },
      { status: 400 }
    )
  }

  // Validate value
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return NextResponse.json(
      { error: 'value must be a finite number' },
      { status: 400 }
    )
  }

  if (value < MIN_VALUE || value > MAX_VALUE) {
    return NextResponse.json(
      { error: `value must be between ${MIN_VALUE} and ${MAX_VALUE}` },
      { status: 400 }
    )
  }

  // Record the metric
  recordMetric(name as MetricName, value)

  return NextResponse.json({ success: true })
}

// GET endpoint to retrieve recent metrics (for admin panel)
export async function GET(request: NextRequest) {
  // This endpoint requires authentication - check in middleware or here
  // For now, just return in-memory data
  const { getRecentMinutes } = await import('@/lib/metrics/buffer')

  const minutes = getRecentMinutes()

  return NextResponse.json({
    minutes: minutes.map(m => ({
      timestamp: m.timestamp.toISOString(),
      data: m.data,
    })),
  })
}
