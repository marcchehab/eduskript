/**
 * MCP tool: read_site_frontpage — read the FrontPage attached to a Site.
 *
 * With no organizationId, targets the authenticated teacher's own landing page
 * (the "Grüezi und willkommen" page shown under their pageSlug). With an
 * organizationId, targets that org's landing page (caller must be a member).
 * Returns null if the site has no FrontPage row yet.
 */

import { z } from 'zod'
import { getMcpContext } from '@/lib/mcp/context'
import { getSiteFrontPageForUser } from '@/lib/services/site-frontpages'

export const readSiteFrontpageConfig = {
  title: 'Read site frontpage',
  description:
    "Read the FrontPage (landing page) of a Site. With NO organizationId, reads the authenticated teacher's OWN landing page (shown under their pageSlug). With organizationId, reads that organization's landing page (caller must be a member). Returns the markdown content + isPublished, or null if no frontpage exists yet.",
  inputSchema: {
    organizationId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Omit to read your own teacher landing page. Set to an org ID (cuid) to read that organization's landing page."
      ),
    siteId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'When you own MULTIPLE sites, the specific site to read. Omit to use your primary site. Ignored if organizationId is set. Use list_my_sites to get IDs.'
      ),
  },
}

export async function readSiteFrontpage(args: { organizationId?: string; siteId?: string }) {
  const ctx = getMcpContext()
  console.log(
    `[mcp:read_site_frontpage] userId=${ctx.userId} organizationId=${args.organizationId ?? '(self)'} siteId=${args.siteId ?? '(primary)'}`
  )
  const frontPage = await getSiteFrontPageForUser(ctx.userId, {
    organizationId: args.organizationId,
    siteId: args.siteId,
  })

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(frontPage, null, 2),
      },
    ],
  }
}
