/**
 * MCP tool: delete_page — permanently delete a page.
 *
 * Requires content:write. Refuses when students have work on the page
 * (countStudentWorkOnPages) — that deletion stays a dashboard action. The
 * caller must echo the page title as `confirmTitle`, so the client has to
 * have read the page it is deleting.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import {
  ConflictError,
  ValidationError,
  countStudentWorkOnPages,
  deletePageForUser,
  getPageForUser,
} from '@/lib/services/pages'

export const deletePageConfig = {
  title: 'Delete page',
  description:
    'Permanently delete a page and its version history. Irreversible — only use when the teacher asked for it. `confirmTitle` must equal the page\'s current title exactly. Refused if any student has progress, submissions, scores or saved answers on the page; the teacher must delete those pages in the dashboard. To keep content but hide it, use `update_page_metadata` with isPublished=false instead.',
  inputSchema: {
    pageId: z.string().min(1).describe('Page to delete.'),
    confirmTitle: z.string().min(1).describe('The page\'s current title, exactly.'),
  },
}

export async function deletePage(args: { pageId: string; confirmTitle: string }) {
  requireScope('content:write')
  const ctx = getMcpContext()
  console.log(`[mcp:delete_page] userId=${ctx.userId} pageId=${args.pageId} client=${ctx.clientName}`)

  const page = await getPageForUser(ctx.userId, args.pageId)
  if (page.title !== args.confirmTitle) {
    throw new ValidationError(`confirmTitle does not match the page title "${page.title}"`)
  }
  const studentWork = await countStudentWorkOnPages([page.id], ctx.userId)
  if (studentWork > 0) {
    throw new ConflictError(`Page has ${studentWork} record(s) of student work. Delete it in the dashboard instead.`)
  }

  const result = await deletePageForUser(ctx.userId, args.pageId)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ ...result, title: page.title }, null, 2) }],
  }
}
