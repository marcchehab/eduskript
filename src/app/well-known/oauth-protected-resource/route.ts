/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata.
 *
 * The MCP transport at /api/mcp/mcp returns 401 + WWW-Authenticate with
 * resource_metadata pointing here. Clients fetch this doc to learn which
 * authorization server can issue tokens for the resource.
 */

import { NextResponse } from 'next/server'
import { buildProtectedResourceMetadata } from '@/lib/mcp/metadata'

export async function GET() {
  return NextResponse.json(buildProtectedResourceMetadata())
}
