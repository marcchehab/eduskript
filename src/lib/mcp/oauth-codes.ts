/**
 * MCP OAuth authorization codes — short-lived (10 min), single-use codes
 * issued at /api/mcp/oauth/authorize and exchanged at /api/mcp/oauth/token.
 *
 * PKCE S256 verification — the client picks a high-entropy code_verifier, sends
 * `BASE64URL(SHA256(verifier))` as code_challenge at /authorize, and proves
 * possession by sending the verifier at /token. We never see the verifier
 * before /token, so a stolen code alone is useless.
 *
 * Storage: SHA-256 hash only. Validation is atomic (mirrors exam-tokens.ts:85-93)
 * so a code cannot be exchanged twice in parallel.
 */

import { randomBytes, createHash } from 'crypto'
import { prisma } from '@/lib/prisma'

const CODE_TTL_SECONDS = 10 * 60 // 10 minutes
const CODE_CHALLENGE_METHOD = 'S256' as const

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * RFC 7636 §4.2 — verifier → S256 challenge:
 *   challenge = BASE64URL(SHA256(verifier))
 * Note: this is base64url over the raw SHA-256 *bytes*, not the hex digest.
 */
function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export async function issueAuthorizationCode(args: {
  clientId: string
  userId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  scopes: string[]
}): Promise<{ code: string; expiresAt: Date }> {
  if (args.codeChallengeMethod !== CODE_CHALLENGE_METHOD) {
    throw new Error(`Unsupported code_challenge_method: ${args.codeChallengeMethod}`)
  }

  const code = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000)

  await prisma.oAuthAuthorizationCode.create({
    data: {
      codeHash: sha256Hex(code),
      clientId: args.clientId,
      userId: args.userId,
      redirectUri: args.redirectUri,
      codeChallenge: args.codeChallenge,
      codeChallengeMethod: args.codeChallengeMethod,
      scopes: args.scopes,
      expiresAt,
    },
  })

  return { code, expiresAt }
}

export interface ConsumedAuthorizationCode {
  userId: string
  clientId: string
  redirectUri: string
  scopes: string[]
}

/**
 * Atomically consume the code (sets usedAt) and verify PKCE. Returns the
 * code's stored fields so the token endpoint can issue a token pair.
 *
 * The redirectUri sent to /token MUST match the one stored on the code
 * (RFC 6749 §4.1.3). We enforce that here so the route handler doesn't have to.
 */
export async function consumeAuthorizationCode(args: {
  code: string
  clientId: string
  redirectUri: string
  codeVerifier: string
}): Promise<ConsumedAuthorizationCode | null> {
  const codeHash = sha256Hex(args.code)

  const result = await prisma.oAuthAuthorizationCode.updateMany({
    where: {
      codeHash,
      clientId: args.clientId,
      redirectUri: args.redirectUri,
      expiresAt: { gt: new Date() },
      usedAt: null,
    },
    data: { usedAt: new Date() },
  })

  if (result.count === 0) return null

  const row = await prisma.oAuthAuthorizationCode.findUnique({
    where: { codeHash },
    select: {
      userId: true,
      clientId: true,
      redirectUri: true,
      scopes: true,
      codeChallenge: true,
      codeChallengeMethod: true,
    },
  })

  if (!row) return null

  if (row.codeChallengeMethod !== CODE_CHALLENGE_METHOD) return null

  const expected = s256Challenge(args.codeVerifier)
  if (expected !== row.codeChallenge) return null

  return {
    userId: row.userId,
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    scopes: row.scopes,
  }
}

export const __test = {
  s256Challenge,
  sha256Hex,
  CODE_TTL_SECONDS,
}
