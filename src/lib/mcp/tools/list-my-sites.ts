/**
 * MCP tool: list_my_sites
 *
 * Returns the sites the calling teacher owns, ordered primary-first (lowest
 * Site.order). A teacher normally has exactly one; superadmin-granted extra
 * sites appear after it. Use the returned ids as the `siteId` argument to
 * read_site_frontpage / update_site_frontpage when you own more than one.
 */

import { getMcpContext } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'

export const listMySitesConfig = {
  title: 'List my sites',
  description:
    "List the sites (public pages) the authenticated teacher owns, primary first. " +
    "Returns id, slug, pageName, and whether it's the primary site. Pass an id as " +
    "`siteId` to read_site_frontpage / update_site_frontpage to target a specific " +
    "site when you own more than one. Org sites are not included here.",
  inputSchema: {},
}

export async function listMySites() {
  const ctx = getMcpContext()
  console.log(`[mcp:list_my_sites] userId=${ctx.userId}`)
  const sites = await prisma.site.findMany({
    where: { userId: ctx.userId },
    orderBy: PRIMARY_SITE_ORDER,
    select: { id: true, slug: true, pageName: true, order: true },
  })

  const summary = sites.map((s, i) => ({
    id: s.id,
    slug: s.slug,
    pageName: s.pageName,
    isPrimary: i === 0,
  }))

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(summary, null, 2),
      },
    ],
  }
}
