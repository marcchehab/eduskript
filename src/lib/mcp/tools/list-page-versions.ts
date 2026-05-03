/**
 * MCP tool: list_page_versions — read-only audit trail of a page's edits.
 *
 * Returns every PageVersion row for the page, newest first, including
 * `contentLength` so callers can spot a wipe (`contentLength: 0`) without
 * fetching every version body. Pair with `restore_page_version` to undo a
 * bad edit.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { listPageVersionsForUser } from '@/lib/services/pages'

export const listPageVersionsConfig = {
  title: 'List page versions',
  description:
    'List every PageVersion of an Eduskript page (newest first). Includes contentLength per version so you can spot a wipe without fetching each body. Pair with `restore_page_version` to roll back. Caller must have edit permission on the page.',
  inputSchema: {
    pageId: z.string().min(1).describe('Page ID whose version history to list.'),
  },
}

export async function listPageVersions(args: { pageId: string }) {
  requireScope('content:read')
  const ctx = getMcpContext()
  const versions = await listPageVersionsForUser(ctx.userId, args.pageId)

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ pageId: args.pageId, versions }, null, 2),
      },
    ],
  }
}
