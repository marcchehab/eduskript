import { ImageResponse } from 'next/og'
import { OG_SIZE, OG_CONTENT_TYPE, OgLayout, ogFonts } from '@/lib/seo/og-layout'
import { getOrgWithLayout, getOrgPublishedPage } from '@/lib/cached-queries'

export const runtime = 'nodejs'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE
export const alt = 'Eduskript page'

interface Params {
  params: Promise<{ orgSlug: string; skriptSlug: string; pageSlug: string }>
}

export default async function Image({ params }: Params) {
  const { orgSlug, skriptSlug, pageSlug } = await params
  const org = await getOrgWithLayout(orgSlug).catch(() => null)
  const content = org
    ? await getOrgPublishedPage(org.id, orgSlug, skriptSlug, pageSlug).catch(() => null)
    : null

  const title = content?.page.title || 'Page'
  const subtitle = content?.skript.title || null
  const footer = org?.name || null
  const iconUrl = org?.showIcon ? org?.iconUrl : null

  return new ImageResponse(
    <OgLayout title={title} subtitle={subtitle} footer={footer} iconUrl={iconUrl} />,
    { ...size, fonts: await ogFonts() },
  )
}
