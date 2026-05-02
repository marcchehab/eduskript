/**
 * MCP tool: update_skript — partial update for skript metadata.
 *
 * Permits editing title, description (the field used in collection cards
 * and as a SEO fallback), slug, and publish state. Requires content:write.
 *
 * Description quality directly affects og:description on every content
 * page that lacks its own page-content excerpt — this tool exists so the
 * AI can sweep skript-level metadata in bulk.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { updateSkriptForUser } from '@/lib/services/skripts'

export const updateSkriptConfig = {
  title: 'Update skript',
  description:
    'Update an Eduskript skript. At least one of {title, description, slug, isPublished, isUnlisted} must be provided. Caller must be a direct skript author (collection-author inheritance is view-only). The skript description shows up in collection list views and is a SEO description fallback for content pages without a usable content excerpt.',
  inputSchema: {
    skriptId: z.string().min(1),
    title: z.string().min(1).optional(),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('Plain-text skript description. Pass null to clear.'),
    slug: z.string().min(1).optional(),
    isPublished: z.boolean().optional(),
    isUnlisted: z.boolean().optional(),
  },
}

export async function updateSkript(args: {
  skriptId: string
  title?: string
  description?: string | null
  slug?: string
  isPublished?: boolean
  isUnlisted?: boolean
}) {
  requireScope('content:write')
  const ctx = getMcpContext()
  const { skriptId, ...patch } = args
  const updated = await updateSkriptForUser(ctx.userId, skriptId, patch, {
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
            isPublished: updated.isPublished,
            isUnlisted: updated.isUnlisted,
            updatedAt: updated.updatedAt,
          },
          null,
          2
        ),
      },
    ],
  }
}
