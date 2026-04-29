import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    oAuthAccessToken: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    oAuthRefreshToken: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
  consumeRefreshToken,
  issueTokenPair,
  markRefreshReplaced,
  revokeTokensForClient,
  validateAccessToken,
  __test,
} from '@/lib/mcp/tokens'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('issueTokenPair', () => {
  it('persists hashed access + refresh tokens with TTLs and a 12-char prefix', async () => {
    vi.mocked(prisma.oAuthAccessToken.create).mockResolvedValue({ id: 'a1' } as never)
    vi.mocked(prisma.oAuthRefreshToken.create).mockResolvedValue({ id: 'r1' } as never)

    const before = Date.now()
    const result = await issueTokenPair({
      userId: 'u1',
      clientId: 'mcp_x',
      scopes: ['content:read', 'content:write'],
    })
    const after = Date.now()

    expect(result.accessToken).toMatch(/^[a-f0-9]{64}$/)
    expect(result.refreshToken).toMatch(/^[a-f0-9]{64}$/)
    expect(result.accessTokenId).toBe('a1')
    expect(result.refreshTokenId).toBe('r1')

    const accessCall = vi.mocked(prisma.oAuthAccessToken.create).mock.calls[0][0]
    const accessData = (accessCall as { data: Record<string, unknown> }).data
    expect(accessData.tokenHash).toBe(__test.hash(result.accessToken))
    expect(accessData.tokenPrefix).toBe(result.accessToken.slice(0, 12))
    expect(accessData.scopes).toEqual(['content:read', 'content:write'])

    const accessExpiresMs = (accessData.expiresAt as Date).getTime()
    expect(accessExpiresMs).toBeGreaterThanOrEqual(before + ACCESS_TOKEN_TTL * 1000)
    expect(accessExpiresMs).toBeLessThanOrEqual(after + ACCESS_TOKEN_TTL * 1000)

    const refreshCall = vi.mocked(prisma.oAuthRefreshToken.create).mock.calls[0][0]
    const refreshData = (refreshCall as { data: Record<string, unknown> }).data
    expect(refreshData.tokenHash).toBe(__test.hash(result.refreshToken))
    const refreshExpiresMs = (refreshData.expiresAt as Date).getTime()
    expect(refreshExpiresMs).toBeGreaterThanOrEqual(before + REFRESH_TOKEN_TTL * 1000)
  })
})

describe('validateAccessToken', () => {
  it('returns null on hash miss (updateMany count = 0)', async () => {
    vi.mocked(prisma.oAuthAccessToken.updateMany).mockResolvedValue({ count: 0 } as never)
    expect(await validateAccessToken('does-not-exist')).toBeNull()
    expect(vi.mocked(prisma.oAuthAccessToken.findUnique)).not.toHaveBeenCalled()
  })

  it('returns identity when atomic update succeeds and bumps lastUsedAt', async () => {
    vi.mocked(prisma.oAuthAccessToken.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.oAuthAccessToken.findUnique).mockResolvedValue({
      id: 't1',
      userId: 'u1',
      clientId: 'mcp_x',
      scopes: ['content:read'],
      client: { name: 'Claude' },
    } as never)

    const result = await validateAccessToken('plaintext-token')
    expect(result).toEqual({
      tokenId: 't1',
      userId: 'u1',
      clientId: 'mcp_x',
      clientName: 'Claude',
      scopes: ['content:read'],
    })

    const updateCall = vi.mocked(prisma.oAuthAccessToken.updateMany).mock.calls[0][0]
    const where = (updateCall as { where: Record<string, unknown> }).where
    expect(where.tokenHash).toBe(__test.hash('plaintext-token'))
    expect(where.revokedAt).toBeNull()
    expect((where.expiresAt as { gt: Date }).gt).toBeInstanceOf(Date)

    const data = (updateCall as { data: Record<string, unknown> }).data
    expect(data.lastUsedAt).toBeInstanceOf(Date)
  })

  it('does not validate revoked tokens (updateMany where revokedAt: null filters them)', async () => {
    // The atomicity guarantee: if a revoke runs between hash + check, updateMany
    // sees the revokedAt and returns count=0. We model that here as count=0.
    vi.mocked(prisma.oAuthAccessToken.updateMany).mockResolvedValue({ count: 0 } as never)
    expect(await validateAccessToken('revoked-token')).toBeNull()
  })
})

describe('consumeRefreshToken — rotation', () => {
  it('atomically marks the old refresh revoked and returns its identity', async () => {
    vi.mocked(prisma.oAuthRefreshToken.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.oAuthRefreshToken.findUnique).mockResolvedValue({
      id: 'old-r',
      userId: 'u1',
      clientId: 'mcp_x',
      scopes: ['content:read', 'content:write'],
    } as never)

    const result = await consumeRefreshToken('old-refresh')
    expect(result).toEqual({
      tokenId: 'old-r',
      userId: 'u1',
      clientId: 'mcp_x',
      scopes: ['content:read', 'content:write'],
    })

    const updateCall = vi.mocked(prisma.oAuthRefreshToken.updateMany).mock.calls[0][0]
    const data = (updateCall as { data: Record<string, unknown> }).data
    expect(data.revokedAt).toBeInstanceOf(Date)
  })

  it('returns null when token is unknown / already revoked / expired', async () => {
    vi.mocked(prisma.oAuthRefreshToken.updateMany).mockResolvedValue({ count: 0 } as never)
    expect(await consumeRefreshToken('replayed')).toBeNull()
  })

  it('replay attempt: a second consume after a rotation returns null', async () => {
    // Round 1: succeeds
    vi.mocked(prisma.oAuthRefreshToken.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never)
    vi.mocked(prisma.oAuthRefreshToken.findUnique).mockResolvedValue({
      id: 'old-r',
      userId: 'u1',
      clientId: 'mcp_x',
      scopes: [],
    } as never)

    expect(await consumeRefreshToken('shared')).not.toBeNull()
    expect(await consumeRefreshToken('shared')).toBeNull()
  })
})

describe('markRefreshReplaced', () => {
  it('sets replacedById on the old row', async () => {
    vi.mocked(prisma.oAuthRefreshToken.update).mockResolvedValue({} as never)
    await markRefreshReplaced('old-id', 'new-id')
    expect(vi.mocked(prisma.oAuthRefreshToken.update).mock.calls[0][0]).toMatchObject({
      where: { id: 'old-id' },
      data: { replacedById: 'new-id' },
    })
  })
})

describe('revokeTokensForClient', () => {
  it('revokes both access + refresh tokens for the user/client pair', async () => {
    vi.mocked(prisma.oAuthAccessToken.updateMany).mockResolvedValue({ count: 2 } as never)
    vi.mocked(prisma.oAuthRefreshToken.updateMany).mockResolvedValue({ count: 1 } as never)

    await revokeTokensForClient('u1', 'mcp_x')

    expect(vi.mocked(prisma.oAuthAccessToken.updateMany).mock.calls[0][0]).toMatchObject({
      where: { userId: 'u1', clientId: 'mcp_x', revokedAt: null },
    })
    expect(vi.mocked(prisma.oAuthRefreshToken.updateMany).mock.calls[0][0]).toMatchObject({
      where: { userId: 'u1', clientId: 'mcp_x', revokedAt: null },
    })
  })
})
