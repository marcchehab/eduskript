/**
 * MCP tool: reorder_skript_pages — set the order of pages in a skript.
 *
 * Requires content:write. `pageIds` must be exactly the skript's pages.
 * Same service as PATCH /api/skripts/[id]/reorder-pages.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { reorderSkriptPagesForUser } from '@/lib/services/skripts'

export const reorderSkriptPagesConfig = {
  title: 'Reorder pages in a skript',
  description:
    'Set the sidebar order of the pages inside a skript. `pageIds` must list exactly the pages currently in the skript, once each, in the desired top-to-bottom order. Use `read_skript` to see the current pages. Requires edit permission on the skript.',
  inputSchema: {
    skriptId: z.string().min(1).describe('Skript whose pages to reorder.'),
    pageIds: z
      .array(z.string().min(1))
      .min(1)
      .describe('All page IDs in the skript, in the desired order.'),
  },
}

export async function reorderSkriptPages(args: { skriptId: string; pageIds: string[] }) {
  requireScope('content:write')
  const ctx = getMcpContext()
  console.log(`[mcp:reorder_skript_pages] userId=${ctx.userId} skriptId=${args.skriptId} client=${ctx.clientName}`)
  const result = await reorderSkriptPagesForUser(ctx.userId, args.skriptId, args.pageIds)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  }
}
