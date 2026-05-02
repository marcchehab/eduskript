import { ImageResponse } from 'next/og'
import { OG_SIZE, OG_CONTENT_TYPE, OgLayout, ogFonts } from '@/lib/seo/og-layout'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE
export const alt = 'Eduskript organization page'

interface Params {
  params: Promise<{ orgSlug: string }>
}

export default async function Image({ params }: Params) {
  const { orgSlug } = await params
  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: {
      name: true,
      description: true,
      pageTagline: true,
      showIcon: true,
      iconUrl: true,
    },
  }).catch(() => null)

  // Match the same SEO-tuned title source order as generateMetadata in
  // src/app/org/[orgSlug]/page.tsx so the OG card and the meta title align.
  const title = orgSlug === 'eduskript'
    ? 'Eduskript'
    : (org?.name || 'Eduskript')
  const subtitle = orgSlug === 'eduskript'
    ? 'Open-source platform for interactive lessons.'
    : (org?.pageTagline || org?.description || null)
  const iconUrl = org?.showIcon ? org?.iconUrl : null

  return new ImageResponse(
    <OgLayout title={title} subtitle={subtitle} iconUrl={iconUrl} />,
    { ...size, fonts: await ogFonts() },
  )
}
