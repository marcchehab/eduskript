/**
 * MCP tool: list_my_plugins — the caller's own plugins (no HTML).
 */

import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { listPluginsForUser } from '@/lib/services/plugins'

export const listMyPluginsConfig = {
  title: 'List my plugins',
  description:
    'List the caller\'s own HTML plugins (slug, name, description, updatedAt). Use `read_plugin` for a plugin\'s HTML and `update_plugin` to change it.',
  inputSchema: {},
}

export async function listMyPlugins() {
  requireScope('content:read')
  const ctx = getMcpContext()
  console.log(`[mcp:list_my_plugins] userId=${ctx.userId} client=${ctx.clientName}`)
  const plugins = await listPluginsForUser(ctx.userId)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ plugins }, null, 2) }],
  }
}
