/**
 * MCP OAuth token utilities — access + refresh tokens for the MCP authorization server.
 *
 * Storage model: plaintext tokens are random 32-byte hex strings (returned to the
 * client once); only the SHA-256 hash is persisted. Validation is a single
 * atomic `updateMany` (mirroring src/lib/exam-tokens.ts:85-93) so a hijacked
 * token cannot be revalidated while it is being revoked / lastUsedAt-bumped.
 *
 * Access token   — 1h, bearer in Authorization header. Validation bumps lastUsedAt.
 * Refresh token  — 30d, single-use; rotation issues a new pair and sets
 *                  replacedById on the old row for audit.
 */

import { randomBytes, createHash } from 'crypto'
import { prisma } from '@/lib/prisma'

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days
const TOKEN_PREFIX_LEN = 12

export const ACCESS_TOKEN_TTL = ACCESS_TOKEN_TTL_SECONDS
export const REFRESH_TOKEN_TTL = REFRESH_TOKEN_TTL_SECONDS

function hash(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

function generatePlaintext(): string {
  return randomBytes(32).toString('hex')
}

export interface IssuedTokenPair {
  accessToken: string
  accessTokenId: string
  refreshToken: string
  refreshTokenId: string
  accessExpiresAt: Date
  refreshExpiresAt: Date
}

export interface ValidatedAccessToken {
  tokenId: string
  userId: string
  clientId: string
  clientName: string
  scopes: string[]
}

export async function issueTokenPair(args: {
  userId: string
  clientId: string
  scopes: string[]
}): Promise<IssuedTokenPair> {
  const accessToken = generatePlaintext()
  const refreshToken = generatePlaintext()
  const now = new Date()
  const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000)
  const refreshExpiresAt = new Date(
    now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000
  )

  const accessRow = await prisma.oAuthAccessToken.create({
    data: {
      tokenHash: hash(accessToken),
      tokenPrefix: accessToken.slice(0, TOKEN_PREFIX_LEN),
      clientId: args.clientId,
      userId: args.userId,
      scopes: args.scopes,
      expiresAt: accessExpiresAt,
    },
  })

  const refreshRow = await prisma.oAuthRefreshToken.create({
    data: {
      tokenHash: hash(refreshToken),
      clientId: args.clientId,
      userId: args.userId,
      scopes: args.scopes,
      expiresAt: refreshExpiresAt,
    },
  })

  return {
    accessToken,
    accessTokenId: accessRow.id,
    refreshToken,
    refreshTokenId: refreshRow.id,
    accessExpiresAt,
    refreshExpiresAt,
  }
}

/**
 * Validate a bearer access token. Atomic: only succeeds if not expired and not
 * revoked. On success, lastUsedAt is bumped in the same round-trip.
 *
 * Mirrors src/lib/exam-tokens.ts:85-93: updateMany with strict where-clause
 * gating, then a findUnique to retrieve the row's metadata.
 */
export async function validateAccessToken(
  plaintext: string
): Promise<ValidatedAccessToken | null> {
  const tokenHash = hash(plaintext)

  const result = await prisma.oAuthAccessToken.updateMany({
    where: {
      tokenHash,
      expiresAt: { gt: new Date() },
      revokedAt: null,
    },
    data: { lastUsedAt: new Date() },
  })

  if (result.count === 0) return null

  const row = await prisma.oAuthAccessToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      clientId: true,
      scopes: true,
      client: { select: { name: true } },
    },
  })

  if (!row) return null
  return {
    tokenId: row.id,
    userId: row.userId,
    clientId: row.clientId,
    clientName: row.client.name,
    scopes: row.scopes,
  }
}

export interface ConsumedRefreshToken {
  tokenId: string
  userId: string
  clientId: string
  scopes: string[]
}

/**
 * Atomically revoke a refresh token. If it was already revoked or expired,
 * returns null. Caller is expected to issue a new pair, then call
 * `markRefreshReplaced` on the returned tokenId to set replacedById on the
 * old row (rotation audit chain).
 */
export async function consumeRefreshToken(
  plaintext: string
): Promise<ConsumedRefreshToken | null> {
  const tokenHash = hash(plaintext)

  const result = await prisma.oAuthRefreshToken.updateMany({
    where: {
      tokenHash,
      expiresAt: { gt: new Date() },
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  })

  if (result.count === 0) return null

  const row = await prisma.oAuthRefreshToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, clientId: true, scopes: true },
  })
  if (!row) return null

  return {
    tokenId: row.id,
    userId: row.userId,
    clientId: row.clientId,
    scopes: row.scopes,
  }
}

export async function markRefreshReplaced(
  oldRefreshTokenId: string,
  newRefreshTokenId: string
): Promise<void> {
  await prisma.oAuthRefreshToken.update({
    where: { id: oldRefreshTokenId },
    data: { replacedById: newRefreshTokenId },
  })
}

/**
 * Revoke all access + refresh tokens for a (clientId, userId) pair. Used by the
 * Connected Apps "revoke" UI.
 */
export async function revokeTokensForClient(
  userId: string,
  clientId: string
): Promise<void> {
  const now = new Date()
  await prisma.oAuthAccessToken.updateMany({
    where: { userId, clientId, revokedAt: null },
    data: { revokedAt: now },
  })
  await prisma.oAuthRefreshToken.updateMany({
    where: { userId, clientId, revokedAt: null },
    data: { revokedAt: now },
  })
}

export const __test = {
  hash,
  generatePlaintext,
  TOKEN_PREFIX_LEN,
}
