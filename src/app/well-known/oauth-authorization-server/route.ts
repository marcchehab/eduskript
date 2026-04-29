/**
 * RFC 8414 — OAuth 2.0 Authorization Server Metadata.
 *
 * MCP clients (claude.ai, Claude Code, Cursor) start discovery here. They
 * read this document to find the authorize / token / registration endpoints.
 */

import { NextResponse } from 'next/server'
import { buildAuthorizationServerMetadata } from '@/lib/mcp/metadata'

export async function GET() {
  return NextResponse.json(buildAuthorizationServerMetadata())
}
