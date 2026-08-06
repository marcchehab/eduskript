/**
 * MCP tool: resolve_page_url — turn a pasted Eduskript URL (dashboard editor,
 * public page, or the /c/ org shorthand) into the page it points at, so the
 * caller doesn't have to fall back to search_my_content for a URL a teacher
 * just pasted.
 */

import { z } from 'zod'
import { getMcpContext } from '@/lib/mcp/context'
import { resolvePageUrlForUser } from '@/lib/services/pages'

export const resolvePageUrlConfig = {
  title: 'Resolve page URL',
  description:
    'Turn a pasted Eduskript URL into the page it points at — the dashboard editor URL ' +
    '(/dashboard/skripts/{skript}/pages/{page}/edit), a public page URL on a custom domain, ' +
    'or the eduskript.org/c/{skript}/{page} org shorthand. Returns the same shape as read_page. ' +
    'Prefer this over search_my_content when the teacher gave you a URL directly.',
  inputSchema: {
    url: z
      .string()
      .min(1)
      .describe(
        'A URL or path the teacher pasted, e.g. https://informatikgarten.ch/dashboard/skripts/programmieren-1/pages/was-erschaffen-wir/edit'
      ),
  },
}

export async function resolvePageUrl(args: { url: string }) {
  const ctx = getMcpContext()
  const page = await resolvePageUrlForUser(ctx.userId, args.url)

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: page.id,
            title: page.title,
            slug: page.slug,
            description: page.description,
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
