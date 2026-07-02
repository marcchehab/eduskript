/**
 * MCP tool: update_site_frontpage — upsert a Site's FrontPage row.
 *
 * With no organizationId, targets the authenticated teacher's own landing page;
 * with an organizationId, targets that org's landing page (caller must be org
 * owner/admin). Creates the FrontPage if absent; updates content and/or publish
 * state otherwise. Every content change appends a FrontPageVersion row.
 * Requires content:write.
 *
 * **Before rewriting frontpage content, call `get_eduskript_context` once
 * per session** — it returns the markdown syntax reference (callouts, code
 * editors, math, etc.) the platform expects.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { upsertSiteFrontPageForUser } from '@/lib/services/site-frontpages'

export const updateSiteFrontpageConfig = {
  title: 'Update site frontpage',
  description:
    "Upsert the FrontPage (landing page) of a Site. With NO organizationId, edits the authenticated teacher's OWN landing page (shown under their pageSlug); with organizationId, edits that organization's landing page (caller must be org owner/admin). At least one of {content, isPublished} must be provided. Content changes auto-create a new FrontPageVersion. **Before rewriting content, call `get_eduskript_context` once** for the markdown syntax reference.",
  inputSchema: {
    organizationId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Omit to edit your own teacher landing page. Set to an org ID (cuid) to edit that organization's landing page (requires owner/admin)."
      ),
    content: z
      .string()
      .optional()
      .describe('Full markdown content. Replaces existing content.'),
    isPublished: z.boolean().optional(),
  },
}

export async function updateSiteFrontpage(args: {
  organizationId?: string
  content?: string
  isPublished?: boolean
}) {
  requireScope('content:write')
  const ctx = getMcpContext()
  const { organizationId, ...patch } = args
  const { frontPage, contentChanged } = await upsertSiteFrontPageForUser(
    ctx.userId,
    { organizationId },
    patch,
    { editSource: 'mcp', editClient: ctx.clientName }
  )

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: frontPage.id,
            isPublished: frontPage.isPublished,
            updatedAt: frontPage.updatedAt,
            contentChanged,
          },
          null,
          2
        ),
      },
    ],
  }
}
