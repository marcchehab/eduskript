/**
 * MCP tool: move_page — move a page into another skript, keeping its id.
 *
 * Requires content:write. Same service as POST /api/pages/move: version
 * history, student data and /p/{id} links survive; referenced files are copied.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { movePageForUser } from '@/lib/services/pages'

export const movePageConfig = {
  title: 'Move page to another skript',
  description:
    'Move a page into a different skript. The page keeps its id, version history, student answers and stable link — prefer this over create + copy + delete. Files the page references by name are copied into the target skript. The page is appended at the end of the target (use `reorder_skript_pages` afterwards); its slug gets a -2/-3 suffix if the target already has that slug. Requires edit permission on both skripts.',
  inputSchema: {
    pageId: z.string().min(1).describe('Page to move.'),
    targetSkriptId: z.string().min(1).describe('Skript to move the page into.'),
  },
}

export async function movePage(args: { pageId: string; targetSkriptId: string }) {
  requireScope('content:write')
  const ctx = getMcpContext()
  console.log(`[mcp:move_page] userId=${ctx.userId} pageId=${args.pageId} target=${args.targetSkriptId} client=${ctx.clientName}`)
  const result = await movePageForUser(ctx.userId, args.pageId, args.targetSkriptId)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  }
}
