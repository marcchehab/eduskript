import { ImageResponse } from 'next/og'
import { OG_SIZE, OG_CONTENT_TYPE, OgLayout, ogFonts } from '@/lib/seo/og-layout'
import { getTeacherByUsernameDeduped } from '@/lib/cached-queries'
import { plainInlineText } from '@/lib/markdown'

export const runtime = 'nodejs'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE
export const alt = 'Eduskript page'

interface Params {
  params: Promise<{ domain: string }>
}

export default async function Image({ params }: Params) {
  const { domain } = await params
  const teacher = await getTeacherByUsernameDeduped(domain).catch(() => null)

  const title = teacher?.pageName || teacher?.name || 'Eduskript'
  const subtitle =
    teacher?.pageTagline ||
    teacher?.metaDescription ||
    (teacher?.pageDescription && plainInlineText(teacher.pageDescription)) ||
    teacher?.bio ||
    null

  return new ImageResponse(
    <OgLayout title={title} subtitle={subtitle} iconUrl={teacher?.pageIcon} />,
    { ...size, fonts: await ogFonts() },
  )
}
