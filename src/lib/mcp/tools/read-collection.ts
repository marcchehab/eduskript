/**
 * MCP tool: read_collection — fetch a collection's metadata + skript list.
 *
 * View permission gate (any collection author works).
 */

import { z } from 'zod'
import { getMcpContext } from '@/lib/mcp/context'
import { getCollectionForUser } from '@/lib/services/collections'

export const readCollectionConfig = {
  title: 'Read collection',
  description:
    'Read a single Eduskript collection by ID. Returns metadata (title, slug, description, accentColor) and the skripts contained in the collection.',
  inputSchema: {
    collectionId: z.string().min(1).describe('The Eduskript collection ID (cuid).'),
  },
}

export async function readCollection(args: { collectionId: string }) {
  const ctx = getMcpContext()
  console.log(
    `[mcp:read_collection] userId=${ctx.userId} collectionId=${args.collectionId}`
  )
  const { collection } = await getCollectionForUser(ctx.userId, args.collectionId)

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: collection.id,
            title: collection.title,
            slug: collection.slug,
            description: collection.description,
            accentColor: collection.accentColor,
            updatedAt: collection.updatedAt,
            skripts: collection.collectionSkripts.map((cs) => ({
              id: cs.skript.id,
              title: cs.skript.title,
              slug: cs.skript.slug,
              description: cs.skript.description,
              isPublished: cs.skript.isPublished,
              isUnlisted: cs.skript.isUnlisted,
              order: cs.order,
            })),
          },
          null,
          2
        ),
      },
    ],
  }
}
