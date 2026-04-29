import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  getIssuer,
  getMcpResource,
} from '@/lib/mcp/metadata'

const original = process.env.NEXTAUTH_URL

beforeEach(() => {
  process.env.NEXTAUTH_URL = 'https://eduskript.org'
})

afterEach(() => {
  process.env.NEXTAUTH_URL = original
})

describe('issuer helpers', () => {
  it('strips trailing slashes from NEXTAUTH_URL', () => {
    process.env.NEXTAUTH_URL = 'https://eduskript.org/'
    expect(getIssuer()).toBe('https://eduskript.org')
  })

  it('falls back to localhost when NEXTAUTH_URL is unset', () => {
    delete process.env.NEXTAUTH_URL
    expect(getIssuer()).toBe('http://localhost:3000')
  })

  it('points the resource at /api/mcp/mcp', () => {
    expect(getMcpResource()).toBe('https://eduskript.org/api/mcp/mcp')
  })
})

describe('RFC 8414 authorization server metadata', () => {
  it('includes the required endpoints, S256 PKCE, and scopes', () => {
    const meta = buildAuthorizationServerMetadata()
    expect(meta).toMatchObject({
      issuer: 'https://eduskript.org',
      authorization_endpoint: 'https://eduskript.org/api/mcp/oauth/authorize',
      token_endpoint: 'https://eduskript.org/api/mcp/oauth/token',
      registration_endpoint: 'https://eduskript.org/api/mcp/oauth/register',
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
    })
    expect(meta.scopes_supported).toContain('content:read')
    expect(meta.scopes_supported).toContain('content:write')
  })
})

describe('RFC 9728 protected-resource metadata', () => {
  it('points at the MCP transport and authorization server', () => {
    expect(buildProtectedResourceMetadata()).toEqual({
      resource: 'https://eduskript.org/api/mcp/mcp',
      authorization_servers: ['https://eduskript.org'],
      scopes_supported: ['content:read', 'content:write'],
      bearer_methods_supported: ['header'],
    })
  })
})
