import { ImageResponse } from 'next/og'
import { OG_SIZE, OG_CONTENT_TYPE, OgLayout } from '@/lib/seo/og-layout'
import { getTeacherByUsernameDeduped, getSkriptForPreview } from '@/lib/cached-queries'

export const runtime = 'nodejs'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE
export const alt = 'Eduskript skript'

interface Params {
  params: Promise<{ domain: string; skriptSlug: string }>
}

export default async function Image({ params }: Params) {
  const { domain, skriptSlug } = await params
  const teacher = await getTeacherByUsernameDeduped(domain).catch(() => null)
  const skript = teacher
    ? await getSkriptForPreview(teacher.id, skriptSlug).catch(() => null)
    : null

  const title = skript?.title || 'Skript'
  const subtitle = skript?.description || null
  const footer = teacher?.pageName || teacher?.name || null

  return new ImageResponse(
    <OgLayout title={title} subtitle={subtitle} footer={footer} />,
    { ...size },
  )
}
