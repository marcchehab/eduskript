/**
 * MCP tool: search_my_content — case-insensitive substring search across the
 * caller's authored pages (title + content). Capped at 20 hits.
 */

import { z } from 'zod'
import { getMcpContext } from '@/lib/mcp/context'
import { searchPagesForUser } from '@/lib/services/pages'

export const searchMyContentConfig = {
  title: 'Search my content',
  description:
    'Search across all pages the authenticated teacher authors. Case-insensitive substring match on title + content. Returns up to 20 hits ordered by recency.',
  inputSchema: {
    query: z.string().min(1).describe('The text to search for.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Maximum number of hits to return (default 20, max 20).'),
  },
}

export async function searchMyContent(args: { query: string; limit?: number }) {
  const ctx = getMcpContext()
  const pages = await searchPagesForUser(
    ctx.userId,
    args.query,
    Math.min(args.limit ?? 20, 20)
  )

  const hits = pages.map((p) => ({
    id: p.id,
    title: p.title,
    slug: p.slug,
    isPublished: p.isPublished,
    skriptId: p.skript.id,
    skriptTitle: p.skript.title,
    snippet: extractSnippet(p.content, args.query),
    updatedAt: p.updatedAt,
  }))

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ count: hits.length, hits }, null, 2),
      },
    ],
  }
}

function extractSnippet(content: string, query: string): string {
  const lower = content.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  if (idx === -1) return content.slice(0, 200)
  const start = Math.max(0, idx - 60)
  const end = Math.min(content.length, idx + query.length + 60)
  return (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '')
}
