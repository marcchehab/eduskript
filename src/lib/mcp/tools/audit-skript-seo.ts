/**
 * MCP tool: audit_skript_seo — bulk SEO snapshot for one skript.
 *
 * Returns the skript's metadata, frontpage status, and a per-page row with
 * content excerpt + flagged issues (title-too-short, content-too-short,
 * excerpt-too-short, unpublished). Designed so an AI can scan a whole
 * skript in one call and propose targeted edits via update_page,
 * update_skript, or update_skript_frontpage.
 */

import { z } from 'zod'
import { getMcpContext } from '@/lib/mcp/context'
import { auditSkriptSeoForUser } from '@/lib/services/skripts'

export const auditSkriptSeoConfig = {
  title: 'Audit skript SEO',
  description:
    'Read-only SEO snapshot of a skript: metadata, frontpage state, and a per-page summary with content excerpts and issue flags. Use this before bulk-editing descriptions, titles, or frontpages — it surfaces every page that needs attention without requiring N round-trips. Caller needs view permission on the skript.',
  inputSchema: {
    skriptId: z.string().min(1).describe('The Eduskript skript ID (cuid).'),
  },
}

export async function auditSkriptSeo(args: { skriptId: string }) {
  const ctx = getMcpContext()
  console.log(
    `[mcp:audit_skript_seo] userId=${ctx.userId} skriptId=${args.skriptId}`
  )
  const audit = await auditSkriptSeoForUser(ctx.userId, args.skriptId)

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(audit, null, 2),
      },
    ],
  }
}
