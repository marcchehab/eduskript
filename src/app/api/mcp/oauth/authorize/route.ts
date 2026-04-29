/**
 * RFC 6749 + RFC 7636 — Authorization endpoint with PKCE.
 *
 * GET: validates query params, requires a NextAuth session (redirects to login
 *      otherwise), and renders the consent screen.
 * POST: issues an authorization code (10-min, single-use) on Allow, or
 *       redirects with `?error=access_denied&state=...` on Deny.
 *
 * Open-redirect mitigation: redirect_uri MUST match a registered URI on the
 * client (strict equality via isRedirectUriAllowed). We only redirect to URIs
 * we control or that are on the allowlist — never to anything else, even on
 * error responses.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  isRedirectUriAllowed,
  lookupClient,
} from '@/lib/mcp/client-registry'
import { issueAuthorizationCode } from '@/lib/mcp/oauth-codes'
import { SUPPORTED_SCOPES } from '@/lib/mcp/metadata'

interface ParsedAuthorizeRequest {
  responseType: string
  clientId: string
  redirectUri: string
  scope: string
  state: string
  codeChallenge: string
  codeChallengeMethod: string
}

function parseQuery(searchParams: URLSearchParams): ParsedAuthorizeRequest {
  return {
    responseType: searchParams.get('response_type') || '',
    clientId: searchParams.get('client_id') || '',
    redirectUri: searchParams.get('redirect_uri') || '',
    scope: searchParams.get('scope') || 'content:read content:write',
    state: searchParams.get('state') || '',
    codeChallenge: searchParams.get('code_challenge') || '',
    codeChallengeMethod: searchParams.get('code_challenge_method') || '',
  }
}

function badRequest(reason: string, description?: string) {
  return NextResponse.json(
    { error: reason, error_description: description },
    { status: 400 }
  )
}

function redirectWithError(
  redirectUri: string,
  error: string,
  state: string,
  description?: string
) {
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  if (state) url.searchParams.set('state', state)
  if (description) url.searchParams.set('error_description', description)
  return NextResponse.redirect(url.toString(), 302)
}

async function loadAndValidateClient(parsed: ParsedAuthorizeRequest) {
  if (parsed.responseType !== 'code') {
    return { error: badRequest('unsupported_response_type') }
  }
  if (!parsed.clientId) return { error: badRequest('invalid_request', 'client_id required') }
  if (!parsed.redirectUri) {
    return { error: badRequest('invalid_request', 'redirect_uri required') }
  }
  if (parsed.codeChallengeMethod !== 'S256') {
    return { error: badRequest('invalid_request', 'code_challenge_method must be S256') }
  }
  if (!parsed.codeChallenge) {
    return { error: badRequest('invalid_request', 'code_challenge required') }
  }

  const client = await lookupClient(parsed.clientId)
  if (!client) return { error: badRequest('invalid_client', 'Unknown client_id') }
  if (!isRedirectUriAllowed(client, parsed.redirectUri)) {
    // Critical: do NOT redirect to an unregistered URI.
    return { error: badRequest('invalid_request', 'redirect_uri not registered') }
  }

  return { client }
}

function intersectScopes(requested: string): string[] {
  const requestedSet = new Set(requested.split(/\s+/).filter(Boolean))
  return [...SUPPORTED_SCOPES].filter((s) => requestedSet.has(s))
}

export async function GET(request: NextRequest) {
  const parsed = parseQuery(request.nextUrl.searchParams)
  const validation = await loadAndValidateClient(parsed)
  if ('error' in validation) return validation.error
  const { client } = validation

  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    // Send the user to login; preserve the full authorize URL as callbackUrl.
    const baseUrl = (process.env.NEXTAUTH_URL || request.nextUrl.origin).replace(/\/+$/, '')
    const loginUrl = new URL(`${baseUrl}/auth/signin`)
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.toString())
    return NextResponse.redirect(loginUrl.toString(), 302)
  }

  const scopes = intersectScopes(parsed.scope)
  if (scopes.length === 0) {
    return redirectWithError(
      parsed.redirectUri,
      'invalid_scope',
      parsed.state,
      'No supported scopes were requested'
    )
  }

  // Redirect to the consent page (Server Component). It re-validates everything
  // and renders the consent UI; the form there posts back to this same route.
  // Build from NEXTAUTH_URL — request.nextUrl.origin reads from the Host header,
  // which on the dev server behind a tunnel resolves to localhost:3000.
  const baseUrl = (process.env.NEXTAUTH_URL || request.nextUrl.origin).replace(/\/+$/, '')
  const consentUrl = new URL(`${baseUrl}/oauth/consent`)
  consentUrl.searchParams.set('client_id', parsed.clientId)
  consentUrl.searchParams.set('client_name', client.name)
  consentUrl.searchParams.set('redirect_uri', parsed.redirectUri)
  consentUrl.searchParams.set('response_type', parsed.responseType)
  consentUrl.searchParams.set('scope', scopes.join(' '))
  consentUrl.searchParams.set('state', parsed.state)
  consentUrl.searchParams.set('code_challenge', parsed.codeChallenge)
  consentUrl.searchParams.set('code_challenge_method', parsed.codeChallengeMethod)
  return NextResponse.redirect(consentUrl.toString(), 302)
}

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const parsed: ParsedAuthorizeRequest = {
    responseType: String(formData.get('response_type') || ''),
    clientId: String(formData.get('client_id') || ''),
    redirectUri: String(formData.get('redirect_uri') || ''),
    scope: String(formData.get('scope') || 'content:read content:write'),
    state: String(formData.get('state') || ''),
    codeChallenge: String(formData.get('code_challenge') || ''),
    codeChallengeMethod: String(formData.get('code_challenge_method') || ''),
  }
  const decision = String(formData.get('decision') || '')

  const validation = await loadAndValidateClient(parsed)
  if ('error' in validation) return validation.error

  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    const baseUrl = (process.env.NEXTAUTH_URL || request.nextUrl.origin).replace(/\/+$/, '')
    return NextResponse.redirect(`${baseUrl}/auth/signin`, 302)
  }

  if (decision !== 'allow') {
    return redirectWithError(parsed.redirectUri, 'access_denied', parsed.state)
  }

  const scopes = intersectScopes(parsed.scope)
  if (scopes.length === 0) {
    return redirectWithError(parsed.redirectUri, 'invalid_scope', parsed.state)
  }

  // Defense in depth: confirm the user still exists.
  const userExists = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  })
  if (!userExists) {
    return redirectWithError(parsed.redirectUri, 'access_denied', parsed.state)
  }

  const { code } = await issueAuthorizationCode({
    clientId: parsed.clientId,
    userId: session.user.id,
    redirectUri: parsed.redirectUri,
    codeChallenge: parsed.codeChallenge,
    codeChallengeMethod: parsed.codeChallengeMethod,
    scopes,
  })

  const target = new URL(parsed.redirectUri)
  target.searchParams.set('code', code)
  if (parsed.state) target.searchParams.set('state', parsed.state)
  return NextResponse.redirect(target.toString(), 302)
}
