/**
 * MCP tool: update_plugin — partial update of one of the caller's plugins.
 *
 * Unlike create_plugin (overwrite=true replaces name/description/manifest
 * too), omitted fields stay unchanged. An entryHtml change writes a
 * restorable PluginVersion (updatePluginForUser).
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { getOwnPluginBySlug, updatePluginForUser } from '@/lib/services/plugins'
import { ValidationError } from '@/lib/services/pages'

// Same cap as create_plugin.
const MAX_ENTRY_HTML_SIZE = 512 * 1024 // 512KB

export const updatePluginConfig = {
  title: 'Update plugin',
  description:
    'Change one of the caller\'s own plugins by slug. Only the fields you pass change. entryHtml must be the complete new HTML (max 512KB, same Plugin SDK contract as `create_plugin`); read it first with `read_plugin`. Each HTML change is saved as a restorable version; pages embedding the plugin pick it up immediately.',
  inputSchema: {
    slug: z.string().min(1).describe('Plugin slug.'),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    manifest: z.record(z.string(), z.unknown()).optional().describe('Replaces the whole manifest, e.g. { defaultHeight }.'),
    entryHtml: z.string().min(1).optional().describe('Complete new HTML body content.'),
    changeLog: z.string().max(300).optional().describe('Short note stored with the version.'),
  },
}

export async function updatePlugin(args: {
  slug: string
  name?: string
  description?: string
  manifest?: Record<string, unknown>
  entryHtml?: string
  changeLog?: string
}) {
  requireScope('content:write')
  const ctx = getMcpContext()
  console.log(`[mcp:update_plugin] userId=${ctx.userId} slug=${args.slug} client=${ctx.clientName}`)

  if (args.entryHtml !== undefined && args.entryHtml.length > MAX_ENTRY_HTML_SIZE) {
    throw new ValidationError(`entryHtml too large. Maximum is ${MAX_ENTRY_HTML_SIZE / 1024}KB.`)
  }

  const { slug, ...patch } = args
  const existing = await getOwnPluginBySlug(ctx.userId, slug)
  const updated = await updatePluginForUser(ctx.userId, existing.id, patch)
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          { id: updated.id, slug: updated.slug, name: updated.name, updatedAt: updated.updatedAt },
          null,
          2
        ),
      },
    ],
  }
}
