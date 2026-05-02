/**
 * MCP tool: read_skript — fetch a skript's metadata + page list.
 *
 * View permission gate (skript-author or collection-author both work).
 * Use this when the AI needs the full structure of one skript without
 * paging through every page; use `read_page` to actually load page content.
 */

import { z } from 'zod'
import { getMcpContext } from '@/lib/mcp/context'
import { getSkriptForUser } from '@/lib/services/skripts'

export const readSkriptConfig = {
  title: 'Read skript',
  description:
    'Read a single Eduskript skript by ID. Returns the skript metadata (title, slug, description, publish state) and the full ordered list of pages (id, title, slug, isPublished). Caller must have at least view permission.',
  inputSchema: {
    skriptId: z.string().min(1).describe('The Eduskript skript ID (cuid).'),
  },
}

export async function readSkript(args: { skriptId: string }) {
  const ctx = getMcpContext()
  console.log(`[mcp:read_skript] userId=${ctx.userId} skriptId=${args.skriptId}`)
  const { skript } = await getSkriptForUser(ctx.userId, args.skriptId)

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: skript.id,
            title: skript.title,
            slug: skript.slug,
            description: skript.description,
            isPublished: skript.isPublished,
            isUnlisted: skript.isUnlisted,
            updatedAt: skript.updatedAt,
            collections: skript.collectionSkripts
              .map((cs) => cs.collection?.title ?? null)
              .filter((t): t is string => t != null),
            pages: skript.pages.map((p) => ({
              id: p.id,
              title: p.title,
              slug: p.slug,
              order: p.order,
              isPublished: p.isPublished,
            })),
          },
          null,
          2
        ),
      },
    ],
  }
}
