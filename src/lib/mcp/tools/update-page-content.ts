/**
 * MCP tool: update_page_content — replace the markdown body of a page.
 *
 * Destructive by nature — every successful call overwrites the previous
 * content and produces a new PageVersion. The companion tool
 * `update_page_metadata` exists for non-destructive edits (title, slug,
 * description, publish state).
 *
 * Empty-content overwrites are gated behind `confirm_destructive=true`: an
 * accidental `content: ""` would wipe the page, so by default the call is
 * rejected when the page already has content. Recovery path on either side:
 * `list_page_versions` → `restore_page_version`.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { updatePageForUser } from '@/lib/services/pages'

export const updatePageContentConfig = {
  title: 'Update page content',
  description:
    "Replace the full markdown body of an Eduskript page. Each call creates a new PageVersion (recoverable via `list_page_versions` + `restore_page_version`). Caller must have edit permission. **Empty content is treated as a destructive wipe**: when the page already has content, a call with `content: \"\"` is rejected unless `confirm_destructive=true`. **Before rewriting page content, call `get_eduskript_context` once per session** — it returns the markdown syntax reference (callouts, interactive code editors, math, etc.) and the teacher's personal preferences.",
  inputSchema: {
    pageId: z.string().min(1).describe('Page ID to update.'),
    content: z
      .string()
      .describe('Full markdown content. Replaces the previous content entirely.'),
    confirm_destructive: z
      .boolean()
      .optional()
      .describe(
        'Required when intentionally clearing a non-empty page (i.e. content is empty / whitespace only). Default false.',
      ),
  },
}

export async function updatePageContent(args: {
  pageId: string
  content: string
  confirm_destructive?: boolean
}) {
  requireScope('content:write')
  const ctx = getMcpContext()

  const updated = await updatePageForUser(
    ctx.userId,
    args.pageId,
    { content: args.content },
    {
      editSource: 'mcp',
      editClient: ctx.clientName,
      allowEmptyContent: args.confirm_destructive === true,
    },
  )

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: updated.id,
            title: updated.title,
            slug: updated.slug,
            updatedAt: updated.updatedAt,
            // Surface a hint of the new size so the caller can sanity-check
            // the round-trip (e.g. confirm a non-empty body actually landed).
            contentLength: updated.content.length,
          },
          null,
          2,
        ),
      },
    ],
  }
}
