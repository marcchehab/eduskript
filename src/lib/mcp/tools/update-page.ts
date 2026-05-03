/**
 * MCP tool: update_page — partial update for title/slug/description/content/publish state.
 *
 * **DEPRECATED in favour of `update_page_metadata` and `update_page_content`.**
 * The combined tool is foot-guny: passing `content: ""` silently wipes the
 * page. The new pair eliminates that class of mistake by separating the
 * concerns. This tool is kept for backward compatibility and is now also
 * protected by the destructive-write guard in `updatePageForUser`.
 *
 * Goes through the extracted pages service so PageVersion creation and the
 * 4 static + per-org cache-tag invalidation fan-out fire identically to the
 * REST handler. Requires content:write scope.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { updatePageForUser } from '@/lib/services/pages'

export const updatePageConfig = {
  title: 'Update page (deprecated)',
  description:
    "DEPRECATED: prefer `update_page_metadata` (for title / slug / description / publish state) or `update_page_content` (for the markdown body). Each provided field overwrites the existing value, so passing `content: \"\"` will wipe the page — the destructive-write guard now blocks that unless you set `confirm_destructive: true`. Lost content can be recovered with `list_page_versions` + `restore_page_version`. **Before rewriting page content, call `get_eduskript_context` once per session** — it returns the markdown syntax reference (callouts, interactive code editors, math, etc.) and the teacher's personal preferences.",
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
    content: z
      .string()
      .optional()
      .describe(
        'Full markdown content. Replaces existing content. WARNING: do NOT pass this field at all if you only want to update metadata. Passing an empty string is a destructive overwrite and requires confirm_destructive=true.',
      ),
    confirm_destructive: z
      .boolean()
      .optional()
      .describe(
        'Set to true to bypass the empty-content guard when intentionally wiping a page.',
      ),
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
  confirm_destructive?: boolean
  isPublished?: boolean
  isUnlisted?: boolean
}) {
  requireScope('content:write')
  const ctx = getMcpContext()

  const { pageId, confirm_destructive, ...patch } = args
  const updated = await updatePageForUser(ctx.userId, pageId, patch, {
    editSource: 'mcp',
    editClient: ctx.clientName,
    allowEmptyContent: confirm_destructive === true,
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
