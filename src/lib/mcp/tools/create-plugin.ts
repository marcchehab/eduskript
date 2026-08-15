/**
 * MCP tool: create_plugin — create or update a self-contained HTML plugin.
 *
 * Requires content:write scope. Upserts by slug (scoped to the caller as
 * author) via upsertPluginForUser, the same service the dashboard's
 * POST/PUT /api/plugins routes use — same validation, same storage. Meant
 * for handing Claude-authored HTML (including a Claude Artifact's markup,
 * ported to the Plugin SDK contract — see PLUGIN_AUTHORING_PROMPT) straight
 * into a plugin, then embedding it with update_page_content via the
 * returned `<plugin src="..."/>` tag.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { upsertPluginForUser } from '@/lib/services/plugins'
import { ValidationError } from '@/lib/services/pages'
import { PLUGIN_AUTHORING_PROMPT } from '@/lib/ai/plugin-prompt'

// entryHtml size cap — plugin HTML is a UI fragment, not a file upload.
const MAX_ENTRY_HTML_SIZE = 512 * 1024 // 512KB

export const createPluginConfig = {
  title: 'Create or update plugin',
  description:
    `Create or update a self-contained HTML plugin (rendered in a sandboxed iframe, ` +
    `embeddable via \`<plugin src="ownerSlug/slug" />\`). Upserts by slug under the ` +
    `caller's own account — pass overwrite=true to replace an existing plugin with ` +
    `that slug. entryHtml is capped at 512KB and must follow the Plugin SDK contract:\n\n` +
    PLUGIN_AUTHORING_PROMPT,
  inputSchema: {
    slug: z.string().min(1).describe('Plugin slug (lowercase, hyphenated, unique per author), e.g. "fraction-visualizer".'),
    name: z.string().min(1).describe('Human-readable plugin name.'),
    entryHtml: z.string().min(1).describe('Self-contained HTML/CSS/JS body content (no <!DOCTYPE>/<html>/<head>/<body> — the host wraps it). Max 512KB.'),
    description: z.string().optional().describe('Optional plain-text description.'),
    manifest: z.record(z.string(), z.unknown()).optional().describe('Optional config, e.g. { defaultHeight }.'),
    overwrite: z.boolean().optional().describe('Replace an existing plugin with this slug (default false).'),
  },
}

export async function createPlugin(args: {
  slug: string
  name: string
  entryHtml: string
  description?: string
  manifest?: Record<string, unknown>
  overwrite?: boolean
}) {
  requireScope('content:write')
  const ctx = getMcpContext()
  console.log(`[mcp:create_plugin] userId=${ctx.userId} slug=${args.slug} client=${ctx.clientName}`)

  if (args.entryHtml.length > MAX_ENTRY_HTML_SIZE) {
    throw new ValidationError(`entryHtml too large. Maximum is ${MAX_ENTRY_HTML_SIZE / 1024}KB.`)
  }

  const { plugin, created } = await upsertPluginForUser(ctx.userId, args)

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: plugin.id,
            slug: plugin.slug,
            name: plugin.name,
            created,
            embedTag: `<plugin src="${plugin.author.pageSlug ?? ''}/${plugin.slug}" />`,
          },
          null,
          2
        ),
      },
    ],
  }
}
