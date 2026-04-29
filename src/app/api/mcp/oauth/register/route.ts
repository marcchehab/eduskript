/**
 * RFC 7591 — Dynamic Client Registration.
 *
 * MCP clients (claude.ai, Claude Code, Cursor, etc.) register themselves here
 * and get a `client_id` back. By design this endpoint is open — any caller can register.
 * Defended by mcpRegistrationRateLimiter (10/h per IP).
 */

import { NextRequest, NextResponse } from 'next/server'
import { registerClient } from '@/lib/mcp/client-registry'
import {
  getClientIdentifier,
  mcpRegistrationRateLimiter,
} from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const ip = getClientIdentifier(request)
  const limit = mcpRegistrationRateLimiter.check(ip)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', error_description: 'Too many registrations from this IP' },
      {
        status: 429,
        headers: limit.retryAfter
          ? { 'Retry-After': String(limit.retryAfter) }
          : undefined,
      }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_client_metadata', error_description: 'Body must be valid JSON' },
      { status: 400 }
    )
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'invalid_client_metadata' },
      { status: 400 }
    )
  }

  const {
    client_name,
    redirect_uris,
    token_endpoint_auth_method,
  } = body as Record<string, unknown>

  if (typeof client_name !== 'string' || !Array.isArray(redirect_uris)) {
    return NextResponse.json(
      {
        error: 'invalid_client_metadata',
        error_description: 'client_name and redirect_uris are required',
      },
      { status: 400 }
    )
  }

  if (!redirect_uris.every((u) => typeof u === 'string')) {
    return NextResponse.json(
      { error: 'invalid_redirect_uri' },
      { status: 400 }
    )
  }

  // RFC 7591 §2: token_endpoint_auth_method may be 'none' (public PKCE-only)
  // or 'client_secret_post'. Default = 'none' for v1.
  const confidential = token_endpoint_auth_method === 'client_secret_post'

  try {
    const registered = await registerClient({
      name: client_name,
      redirectUris: redirect_uris as string[],
      confidential,
    })

    return NextResponse.json(
      {
        client_id: registered.clientId,
        client_secret: registered.clientSecret ?? undefined,
        client_name: registered.name,
        redirect_uris: registered.redirectUris,
        grant_types: registered.grantTypes,
        scope: registered.scopes.join(' '),
        token_endpoint_auth_method: confidential ? 'client_secret_post' : 'none',
        client_id_issued_at: Math.floor(registered.createdAt.getTime() / 1000),
      },
      { status: 201 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    return NextResponse.json(
      { error: 'invalid_client_metadata', error_description: message },
      { status: 400 }
    )
  }
}
