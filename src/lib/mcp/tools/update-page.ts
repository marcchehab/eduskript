/**
 * MCP tool: update_page — partial update for title/slug/content/publish state.
 *
 * Goes through the extracted pages service so PageVersion creation and the
 * 4 static + per-org cache-tag invalidation fan-out fire identically to the
 * REST handler. Requires content:write scope.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { updatePageForUser } from '@/lib/services/pages'

export const updatePageConfig = {
  title: 'Update page',
  description:
    "Update an Eduskript page. At least one of {title, slug, description, content, isPublished, isUnlisted} must be provided. Content changes auto-create a new PageVersion. Caller must have edit permission. The page description is a plain-text summary used as og:description on the public page (overrides the auto-derived excerpt — set this when the auto-excerpt picks up the wrong opening paragraph). **Before rewriting page content, call `get_eduskript_context` once per session** — it returns the markdown syntax reference (callouts, interactive code editors, math, etc.) and the teacher's personal preferences.",
  inputSchema: {
    pageId: z.string().min(1).describe('Page ID to update.'),
    title: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    description: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Plain-text page description. Overrides the auto-derived og:description excerpt. Pass null or empty string to clear and fall back to the auto-derived excerpt.',
      ),
    content: z.string().optional().describe('Full markdown content. Replaces existing content.'),
    isPublished: z.boolean().optional(),
    isUnlisted: z.boolean().optional(),
  },
}

export async function updatePage(args: {
  pageId: string
  title?: string
  slug?: string
  description?: string | null
  content?: string
  isPublished?: boolean
  isUnlisted?: boolean
}) {
  requireScope('content:write')
  const ctx = getMcpContext()

  const { pageId, ...patch } = args
  const updated = await updatePageForUser(ctx.userId, pageId, patch, {
    editSource: 'mcp',
    editClient: ctx.clientName,
  })

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: updated.id,
            title: updated.title,
            slug: updated.slug,
            isPublished: updated.isPublished,
            isUnlisted: updated.isUnlisted,
            updatedAt: updated.updatedAt,
          },
          null,
          2
        ),
      },
    ],
  }
}
