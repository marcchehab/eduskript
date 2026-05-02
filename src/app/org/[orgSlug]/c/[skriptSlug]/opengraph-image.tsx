import { ImageResponse } from 'next/og'
import { OG_SIZE, OG_CONTENT_TYPE, OgLayout, ogFonts } from '@/lib/seo/og-layout'
import { getOrgWithLayout } from '@/lib/cached-queries'
import { prisma } from '@/lib/prisma'

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

  // No org-skript helper exists, but the slug is unique per org-admin scope.
  // Same OR-clause as getOrgPublishedPage for ownership.
  const skript = org
    ? await prisma.skript.findFirst({
        where: {
          slug: skriptSlug,
          isPublished: true,
          OR: [
            { authors: { some: { user: { organizationMemberships: { some: { organizationId: org.id, role: { in: ['owner', 'admin'] } } } } } } },
            { collectionSkripts: { some: { collection: { authors: { some: { user: { organizationMemberships: { some: { organizationId: org.id, role: { in: ['owner', 'admin'] } } } } } } } } } },
          ],
        },
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
