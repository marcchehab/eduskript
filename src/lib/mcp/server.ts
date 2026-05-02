/**
 * MCP server factory — produces a fresh `McpServer` per HTTP request.
 *
 * Stateless mode: no server-state is shared across requests. The transport
 * route in src/app/api/mcp/[transport]/route.ts builds a server, attaches a
 * fresh stateless `WebStandardStreamableHTTPServerTransport`, and disposes
 * both at the end of the request.
 *
 * Tool handlers are wrapped in a typed-error catch so service-level errors
 * (PermissionDeniedError, NotFoundError, ValidationError, ConflictError)
 * become structured MCP errors instead of generic 500s.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { BASE_PROMPT } from '@/lib/ai/prompts'
import { getCondensedSyntaxReference } from '@/lib/ai/syntax-reference'
import {
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from '@/lib/services/pages'
import { createPage, createPageConfig } from '@/lib/mcp/tools/create-page'
import {
  getEduskriptContext,
  getEduskriptContextConfig,
} from '@/lib/mcp/tools/get-eduskript-context'
import { listMySkripts, listMySkriptsConfig } from '@/lib/mcp/tools/list-my-skripts'
import { readPage, readPageConfig } from '@/lib/mcp/tools/read-page'
import { searchMyContent, searchMyContentConfig } from '@/lib/mcp/tools/search-my-content'
import { updatePage, updatePageConfig } from '@/lib/mcp/tools/update-page'
import { readSkript, readSkriptConfig } from '@/lib/mcp/tools/read-skript'
import { updateSkript, updateSkriptConfig } from '@/lib/mcp/tools/update-skript'
import {
  readSkriptFrontpage,
  readSkriptFrontpageConfig,
} from '@/lib/mcp/tools/read-skript-frontpage'
import {
  updateSkriptFrontpage,
  updateSkriptFrontpageConfig,
} from '@/lib/mcp/tools/update-skript-frontpage'
import { readCollection, readCollectionConfig } from '@/lib/mcp/tools/read-collection'
import {
  updateCollection,
  updateCollectionConfig,
} from '@/lib/mcp/tools/update-collection'
import {
  auditSkriptSeo,
  auditSkriptSeoConfig,
} from '@/lib/mcp/tools/audit-skript-seo'

type ToolResult = Awaited<ReturnType<typeof readPage>>

function asMcpError(message: string): ToolResult {
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  } as unknown as ToolResult
}

async function safe<T>(toolName: string, fn: () => Promise<T>): Promise<T | ToolResult> {
  try {
    const result = await fn()
    console.log(`[mcp:${toolName}] ok`)
    return result
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      console.log(`[mcp:${toolName}] denied: ${error.message}`)
      return asMcpError(`Permission denied: ${error.message}`)
    }
    if (error instanceof NotFoundError) {
      console.log(`[mcp:${toolName}] not-found: ${error.message}`)
      return asMcpError(`Not found: ${error.message}`)
    }
    if (error instanceof ValidationError) {
      console.log(`[mcp:${toolName}] invalid: ${error.message}`)
      return asMcpError(`Invalid input: ${error.message}`)
    }
    if (error instanceof ConflictError) {
      console.log(`[mcp:${toolName}] conflict: ${error.message}`)
      return asMcpError(`Conflict: ${error.message}`)
    }
    if (error instanceof Error && /Missing required scope/.test(error.message)) {
      console.log(`[mcp:${toolName}] scope-missing: ${error.message}`)
      return asMcpError(error.message)
    }
    console.error(`[mcp:${toolName}] crashed:`, error)
    return asMcpError('Internal server error')
  }
}

/**
 * Capabilities "intro" sent on the MCP `initialize` handshake. The client
 * model treats this like persistent system context for the connector.
 *
 * Single source of truth — the same BASE_PROMPT and syntax reference the
 * in-product AI assistant uses (src/lib/ai/prompts.ts +
 * src/lib/ai/syntax-reference.ts). When the in-product AI learns about a new
 * markdown extension, MCP-connected clients learn about it too.
 *
 * The optional `userPrompt` is the teacher's own User.aiSystemPrompt — same
 * field the dashboard AI assistant respects. Appended last so it can override
 * defaults without losing the platform context.
 */
function buildServerInstructions(userPrompt?: string | null): string {
  const parts = [
    BASE_PROMPT,
    '',
    getCondensedSyntaxReference(),
    '',
    '## MCP-specific guidance',
    'You are connected to a teacher\'s Eduskript account via MCP. Use the available tools to discover, read, and edit their content. Page-level: list_my_skripts, search_my_content, read_page, create_page, update_page. Skript-level: read_skript, update_skript, read_skript_frontpage, update_skript_frontpage. Collection-level: read_collection, update_collection. Bulk SEO scan: audit_skript_seo (returns excerpts + issue flags for every page in a skript — call this before sweeping descriptions). The teacher only sees the natural-language reply — show edits in human-readable form rather than raw markdown dumps.',
    '- Prefer interactive code editors (`editor` keyword) when an example is meant to be run by students.',
  ]
  if (userPrompt && userPrompt.trim()) {
    parts.push('', '## Teacher\'s personal preferences', userPrompt.trim())
  }
  return parts.join('\n')
}

export function buildMcpServer(opts: { userPrompt?: string | null } = {}): McpServer {
  const server = new McpServer(
    {
      name: 'eduskript-mcp',
      version: '1.0.0',
    },
    { instructions: buildServerInstructions(opts.userPrompt) }
  )

  server.registerTool('get_eduskript_context', getEduskriptContextConfig, async () =>
    safe('get_eduskript_context', () => getEduskriptContext()) as never
  )
  server.registerTool('list_my_skripts', listMySkriptsConfig, async (args) =>
    safe('list_my_skripts', () => listMySkripts(args)) as never
  )
  server.registerTool('read_page', readPageConfig, async (args) =>
    safe('read_page', () => readPage(args)) as never
  )
  server.registerTool('create_page', createPageConfig, async (args) =>
    safe('create_page', () => createPage(args)) as never
  )
  server.registerTool('update_page', updatePageConfig, async (args) =>
    safe('update_page', () => updatePage(args)) as never
  )
  server.registerTool('search_my_content', searchMyContentConfig, async (args) =>
    safe('search_my_content', () => searchMyContent(args)) as never
  )
  server.registerTool('read_skript', readSkriptConfig, async (args) =>
    safe('read_skript', () => readSkript(args)) as never
  )
  server.registerTool('update_skript', updateSkriptConfig, async (args) =>
    safe('update_skript', () => updateSkript(args)) as never
  )
  server.registerTool('read_skript_frontpage', readSkriptFrontpageConfig, async (args) =>
    safe('read_skript_frontpage', () => readSkriptFrontpage(args)) as never
  )
  server.registerTool(
    'update_skript_frontpage',
    updateSkriptFrontpageConfig,
    async (args) => safe('update_skript_frontpage', () => updateSkriptFrontpage(args)) as never
  )
  server.registerTool('read_collection', readCollectionConfig, async (args) =>
    safe('read_collection', () => readCollection(args)) as never
  )
  server.registerTool('update_collection', updateCollectionConfig, async (args) =>
    safe('update_collection', () => updateCollection(args)) as never
  )
  server.registerTool('audit_skript_seo', auditSkriptSeoConfig, async (args) =>
    safe('audit_skript_seo', () => auditSkriptSeo(args)) as never
  )

  return server
}
