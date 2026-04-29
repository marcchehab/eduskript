/**
 * MCP transport route — Streamable HTTP, stateless mode.
 *
 * Flow per request:
 *   1. Extract bearer token from Authorization.
 *   2. validateAccessToken() — atomic updateMany bumps lastUsedAt.
 *   3. Build McpContext { userId, scopes, clientId, tokenId }.
 *   4. Run server.connect(transport) + transport.handleRequest(req) inside
 *      runWithMcpContext so all tool handlers see the actor.
 *   5. Stateless mode = no session continuation between requests.
 *
 * AGPL note: this endpoint exposes Eduskript over the network as defined by
 * AGPL-3.0 §13. Operators of modified deployments must offer their corresponding
 * source. No new obligation beyond what eduskript.org itself already has.
 *
 * Limitation: stateless Streamable HTTP cannot deliver server-initiated
 * progress notifications between requests. Acceptable for the v1 5-tool surface.
 */

import { NextRequest, NextResponse } from 'next/server'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { prisma } from '@/lib/prisma'
import { validateAccessToken } from '@/lib/mcp/tokens'
import { runWithMcpContext } from '@/lib/mcp/context'
import { buildMcpServer } from '@/lib/mcp/server'
import { getMcpResource } from '@/lib/mcp/metadata'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function unauthorized(reason: string): Response {
  // RFC 9728 — point clients at the protected-resource metadata so they
  // can find the authorization server.
  const resourceMetadata = `${(process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/+$/, '')}/.well-known/oauth-protected-resource`
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message: `Unauthorized: ${reason}` },
      id: null,
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer realm="${getMcpResource()}", resource_metadata="${resourceMetadata}"`,
      },
    }
  )
}

async function handle(request: NextRequest, transportSegment: string): Promise<Response> {
  // We only expose one transport ('mcp'); reject any other catch-all values.
  if (transportSegment !== 'mcp') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const authHeader = request.headers.get('authorization') || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) return unauthorized('Bearer token required')

  const validated = await validateAccessToken(match[1])
  if (!validated) return unauthorized('Token invalid, expired, or revoked')

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  })

  // Load the teacher's personal AI prompt so the MCP connector honors the
  // same customization as the in-product dashboard AI assistant.
  const userRow = await prisma.user.findUnique({
    where: { id: validated.userId },
    select: { aiSystemPrompt: true },
  })

  const server = buildMcpServer({ userPrompt: userRow?.aiSystemPrompt ?? null })
  await server.connect(transport)

  try {
    return await runWithMcpContext(
      {
        userId: validated.userId,
        clientId: validated.clientId,
        clientName: validated.clientName,
        scopes: validated.scopes,
        tokenId: validated.tokenId,
      },
      () => transport.handleRequest(request)
    )
  } finally {
    // Stateless: tear down both per-request.
    await transport.close().catch(() => {})
    await server.close().catch(() => {})
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ transport: string }> }
) {
  const { transport } = await params
  return handle(request, transport)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ transport: string }> }
) {
  const { transport } = await params
  return handle(request, transport)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ transport: string }> }
) {
  const { transport } = await params
  return handle(request, transport)
}
