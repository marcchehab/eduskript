import { ImageResponse } from 'next/og'
import { OG_SIZE, OG_CONTENT_TYPE, OgLayout, ogFonts } from '@/lib/seo/og-layout'
import { prisma } from '@/lib/prisma'
import { plainInlineText } from '@/lib/markdown'

export const runtime = 'nodejs'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE
export const alt = 'Eduskript organization page'

interface Params {
  params: Promise<{ orgSlug: string }>
}

export default async function Image({ params }: Params) {
  const { orgSlug } = await params
  // Page-display fields all live on Site now.
  const orgSite = await prisma.site.findUnique({
    where: { slug: orgSlug },
    select: {
      pageDescription: true,
      pageTagline: true,
      pageIcon: true,
      showIcon: true,
      organization: { select: { name: true } },
    },
  }).catch(() => null)

  // Same sources as generateMetadata in src/app/org/[orgSlug]/page.tsx so the
  // OG card and the meta title align: name, then tagline (falls back to the
  // description). Both are set in /dashboard/org/<id>/settings.
  const title = orgSite?.organization?.name || 'Eduskript'
  const subtitle = orgSite?.pageTagline
    || (orgSite?.pageDescription && plainInlineText(orgSite.pageDescription))
    || null
  const iconUrl = orgSite?.showIcon ? orgSite?.pageIcon : null

  return new ImageResponse(
    <OgLayout title={title} subtitle={subtitle} iconUrl={iconUrl} />,
    { ...size, fonts: await ogFonts() },
  )
}
