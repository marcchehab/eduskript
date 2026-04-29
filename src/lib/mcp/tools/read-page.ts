/**
 * MCP tool: read_page — fetch a page's full content if the actor can view it.
 */

import { z } from 'zod'
import { getMcpContext } from '@/lib/mcp/context'
import { getPageForUser } from '@/lib/services/pages'

export const readPageConfig = {
  title: 'Read page',
  description:
    'Read the full markdown content of a single Eduskript page by ID. The caller must have view permission on the page (directly or via skript / collection authorship).',
  inputSchema: {
    pageId: z
      .string()
      .min(1)
      .describe('The Eduskript page ID (cuid). Get IDs from list_my_skripts or search_my_content.'),
  },
}

export async function readPage(args: { pageId: string }) {
  const ctx = getMcpContext()
  console.log(`[mcp:read_page] userId=${ctx.userId} pageId=${args.pageId}`)
  const page = await getPageForUser(ctx.userId, args.pageId)

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: page.id,
            title: page.title,
            slug: page.slug,
            isPublished: page.isPublished,
            content: page.content,
            updatedAt: page.updatedAt,
            skript: {
              id: page.skript.id,
              title: page.skript.title,
              slug: page.skript.slug,
            },
          },
          null,
          2
        ),
      },
    ],
  }
}
