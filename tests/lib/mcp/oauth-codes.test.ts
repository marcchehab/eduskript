import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHash, randomBytes } from 'crypto'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    oAuthAuthorizationCode: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  consumeAuthorizationCode,
  issueAuthorizationCode,
  __test,
} from '@/lib/mcp/oauth-codes'

beforeEach(() => {
  vi.clearAllMocks()
})

function makePkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

describe('issueAuthorizationCode', () => {
  it('persists hashed code with 10-minute TTL and the chosen challenge', async () => {
    vi.mocked(prisma.oAuthAuthorizationCode.create).mockResolvedValue({} as never)

    const before = Date.now()
    const { code, expiresAt } = await issueAuthorizationCode({
      clientId: 'mcp_x',
      userId: 'u1',
      redirectUri: 'http://localhost:9999/cb',
      codeChallenge: 'abc',
      codeChallengeMethod: 'S256',
      scopes: ['content:read'],
    })
    const after = Date.now()

    expect(code).toMatch(/^[a-f0-9]{64}$/)
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + __test.CODE_TTL_SECONDS * 1000 - 1)
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + __test.CODE_TTL_SECONDS * 1000 + 1)

    const data = (vi.mocked(prisma.oAuthAuthorizationCode.create).mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.codeHash).toBe(__test.sha256Hex(code))
    expect(data.codeChallenge).toBe('abc')
    expect(data.codeChallengeMethod).toBe('S256')
  })

  it('rejects unsupported code_challenge_method', async () => {
    await expect(
      issueAuthorizationCode({
        clientId: 'mcp_x',
        userId: 'u1',
        redirectUri: 'http://localhost/cb',
        codeChallenge: 'abc',
        codeChallengeMethod: 'plain',
        scopes: [],
      })
    ).rejects.toThrow(/Unsupported/)
  })
})

describe('consumeAuthorizationCode — single-use', () => {
  const { verifier, challenge } = makePkce()

  function setupValidCode() {
    vi.mocked(prisma.oAuthAuthorizationCode.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.oAuthAuthorizationCode.findUnique).mockResolvedValue({
      userId: 'u1',
      clientId: 'mcp_x',
      redirectUri: 'http://localhost:9999/cb',
      scopes: ['content:read'],
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    } as never)
  }

  it('verifies PKCE and returns the consumed code identity', async () => {
    setupValidCode()
    const result = await consumeAuthorizationCode({
      code: 'plaintext',
      clientId: 'mcp_x',
      redirectUri: 'http://localhost:9999/cb',
      codeVerifier: verifier,
    })
    expect(result).toEqual({
      userId: 'u1',
      clientId: 'mcp_x',
      redirectUri: 'http://localhost:9999/cb',
      scopes: ['content:read'],
    })
  })

  it('rejects on PKCE mismatch (wrong verifier)', async () => {
    setupValidCode()
    const result = await consumeAuthorizationCode({
      code: 'plaintext',
      clientId: 'mcp_x',
      redirectUri: 'http://localhost:9999/cb',
      codeVerifier: 'wrong-verifier',
    })
    expect(result).toBeNull()
  })

  it('rejects on second use (replay) — atomic updateMany returns count=0', async () => {
    vi.mocked(prisma.oAuthAuthorizationCode.updateMany).mockResolvedValue({ count: 0 } as never)
    const result = await consumeAuthorizationCode({
      code: 'plaintext',
      clientId: 'mcp_x',
      redirectUri: 'http://localhost:9999/cb',
      codeVerifier: verifier,
    })
    expect(result).toBeNull()
    expect(vi.mocked(prisma.oAuthAuthorizationCode.findUnique)).not.toHaveBeenCalled()
  })

  it('rejects when redirect_uri does not match the one bound to the code', async () => {
    // updateMany filters by redirectUri, so if redirect doesn't match nothing
    // gets atomically consumed.
    vi.mocked(prisma.oAuthAuthorizationCode.updateMany).mockResolvedValue({ count: 0 } as never)
    const result = await consumeAuthorizationCode({
      code: 'plaintext',
      clientId: 'mcp_x',
      redirectUri: 'http://attacker.example/cb',
      codeVerifier: verifier,
    })
    expect(result).toBeNull()
  })

  it('rejects on unsupported challenge method on the stored row', async () => {
    vi.mocked(prisma.oAuthAuthorizationCode.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.oAuthAuthorizationCode.findUnique).mockResolvedValue({
      userId: 'u1',
      clientId: 'mcp_x',
      redirectUri: 'http://localhost:9999/cb',
      scopes: [],
      codeChallenge: 'abc',
      codeChallengeMethod: 'plain',
    } as never)
    const result = await consumeAuthorizationCode({
      code: 'plaintext',
      clientId: 'mcp_x',
      redirectUri: 'http://localhost:9999/cb',
      codeVerifier: 'irrelevant',
    })
    expect(result).toBeNull()
  })
})

describe('s256Challenge helper', () => {
  it('produces RFC 7636 base64url(SHA256(verifier))', () => {
    // RFC 7636 §4.6 fixture — known good test vector.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    expect(__test.s256Challenge(verifier)).toBe(expected)
  })
})
