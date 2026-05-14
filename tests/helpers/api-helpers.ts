/**
 * API Testing Helpers
 *
 * Utilities for testing Next.js API routes with authentication and database
 */

import { vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Session } from 'next-auth'

/**
 * Creates a mock NextRequest for testing API routes
 */
export function createMockRequest(
  url: string,
  options: {
    method?: string
    body?: any
    headers?: Record<string, string>
    searchParams?: Record<string, string>
  } = {}
): NextRequest {
  const { method = 'GET', body, headers = {}, searchParams = {} } = options

  // Build URL with search params
  const urlObj = new URL(url, 'http://localhost:3000')
  Object.entries(searchParams).forEach(([key, value]) => {
    urlObj.searchParams.set(key, value)
  })

  const requestInit: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  }

  if (body && method !== 'GET' && method !== 'HEAD') {
    requestInit.body = JSON.stringify(body)
  }

  return new NextRequest(urlObj.toString(), requestInit)
}

/**
 * Creates a mock session for authenticated requests
 */
export function createMockSession(userId: string, overrides: Partial<Session> = {}): Session {
  return {
    user: {
      id: userId,
      email: `user-${userId}@example.com`,
      name: `User ${userId}`,
      title: 'Teacher',
      isAdmin: false,
      requirePasswordReset: false,
      ...overrides.user,
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  }
}

/**
 * Extracts JSON from NextResponse for testing
 */
export async function getResponseJSON(response: Response) {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Creates mock params for dynamic routes (e.g., [id])
 */
export function createMockParams<T extends Record<string, string>>(params: T): Promise<T> {
  return Promise.resolve(params)
}
