/**
 * MCP tool: read_plugin — one of the caller's plugins incl. raw entryHtml
 * (<es-template> tags NOT expanded, i.e. what update_plugin writes).
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { getOwnPluginBySlug } from '@/lib/services/plugins'

export const readPluginConfig = {
  title: 'Read plugin',
  description:
    'Read one of the caller\'s own plugins by slug, including its raw entryHtml and manifest. Read before `update_plugin`.',
  inputSchema: {
    slug: z.string().min(1).describe('Plugin slug.'),
  },
}

export async function readPlugin(args: { slug: string }) {
  requireScope('content:read')
  const ctx = getMcpContext()
  console.log(`[mcp:read_plugin] userId=${ctx.userId} slug=${args.slug} client=${ctx.clientName}`)
  const plugin = await getOwnPluginBySlug(ctx.userId, args.slug)
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: plugin.id,
            slug: plugin.slug,
            name: plugin.name,
            description: plugin.description,
            manifest: plugin.manifest,
            updatedAt: plugin.updatedAt,
            embedTag: `<plugin src="${plugin.author.pageSlug ?? ''}/${plugin.slug}" />`,
            entryHtml: plugin.entryHtml,
          },
          null,
          2
        ),
      },
    ],
  }
}
