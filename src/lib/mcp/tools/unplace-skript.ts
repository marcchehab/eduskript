/**
 * MCP tool: unplace_skript — remove a skript from a collection or the root
 * sidebar. Inverse of place_skript; never deletes content.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { unplaceSkriptForUser } from '@/lib/services/skripts'

export const unplaceSkriptConfig = {
  title: 'Remove skript from sidebar',
  description:
    'Inverse of `place_skript`: pass a collectionId to take the skript out of that collection, or omit it to remove the skript\'s top-level sidebar item (on siteId, default the primary site). The skript and its pages are not deleted and stay in other collections/sites. Note: a top-level item is hidden while the skript is also in a collection, so removing it from its last collection can make such an item show up again.',
  inputSchema: {
    skriptId: z.string().min(1).describe('Skript to remove.'),
    collectionId: z.string().optional().describe('Collection to remove it from. Omit to remove the root sidebar item.'),
    siteId: z.string().optional().describe('Root removal only: site ID. Omit for the primary site.'),
  },
}

export async function unplaceSkript(args: { skriptId: string; collectionId?: string; siteId?: string }) {
  requireScope('content:write')
  const ctx = getMcpContext()
  console.log(`[mcp:unplace_skript] userId=${ctx.userId} skriptId=${args.skriptId} collectionId=${args.collectionId ?? '(root)'} client=${ctx.clientName}`)
  const result = await unplaceSkriptForUser(ctx.userId, args)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  }
}
