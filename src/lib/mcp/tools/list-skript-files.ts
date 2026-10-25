/**
 * MCP tool: list_skript_files — the files and videos a skript's markdown can
 * reference by name. Requires content:read.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { listSkriptFilesForUser } from '@/lib/services/skripts'

export const listSkriptFilesConfig = {
  title: 'List skript files',
  description:
    'List the files (images, attachments, .excalidraw drawings and their generated .light.svg/.dark.svg) and videos of a skript. Markdown references them by name. Check this before uploading to avoid duplicates, and to get a fileId for `delete_asset`.',
  inputSchema: {
    skriptId: z.string().min(1).describe('Skript whose files to list.'),
  },
}

export async function listSkriptFiles(args: { skriptId: string }) {
  requireScope('content:read')
  const ctx = getMcpContext()
  console.log(`[mcp:list_skript_files] userId=${ctx.userId} skriptId=${args.skriptId} client=${ctx.clientName}`)
  const result = await listSkriptFilesForUser(ctx.userId, args.skriptId)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  }
}
