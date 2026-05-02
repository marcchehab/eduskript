/**
 * MCP tool: update_collection — partial update for collection metadata.
 *
 * Caller must be a direct collection author. Requires content:write.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { updateCollectionForUser } from '@/lib/services/collections'

export const updateCollectionConfig = {
  title: 'Update collection',
  description:
    'Update an Eduskript collection. At least one of {title, description, slug, accentColor} must be provided. Caller must be a collection author.',
  inputSchema: {
    collectionId: z.string().min(1),
    title: z.string().min(1).optional(),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('Plain-text collection description. Pass null to clear.'),
    slug: z.string().min(1).optional(),
    accentColor: z
      .string()
      .nullable()
      .optional()
      .describe('Hex colour (e.g. "#3b82f6") used in the sidebar. Null to clear.'),
  },
}

export async function updateCollection(args: {
  collectionId: string
  title?: string
  description?: string | null
  slug?: string
  accentColor?: string | null
}) {
  requireScope('content:write')
  const ctx = getMcpContext()
  const { collectionId, ...patch } = args
  const updated = await updateCollectionForUser(ctx.userId, collectionId, patch, {
    editSource: 'mcp',
    editClient: ctx.clientName,
  })

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: updated.id,
            title: updated.title,
            description: updated.description,
            slug: updated.slug,
            accentColor: updated.accentColor,
            updatedAt: updated.updatedAt,
          },
          null,
          2
        ),
      },
    ],
  }
}
