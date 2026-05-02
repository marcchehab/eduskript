/**
 * MCP tool: update_skript_frontpage — upsert the skript's FrontPage row.
 *
 * Creates the FrontPage if it doesn't exist; updates content and/or
 * publish state otherwise. Every content change appends a FrontPageVersion
 * row (mirrors PageVersion behaviour). Requires content:write.
 *
 * **Before rewriting frontpage content, call `get_eduskript_context` once
 * per session** — it returns the markdown syntax reference (callouts,
 * code editors, math, etc.) the platform expects.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { upsertSkriptFrontPageForUser } from '@/lib/services/skript-frontpages'

export const updateSkriptFrontpageConfig = {
  title: 'Update skript frontpage',
  description:
    "Upsert the FrontPage attached to a skript. At least one of {content, isPublished} must be provided. Content changes auto-create a new FrontPageVersion. Caller must be a direct skript author. **Before rewriting content, call `get_eduskript_context` once** for the markdown syntax reference.",
  inputSchema: {
    skriptId: z.string().min(1),
    content: z
      .string()
      .optional()
      .describe('Full markdown content. Replaces existing content.'),
    isPublished: z.boolean().optional(),
  },
}

export async function updateSkriptFrontpage(args: {
  skriptId: string
  content?: string
  isPublished?: boolean
}) {
  requireScope('content:write')
  const ctx = getMcpContext()
  const { skriptId, ...patch } = args
  const { frontPage, contentChanged } = await upsertSkriptFrontPageForUser(
    ctx.userId,
    skriptId,
    patch,
    { editSource: 'mcp', editClient: ctx.clientName }
  )

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: frontPage.id,
            isPublished: frontPage.isPublished,
            updatedAt: frontPage.updatedAt,
            contentChanged,
          },
          null,
          2
        ),
      },
    ],
  }
}
