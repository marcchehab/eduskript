/**
 * MCP tool: list_my_skripts
 *
 * Returns the skripts the calling teacher authors (directly or via collection
 * authorship). Scoped by the access-token's userId via the MCP context.
 */

import { z } from 'zod'
import { getMcpContext } from '@/lib/mcp/context'
import { listSkriptsForUser } from '@/lib/services/skripts'

export const listMySkriptsConfig = {
  title: 'List my skripts',
  description:
    'List all Eduskript skripts the authenticated teacher authors or co-authors. ' +
    'Returns id, title, slug, page count, and the parent collection title.',
  inputSchema: {
    includeShared: z
      .boolean()
      .optional()
      .describe(
        'When true (default), include skripts inherited via collection authorship. When false, return only directly-authored skripts.'
      ),
  },
}

export async function listMySkripts(args: { includeShared?: boolean }) {
  const ctx = getMcpContext()
  console.log(`[mcp:list_my_skripts] userId=${ctx.userId}`)
  const skripts = await listSkriptsForUser(ctx.userId, {
    includeShared: args.includeShared ?? true,
  })

  const summary = skripts.map((s) => ({
    id: s.id,
    title: s.title,
    slug: s.slug,
    description: s.description ?? null,
    pageCount: s.pages.length,
    collections: s.collectionSkripts
      .map((cs) => cs.collection?.title ?? null)
      .filter((t): t is string => t != null),
    isDirectAuthor: s.authors.some((a) => a.userId === ctx.userId),
  }))

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(summary, null, 2),
      },
    ],
  }
}
