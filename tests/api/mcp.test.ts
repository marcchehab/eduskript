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
  updateSkriptForUser: vi.fn(),
  auditSkriptSeoForUser: vi.fn(),
}))

vi.mock('@/lib/services/skript-frontpages', () => ({
  getSkriptFrontPageForUser: vi.fn(),
  upsertSkriptFrontPageForUser: vi.fn(),
}))

vi.mock('@/lib/services/collections', () => ({
  getCollectionForUser: vi.fn(),
  updateCollectionForUser: vi.fn(),
}))

import { validateAccessToken } from '@/lib/mcp/tokens'
import { runWithMcpContext } from '@/lib/mcp/context'
import {
  getPageForUser,
  PermissionDeniedError,
  searchPagesForUser,
  updatePageForUser,
} from '@/lib/services/pages'
import {
  listSkriptsForUser,
  updateSkriptForUser,
  auditSkriptSeoForUser,
} from '@/lib/services/skripts'
import { upsertSkriptFrontPageForUser } from '@/lib/services/skript-frontpages'
import { updateCollectionForUser } from '@/lib/services/collections'
import { listMySkripts } from '@/lib/mcp/tools/list-my-skripts'
import { readPage } from '@/lib/mcp/tools/read-page'
import { searchMyContent } from '@/lib/mcp/tools/search-my-content'
import { updatePage } from '@/lib/mcp/tools/update-page'
import { updateSkript } from '@/lib/mcp/tools/update-skript'
import { updateSkriptFrontpage } from '@/lib/mcp/tools/update-skript-frontpage'
import { updateCollection } from '@/lib/mcp/tools/update-collection'
import { auditSkriptSeo } from '@/lib/mcp/tools/audit-skript-seo'

const ctxA = {
  userId: 'user-A',
  clientId: 'mcp_x',
  clientName: 'Claude',
  scopes: ['content:read', 'content:write'],
  tokenId: 't1',
}
const ctxB = {
  userId: 'user-B',
  clientId: 'mcp_x',
  clientName: 'Claude',
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
    expect(call[3]).toEqual({
      editSource: 'mcp',
      editClient: 'Claude',
      // Destructive-write guard escape hatch — false unless the caller
      // explicitly passes confirm_destructive=true on the tool call.
      allowEmptyContent: false,
    })
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

  it('update_skript passes the actor userId, not args', async () => {
    vi.mocked(updateSkriptForUser).mockResolvedValue({
      id: 'sk-1',
      title: 'New',
      description: null,
      slug: 'new',
      isPublished: false,
      isUnlisted: false,
      updatedAt: new Date(),
    } as never)

    await runWithMcpContext(ctxA, async () => {
      await updateSkript({ skriptId: 'sk-1', title: 'New' })
    })

    const call = vi.mocked(updateSkriptForUser).mock.calls[0]
    expect(call[0]).toBe('user-A')
    expect(call[1]).toBe('sk-1')
    expect(call[2]).toEqual({ title: 'New' })
    expect(call[3]).toEqual({ editSource: 'mcp', editClient: 'Claude' })
  })

  it('update_skript rejects without content:write scope', async () => {
    const readOnly = { ...ctxA, scopes: ['content:read'] }
    await expect(
      runWithMcpContext(readOnly, () =>
        updateSkript({ skriptId: 'sk-1', title: 'x' })
      )
    ).rejects.toThrow(/Missing required scope: content:write/)
  })

  it('update_skript_frontpage passes the actor userId and editSource', async () => {
    vi.mocked(upsertSkriptFrontPageForUser).mockResolvedValue({
      frontPage: {
        id: 'fp-1',
        isPublished: true,
        updatedAt: new Date(),
      },
      contentChanged: true,
    } as never)

    await runWithMcpContext(ctxA, async () => {
      await updateSkriptFrontpage({
        skriptId: 'sk-1',
        content: '# hello',
        isPublished: true,
      })
    })

    const call = vi.mocked(upsertSkriptFrontPageForUser).mock.calls[0]
    expect(call[0]).toBe('user-A')
    expect(call[1]).toBe('sk-1')
    expect(call[2]).toEqual({ content: '# hello', isPublished: true })
    expect(call[3]).toEqual({ editSource: 'mcp', editClient: 'Claude' })
  })

  it('update_skript_frontpage rejects without content:write scope', async () => {
    const readOnly = { ...ctxA, scopes: ['content:read'] }
    await expect(
      runWithMcpContext(readOnly, () =>
        updateSkriptFrontpage({ skriptId: 'sk-1', content: 'x' })
      )
    ).rejects.toThrow(/Missing required scope: content:write/)
  })

  it('update_collection passes the actor userId and editSource', async () => {
    vi.mocked(updateCollectionForUser).mockResolvedValue({
      id: 'col-1',
      title: 'New title',
      description: null,
      slug: 'new',
      accentColor: null,
      updatedAt: new Date(),
    } as never)

    await runWithMcpContext(ctxA, async () => {
      await updateCollection({ collectionId: 'col-1', title: 'New title' })
    })

    const call = vi.mocked(updateCollectionForUser).mock.calls[0]
    expect(call[0]).toBe('user-A')
    expect(call[1]).toBe('col-1')
    expect(call[2]).toEqual({ title: 'New title' })
    expect(call[3]).toEqual({ editSource: 'mcp', editClient: 'Claude' })
  })

  it('audit_skript_seo scopes to the actor and surfaces typed errors', async () => {
    vi.mocked(auditSkriptSeoForUser).mockResolvedValue({
      skript: {
        id: 'sk-1',
        title: 't',
        slug: 's',
        description: null,
        isPublished: true,
        isUnlisted: false,
      },
      frontPage: null,
      pages: [],
      totals: { pages: 0, published: 0, withIssues: 0 },
    } as never)

    await runWithMcpContext(ctxA, async () => {
      await auditSkriptSeo({ skriptId: 'sk-1' })
    })
    expect(vi.mocked(auditSkriptSeoForUser).mock.calls[0][0]).toBe('user-A')

    vi.mocked(auditSkriptSeoForUser).mockRejectedValue(
      new PermissionDeniedError('Cannot view this skript')
    )
    await expect(
      runWithMcpContext(ctxB, () => auditSkriptSeo({ skriptId: 'sk-1' }))
    ).rejects.toBeInstanceOf(PermissionDeniedError)
  })
})
