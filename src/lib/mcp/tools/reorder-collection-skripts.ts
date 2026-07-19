/**
 * MCP tool: reorder_collection_skripts — set the order of skripts in a collection.
 *
 * Requires content:write. `skriptIds` must be exactly the skripts currently in
 * the collection, in the desired order. Requires collection edit permission.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { reorderCollectionSkriptsForUser } from '@/lib/services/collections'

export const reorderCollectionSkriptsConfig = {
  title: 'Reorder skripts in a collection',
  description:
    'Set the sidebar order of the skripts inside a collection. `skriptIds` must list exactly the skripts currently in the collection, once each, in the desired top-to-bottom order. Use `read_collection` to see the current members.',
  inputSchema: {
    collectionId: z.string().min(1).describe('Collection whose skripts to reorder.'),
    skriptIds: z
      .array(z.string().min(1))
      .min(1)
      .describe('All skript IDs in the collection, in the desired order.'),
  },
}

export async function reorderCollectionSkripts(args: {
  collectionId: string
  skriptIds: string[]
}) {
  requireScope('content:write')
  const ctx = getMcpContext()
  console.log(`[mcp:reorder_collection_skripts] userId=${ctx.userId} collectionId=${args.collectionId} client=${ctx.clientName}`)
  const result = await reorderCollectionSkriptsForUser(ctx.userId, args.collectionId, args.skriptIds, {
    editSource: 'mcp',
    editClient: ctx.clientName,
  })

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  }
}
