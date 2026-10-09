import { ImageResponse } from 'next/og'
import { OG_SIZE, OG_CONTENT_TYPE, OgLayout, ogFonts } from '@/lib/seo/og-layout'
import { getOrgWithLayout } from '@/lib/cached-queries'
import { prisma } from '@/lib/prisma'
import { placedOnSiteWhere } from '@/lib/site-access'

export const runtime = 'nodejs'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE
export const alt = 'Eduskript skript'

interface Params {
  params: Promise<{ orgSlug: string; skriptSlug: string }>
}

export default async function Image({ params }: Params) {
  const { orgSlug, skriptSlug } = await params
  const org = await getOrgWithLayout(orgSlug).catch(() => null)

  // Same placement rule as the page (bughunt #39): skripts placed on the org site.
  const skript = org
    ? await prisma.skript.findFirst({
        where: {
          slug: skriptSlug,
          isPublished: true,
          ...(await placedOnSiteWhere(org.siteId)),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { title: true, description: true },
      }).catch(() => null)
    : null

  const title = skript?.title || 'Skript'
  const subtitle = skript?.description || null
  const footer = org?.name || null
  const iconUrl = org?.showIcon ? org?.iconUrl : null

  return new ImageResponse(
    <OgLayout title={title} subtitle={subtitle} footer={footer} iconUrl={iconUrl} />,
    { ...size, fonts: await ogFonts() },
  )
}
