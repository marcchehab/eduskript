import { NextRequest, NextResponse } from 'next/server'
import { getTemplateSvgs } from '@/lib/plugin-templates/server'

/** GET ?slugs=a,b — SVG bodies for the plugin editor preview. Public: templates are public data. */
export async function GET(request: NextRequest) {
  const slugs = (request.nextUrl.searchParams.get('slugs') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20)
  return NextResponse.json({ svgs: await getTemplateSvgs(slugs) }, { headers: { 'Cache-Control': 'public, max-age=300' } })
}
