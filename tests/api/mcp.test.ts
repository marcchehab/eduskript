/**
 * MCP transport + tool isolation tests.
 *
 * Two layers:
 *   1. Transport route — verifies bearer-token validation, 401 + WWW-Authenticate
 *      pointing at the protected-resource metadata.
 *   2. Tool isolation — verifies that tool handlers thread the access-token's
 *      userId through to the underlying service, so an account-A token cannot
 *      reach account-B's content.
 *
 * The MCP SDK's StreamableHTTP transport is heavy to drive end-to-end from
 * vitest, so we mock the validateAccessToken layer and call the tool functions
 * inside runWithMcpContext for the isolation assertions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/mcp/tokens', () => ({
  validateAccessToken: vi.fn(),
}))

vi.mock('@/lib/services/pages', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/pages')>(
    '@/lib/services/pages'
  )
  return {
    ...actual,
    getPageForUser: vi.fn(),
    createPageForUser: vi.fn(),
    updatePageForUser: vi.fn(),
    searchPagesForUser: vi.fn(),
  }
})

vi.mock('@/lib/services/skripts', () => ({
  listSkriptsForUser: vi.fn(),
  getSkriptForUser: vi.fn(),
}))

import { validateAccessToken } from '@/lib/mcp/tokens'
import { runWithMcpContext } from '@/lib/mcp/context'
import {
  getPageForUser,
  PermissionDeniedError,
  searchPagesForUser,
  updatePageForUser,
} from '@/lib/services/pages'
import { listSkriptsForUser } from '@/lib/services/skripts'
import { listMySkripts } from '@/lib/mcp/tools/list-my-skripts'
import { readPage } from '@/lib/mcp/tools/read-page'
import { searchMyContent } from '@/lib/mcp/tools/search-my-content'
import { updatePage } from '@/lib/mcp/tools/update-page'

const ctxA = {
  userId: 'user-A',
  clientId: 'mcp_x',
  scopes: ['content:read', 'content:write'],
  tokenId: 't1',
}
const ctxB = {
  userId: 'user-B',
  clientId: 'mcp_x',
  scopes: ['content:read', 'content:write'],
  tokenId: 't2',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Transport route — bearer auth', () => {
  it('returns 401 + WWW-Authenticate with resource_metadata when no Bearer token is present', async () => {
    process.env.NEXTAUTH_URL = 'https://eduskript.org'
    const { POST } = await import('@/app/api/mcp/[transport]/route')

    const request = new NextRequest('https://eduskript.org/api/mcp/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    })

    const response = await POST(request, { params: Promise.resolve({ transport: 'mcp' }) })

    expect(response.status).toBe(401)
    const wwwAuth = response.headers.get('www-authenticate')
    expect(wwwAuth).toContain('Bearer')
    expect(wwwAuth).toContain('resource_metadata=')
    expect(wwwAuth).toContain('/.well-known/oauth-protected-resource')
  })

  it('returns 401 when validateAccessToken returns null (revoked / expired)', async () => {
    vi.mocked(validateAccessToken).mockResolvedValue(null)
    const { POST } = await import('@/app/api/mcp/[transport]/route')

    const request = new NextRequest('https://eduskript.org/api/mcp/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer revoked-token' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    })

    const response = await POST(request, { params: Promise.resolve({ transport: 'mcp' }) })
    expect(response.status).toBe(401)
  })

  it('returns 404 for unknown transport segment', async () => {
    const { POST } = await import('@/app/api/mcp/[transport]/route')
    const request = new NextRequest('https://eduskript.org/api/mcp/wrong', {
      method: 'POST',
    })
    const response = await POST(request, { params: Promise.resolve({ transport: 'wrong' }) })
    expect(response.status).toBe(404)
  })
})

describe('Tool isolation — account A vs account B', () => {
  it('list_my_skripts threads the actor userId into listSkriptsForUser', async () => {
    vi.mocked(listSkriptsForUser).mockResolvedValue([] as never)

    await runWithMcpContext(ctxA, async () => {
      await listMySkripts({})
    })
    expect(vi.mocked(listSkriptsForUser).mock.calls[0][0]).toBe('user-A')

    await runWithMcpContext(ctxB, async () => {
      await listMySkripts({})
    })
    expect(vi.mocked(listSkriptsForUser).mock.calls[1][0]).toBe('user-B')
  })

  it('read_page surfaces PermissionDeniedError as a structured MCP error', async () => {
    vi.mocked(getPageForUser).mockRejectedValue(
      new PermissionDeniedError('Cannot view this page')
    )

    // Account A token attempting to read account B's page → service throws.
    // The tool handler bubbles the typed error; the safe() wrapper in
    // server.ts catches it. We assert the throw here; server.ts catches it.
    await expect(
      runWithMcpContext(ctxA, () => readPage({ pageId: 'b-owned-page' }))
    ).rejects.toBeInstanceOf(PermissionDeniedError)
  })

  it('update_page passes the actor userId, not args', async () => {
    vi.mocked(updatePageForUser).mockResolvedValue({
      id: 'page-1',
      title: 'x',
      slug: 'x',
      isPublished: false,
      isUnlisted: false,
      updatedAt: new Date(),
    } as never)

    await runWithMcpContext(ctxA, async () => {
      await updatePage({ pageId: 'page-1', title: 'New' })
    })

    const call = vi.mocked(updatePageForUser).mock.calls[0]
    expect(call[0]).toBe('user-A')
    expect(call[1]).toBe('page-1')
    expect(call[2]).toEqual({ title: 'New' })
  })

  it('update_page rejects without content:write scope', async () => {
    const readOnly = { ...ctxA, scopes: ['content:read'] }
    await expect(
      runWithMcpContext(readOnly, () => updatePage({ pageId: 'p', title: 't' }))
    ).rejects.toThrow(/Missing required scope: content:write/)
  })

  it('search_my_content scopes to the actor', async () => {
    vi.mocked(searchPagesForUser).mockResolvedValue([] as never)
    await runWithMcpContext(ctxA, async () => {
      await searchMyContent({ query: 'foo' })
    })
    expect(vi.mocked(searchPagesForUser).mock.calls[0][0]).toBe('user-A')
  })
})
