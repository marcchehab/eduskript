/**
 * MCP tool: create_page — create a new page inside a skript the actor authors.
 *
 * Requires content:write scope. Service applies the same author check + cache
 * invalidation as the dashboard's "Create page" flow.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { createPageForUser } from '@/lib/services/pages'

export const createPageConfig = {
  title: 'Create page',
  description:
    "Create a new page inside an Eduskript skript. The caller must be a direct author on the skript. The page starts at version 1 and is unpublished by default. **Before authoring content, call `get_eduskript_context` once** — it returns the markdown syntax reference (callouts, interactive code editors, math, etc.) and the teacher's personal preferences, which the platform expects content to follow.",
  inputSchema: {
    skriptId: z.string().min(1).describe('Skript ID to add the page to.'),
    title: z.string().min(1).describe('Human-readable page title.'),
    slug: z
      .string()
      .min(1)
      .describe('URL slug (lowercase, hyphenated). Will be normalized.'),
    content: z
      .string()
      .optional()
      .describe('Initial markdown content. Empty string if omitted.'),
  },
}

export async function createPage(args: {
  skriptId: string
  title: string
  slug: string
  content?: string
}) {
  requireScope('content:write')
  const ctx = getMcpContext()
  console.log(`[mcp:create_page] userId=${ctx.userId} skriptId=${args.skriptId} client=${ctx.clientName}`)
  const page = await createPageForUser(ctx.userId, args, {
    editSource: 'mcp',
    editClient: ctx.clientName,
  })

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: page.id,
            title: page.title,
            slug: page.slug,
            skriptId: page.skriptId,
          },
          null,
          2
        ),
      },
    ],
  }
}
