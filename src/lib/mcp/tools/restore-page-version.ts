/**
 * MCP tool: restore_page_version — roll a page back to a prior PageVersion.
 *
 * Mirrors the side effects of the dashboard's "Restore" action: writes the
 * old content back into Page.content, appends a new PageVersion row with
 * `Restored from version N` as the changeLog, and fires the same cache
 * invalidation as a content update. Use after `list_page_versions` to pick
 * the target version.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { restorePageVersionForUser } from '@/lib/services/pages'

export const restorePageVersionConfig = {
  title: 'Restore page version',
  description:
    "Roll an Eduskript page back to the content of a prior PageVersion. Creates a new PageVersion entry recording the restore (so the rollback itself is reversible). Use this to recover from accidental wipes or bad edits. Run `list_page_versions` first to pick the target version. Caller must have edit permission on the page.",
  inputSchema: {
    pageId: z.string().min(1).describe('Page ID to roll back.'),
    versionId: z
      .string()
      .min(1)
      .describe('PageVersion ID (cuid) to restore. Get from `list_page_versions`.'),
  },
}

export async function restorePageVersion(args: {
  pageId: string
  versionId: string
}) {
  requireScope('content:write')
  const ctx = getMcpContext()

  const { page, restoredFromVersion } = await restorePageVersionForUser(
    ctx.userId,
    args.pageId,
    args.versionId,
    { editSource: 'mcp', editClient: ctx.clientName },
  )

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            success: true,
            pageId: page.id,
            restoredFromVersion,
            contentLength: page.content.length,
            updatedAt: page.updatedAt,
          },
          null,
          2,
        ),
      },
    ],
  }
}
