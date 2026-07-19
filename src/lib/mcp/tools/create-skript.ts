/**
 * MCP tool: create_skript — create a skript and place it in the sidebar.
 *
 * Requires content:write. Creates the skript (caller becomes author), optionally
 * inside a collection, publishes it by default, and ensures the container is in
 * the site's PageLayout so it shows in the sidebar. Add pages with `create_page`.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { createSkriptForUser } from '@/lib/services/skripts'

export const createSkriptConfig = {
  title: 'Create skript',
  description:
    "Create a new skript (a module of pages, shown as one sidebar entry) and place it in the sidebar. Pass a collectionId to nest it under a collection, or omit it to add the skript as a top-level sidebar item. Published by default so it appears immediately — pass publish=false for a draft. The caller becomes the skript's author. Add pages afterwards with `create_page`.",
  inputSchema: {
    title: z.string().min(1).describe('Human-readable skript title.'),
    slug: z
      .string()
      .optional()
      .describe('URL slug (lowercase, hyphenated). Defaults to a slug from the title. Normalized.'),
    description: z
      .string()
      .optional()
      .describe('Optional plain-text description (used as og:description on the frontpage).'),
    collectionId: z
      .string()
      .optional()
      .describe('Collection to nest the skript under. Omit to add it as a root sidebar item.'),
    publish: z
      .boolean()
      .optional()
      .describe('Publish immediately (default true). false = draft, hidden from the public sidebar.'),
  },
}

export async function createSkript(args: {
  title: string
  slug?: string
  description?: string
  collectionId?: string
  publish?: boolean
}) {
  requireScope('content:write')
  const ctx = getMcpContext()
  console.log(`[mcp:create_skript] userId=${ctx.userId} collectionId=${args.collectionId ?? '(root)'} client=${ctx.clientName}`)
  const skript = await createSkriptForUser(ctx.userId, args, {
    editSource: 'mcp',
    editClient: ctx.clientName,
  })

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: skript.id,
            title: skript.title,
            slug: skript.slug,
            isPublished: skript.isPublished,
            collectionId: args.collectionId ?? null,
          },
          null,
          2
        ),
      },
    ],
  }
}
