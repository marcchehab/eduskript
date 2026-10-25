/**
 * MCP tool: delete_skript — permanently delete a skript with all its pages.
 *
 * Requires content:write. Same guards as delete_page: `confirmTitle` must
 * match, and any student work on any of its pages refuses the call.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { ConflictError, ValidationError, countStudentWorkOnPages } from '@/lib/services/pages'
import { deleteSkriptForUser, getSkriptForUser } from '@/lib/services/skripts'

export const deleteSkriptConfig = {
  title: 'Delete skript',
  description:
    'Permanently delete a skript including ALL its pages, version histories and files, and remove it from every collection and sidebar. Irreversible — only use when the teacher asked for it. `confirmTitle` must equal the skript\'s current title exactly. Refused if any student has work on any of its pages. To only take it off a sidebar, use `unplace_skript`; to hide it, `update_skript` with isPublished=false.',
  inputSchema: {
    skriptId: z.string().min(1).describe('Skript to delete.'),
    confirmTitle: z.string().min(1).describe('The skript\'s current title, exactly.'),
  },
}

export async function deleteSkript(args: { skriptId: string; confirmTitle: string }) {
  requireScope('content:write')
  const ctx = getMcpContext()
  console.log(`[mcp:delete_skript] userId=${ctx.userId} skriptId=${args.skriptId} client=${ctx.clientName}`)

  const { skript } = await getSkriptForUser(ctx.userId, args.skriptId)
  if (skript.title !== args.confirmTitle) {
    throw new ValidationError(`confirmTitle does not match the skript title "${skript.title}"`)
  }
  const studentWork = await countStudentWorkOnPages(skript.pages.map(p => p.id), ctx.userId)
  if (studentWork > 0) {
    throw new ConflictError(`Skript has ${studentWork} record(s) of student work. Delete it in the dashboard instead.`)
  }

  const result = await deleteSkriptForUser(ctx.userId, args.skriptId)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ ...result, title: skript.title }, null, 2) }],
  }
}
