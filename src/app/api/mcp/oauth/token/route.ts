/**
 * RFC 6749 §4.1.3 + §6 — Token endpoint.
 *
 * Two grant types in v1:
 *   - authorization_code (with PKCE) — exchanges a code for the first token pair
 *   - refresh_token — rotates the pair (old refresh becomes single-use marker
 *     in the audit chain via replacedById)
 *
 * Auth: public clients send PKCE only. Confidential clients send client_secret.
 * Per-client_id rate limit is enforced before any DB work.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  consumeAuthorizationCode,
} from '@/lib/mcp/oauth-codes'
import {
  ACCESS_TOKEN_TTL,
  consumeRefreshToken,
  issueTokenPair,
  markRefreshReplaced,
} from '@/lib/mcp/tokens'
import {
  lookupClient,
  verifyClientSecret,
} from '@/lib/mcp/client-registry'
import { mcpTokenRateLimiter } from '@/lib/rate-limit'

function tokenError(error: string, description?: string, status = 400) {
  return NextResponse.json(
    { error, error_description: description },
    { status }
  )
}

function tokenSuccess(args: {
  accessToken: string
  refreshToken: string
  scopes: string[]
}) {
  return NextResponse.json(
    {
      access_token: args.accessToken,
      refresh_token: args.refreshToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      scope: args.scopes.join(' '),
    },
    {
      status: 200,
      headers: {
        // Tokens are sensitive — disable any caching.
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    }
  )
}

async function readForm(request: NextRequest) {
  // RFC 6749 §3.2 — the token endpoint MUST accept x-www-form-urlencoded.
  const ct = request.headers.get('content-type') || ''
  if (ct.includes('application/x-www-form-urlencoded')) {
    return await request.formData()
  }
  if (ct.includes('application/json')) {
    const json = await request.json()
    const fd = new FormData()
    for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
      if (v != null) fd.set(k, String(v))
    }
    return fd
  }
  return await request.formData()
}

export async function POST(request: NextRequest) {
  let form: FormData
  try {
    form = await readForm(request)
  } catch {
    return tokenError('invalid_request', 'Body could not be parsed')
  }

  const grantType = String(form.get('grant_type') || '')
  const clientId = String(form.get('client_id') || '')
  const presentedSecret = form.get('client_secret')
    ? String(form.get('client_secret'))
    : null

  if (!clientId) return tokenError('invalid_client', 'client_id required')

  const limit = mcpTokenRateLimiter.check(clientId)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: limit.retryAfter
          ? { 'Retry-After': String(limit.retryAfter) }
          : undefined,
      }
    )
  }

  const client = await lookupClient(clientId)
  if (!client) return tokenError('invalid_client', 'Unknown client_id', 401)

  if (!verifyClientSecret(client, presentedSecret)) {
    return tokenError('invalid_client', 'client_secret mismatch', 401)
  }

  if (grantType === 'authorization_code') {
    const code = String(form.get('code') || '')
    const redirectUri = String(form.get('redirect_uri') || '')
    const codeVerifier = String(form.get('code_verifier') || '')

    if (!code || !redirectUri || !codeVerifier) {
      return tokenError('invalid_request', 'code, redirect_uri, code_verifier required')
    }

    const consumed = await consumeAuthorizationCode({
      code,
      clientId,
      redirectUri,
      codeVerifier,
    })
    if (!consumed) return tokenError('invalid_grant', 'Code invalid or expired')

    const pair = await issueTokenPair({
      userId: consumed.userId,
      clientId,
      scopes: consumed.scopes,
    })

    return tokenSuccess({
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      scopes: consumed.scopes,
    })
  }

  if (grantType === 'refresh_token') {
    const refreshToken = String(form.get('refresh_token') || '')
    if (!refreshToken) return tokenError('invalid_request', 'refresh_token required')

    const consumed = await consumeRefreshToken(refreshToken)
    if (!consumed || consumed.clientId !== clientId) {
      return tokenError('invalid_grant', 'refresh_token invalid or expired')
    }

    const pair = await issueTokenPair({
      userId: consumed.userId,
      clientId,
      scopes: consumed.scopes,
    })
    await markRefreshReplaced(consumed.tokenId, pair.refreshTokenId)

    return tokenSuccess({
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      scopes: consumed.scopes,
    })
  }

  return tokenError('unsupported_grant_type')
}
