/**
 * MCP tool: place_skript — put an existing skript into a collection or the root.
 *
 * Requires content:write. Adds the skript to a collection (at an optional
 * position) or as a top-level sidebar item, and ensures the container is in the
 * site's PageLayout. Requires author on the skript + edit on the collection.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { placeSkriptForUser } from '@/lib/services/skripts'

export const placeSkriptConfig = {
  title: 'Place skript in sidebar',
  description:
    'Place an existing skript in the sidebar: pass a collectionId to nest it under a collection (optionally at a given position), or omit it to add the skript as a top-level sidebar item. Idempotent — re-placing a skript already in the collection changes nothing. Does not remove the skript from other collections. Use `create_skript` to make a new one.',
  inputSchema: {
    skriptId: z.string().min(1).describe('ID of the skript to place.'),
    collectionId: z
      .string()
      .optional()
      .describe('Collection to nest the skript under. Omit to add it as a root sidebar item.'),
    position: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('0-based insert index within the collection. Defaults to the end.'),
  },
}

export async function placeSkript(args: {
  skriptId: string
  collectionId?: string
  position?: number
}) {
  requireScope('content:write')
  const ctx = getMcpContext()
  console.log(`[mcp:place_skript] userId=${ctx.userId} skriptId=${args.skriptId} collectionId=${args.collectionId ?? '(root)'} client=${ctx.clientName}`)
  const result = await placeSkriptForUser(ctx.userId, args, {
    editSource: 'mcp',
    editClient: ctx.clientName,
  })

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  }
}
