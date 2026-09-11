import { ImageResponse } from 'next/og'
import { OG_SIZE, OG_CONTENT_TYPE, OgLayout, ogFonts } from '@/lib/seo/og-layout'
import { getTeacherByUsernameDeduped, getPublishedPage } from '@/lib/cached-queries'

export const runtime = 'nodejs'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE
export const alt = 'Eduskript page'

interface Params {
  params: Promise<{ domain: string; skriptSlug: string; pageSlug: string }>
}

export default async function Image({ params }: Params) {
  const { domain, skriptSlug, pageSlug } = await params
  const teacher = await getTeacherByUsernameDeduped(domain).catch(() => null)
  const content = teacher
    ? await getPublishedPage(teacher.id, skriptSlug, pageSlug, domain).catch(() => null)
    : null

  const title = content?.page.title || 'Page'
  const subtitle = content?.skript.title || null
  const footer = teacher?.pageName || teacher?.name || null

  return new ImageResponse(
    <OgLayout title={title} subtitle={subtitle} footer={footer} iconUrl={teacher?.pageIcon} />,
    { ...size, fonts: await ogFonts() },
  )
}
