/**
 * MCP tool: delete_asset — delete one skript file. Refuses while pages still
 * reference it by name unless force=true.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { deleteSkriptFileForUser } from '@/lib/services/skripts'

export const deleteAssetConfig = {
  title: 'Delete skript file',
  description:
    'Delete a file from a skript (get the fileId from `list_skript_files`). Deleting an .excalidraw file also deletes its generated SVGs. Refused while a page of the skript references the file by name; pass force=true only if the teacher accepts broken references.',
  inputSchema: {
    fileId: z.string().min(1).describe('File to delete.'),
    force: z.boolean().optional().describe('Delete even if pages still reference it (default false).'),
  },
}

export async function deleteAsset(args: { fileId: string; force?: boolean }) {
  requireScope('content:write')
  const ctx = getMcpContext()
  console.log(`[mcp:delete_asset] userId=${ctx.userId} fileId=${args.fileId} force=${!!args.force} client=${ctx.clientName}`)
  const result = await deleteSkriptFileForUser(ctx.userId, args.fileId, { force: args.force })
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  }
}
