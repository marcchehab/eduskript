import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHash } from 'crypto'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    oAuthClient: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  isRedirectUriAllowed,
  lookupClient,
  registerClient,
  verifyClientSecret,
  __test,
} from '@/lib/mcp/client-registry'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isValidRedirectUri', () => {
  it('accepts http and https URLs', () => {
    expect(__test.isValidRedirectUri('http://localhost:9999/cb')).toBe(true)
    expect(__test.isValidRedirectUri('https://example.com/cb')).toBe(true)
  })

  it('rejects fragments (RFC 6749 §3.1.2)', () => {
    expect(__test.isValidRedirectUri('http://localhost/cb#x')).toBe(false)
  })

  it('rejects non-http(s) schemes', () => {
    expect(__test.isValidRedirectUri('javascript:alert(1)')).toBe(false)
    expect(__test.isValidRedirectUri('file:///etc/passwd')).toBe(false)
    expect(__test.isValidRedirectUri('data:,nope')).toBe(false)
  })

  it('rejects garbage', () => {
    expect(__test.isValidRedirectUri('not a url')).toBe(false)
    expect(__test.isValidRedirectUri('')).toBe(false)
  })
})

describe('registerClient', () => {
  it('creates a public PKCE-only client by default with mcp_ prefix', async () => {
    vi.mocked(prisma.oAuthClient.create).mockResolvedValue({
      clientId: 'mcp_abc',
      clientSecretHash: null,
      name: 'test',
      redirectUris: ['http://localhost:9999/cb'],
      scopes: ['content:read', 'content:write'],
      grantTypes: ['authorization_code', 'refresh_token'],
      createdAt: new Date(),
    } as never)

    const result = await registerClient({
      name: 'test',
      redirectUris: ['http://localhost:9999/cb'],
    })

    expect(result.clientSecret).toBeNull()
    expect(result.clientId).toMatch(/^mcp_/)

    const data = (vi.mocked(prisma.oAuthClient.create).mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.clientSecretHash).toBeNull()
    expect(data.registeredByUserId).toBeNull()
  })

  it('issues a secret when confidential=true and stores only the hash', async () => {
    vi.mocked(prisma.oAuthClient.create).mockResolvedValue({
      clientId: 'mcp_abc',
      clientSecretHash: 'somehash',
      name: 'test',
      redirectUris: ['http://localhost:9999/cb'],
      scopes: [],
      grantTypes: [],
      createdAt: new Date(),
    } as never)

    const result = await registerClient({
      name: 'test',
      redirectUris: ['http://localhost:9999/cb'],
      confidential: true,
    })

    expect(result.clientSecret).toMatch(/^[a-f0-9]{64}$/)
    const data = (vi.mocked(prisma.oAuthClient.create).mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.clientSecretHash).not.toBeNull()
    expect(data.clientSecretHash).not.toBe(result.clientSecret) // it's the hash, not plaintext
  })

  it('rejects empty name', async () => {
    await expect(
      registerClient({ name: '   ', redirectUris: ['http://localhost/cb'] })
    ).rejects.toThrow(/client_name/)
  })

  it('rejects empty redirect_uris', async () => {
    await expect(
      registerClient({ name: 'x', redirectUris: [] })
    ).rejects.toThrow(/redirect_uris/)
  })

  it('rejects non-http(s) redirect_uris', async () => {
    await expect(
      registerClient({ name: 'x', redirectUris: ['javascript:alert(1)'] })
    ).rejects.toThrow(/Invalid redirect_uri/)
  })
})

describe('lookupClient', () => {
  it('proxies to prisma.oAuthClient.findUnique', async () => {
    vi.mocked(prisma.oAuthClient.findUnique).mockResolvedValue({ clientId: 'mcp_x' } as never)
    expect(await lookupClient('mcp_x')).toEqual({ clientId: 'mcp_x' })
    expect(vi.mocked(prisma.oAuthClient.findUnique).mock.calls[0][0]).toEqual({
      where: { clientId: 'mcp_x' },
    })
  })
})

describe('isRedirectUriAllowed — strict equality (open-redirect mitigation)', () => {
  const client = { redirectUris: ['http://localhost:9999/cb', 'https://app.example/cb'] }

  it('allows only exactly-registered URIs', () => {
    expect(isRedirectUriAllowed(client, 'http://localhost:9999/cb')).toBe(true)
    expect(isRedirectUriAllowed(client, 'https://app.example/cb')).toBe(true)
  })

  it('rejects suffix / prefix tricks', () => {
    expect(isRedirectUriAllowed(client, 'http://localhost:9999/cb/extra')).toBe(false)
    expect(isRedirectUriAllowed(client, 'http://localhost:9999/cb?x=1')).toBe(false)
    expect(isRedirectUriAllowed(client, 'http://attacker.localhost:9999/cb')).toBe(false)
  })
})

describe('verifyClientSecret', () => {
  it('treats null hash as a public client (always passes)', () => {
    expect(verifyClientSecret({ clientSecretHash: null }, null)).toBe(true)
    expect(verifyClientSecret({ clientSecretHash: null }, 'whatever')).toBe(true)
  })

  it('verifies presented secret against the stored hash', () => {
    const secret = 'super-secret'
    const hash = createHash('sha256').update(secret).digest('hex')
    expect(verifyClientSecret({ clientSecretHash: hash }, secret)).toBe(true)
    expect(verifyClientSecret({ clientSecretHash: hash }, 'wrong')).toBe(false)
    expect(verifyClientSecret({ clientSecretHash: hash }, null)).toBe(false)
  })
})
