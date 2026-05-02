import { ImageResponse } from 'next/og'
import { OG_SIZE, OG_CONTENT_TYPE, OgLayout, ogFonts } from '@/lib/seo/og-layout'

export const runtime = 'nodejs'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE
export const alt = 'Eduskript — host interactive class material in your browser'

export default async function Image() {
  return new ImageResponse(
    (
      <OgLayout
        title="Eduskript"
        subtitle="Host interactive class material in your browser."
      />
    ),
    { ...size, fonts: await ogFonts() },
  )
}
