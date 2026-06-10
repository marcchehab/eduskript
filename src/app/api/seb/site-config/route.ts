import { NextRequest, NextResponse } from 'next/server'
import { gzipSync } from 'zlib'
import { generateSEBConfig, getSEBMimeType, getSEBFilename } from '@/lib/seb'

/**
 * GET /api/seb/site-config?from=<path>
 *
 * Site-level SEB configuration for class lockdown (anti-distraction). Unlike the
 * exam config, this carries NO auth token: it just opens the teacher's site at
 * `from` inside SEB, where the student logs in normally (the config disables URL
 * filtering, so OAuth works). Contains no secrets, so it needs no auth — SEB
 * fetches it over the cookieless sebs:// protocol.
 *
 * `from` must be a same-site absolute path (starts with a single "/"). Anything
 * else falls back to the site root to avoid pointing SEB at an arbitrary origin.
 */
export async function GET(request: NextRequest) {
  try {
    const rawFrom = request.nextUrl.searchParams.get('from') || '/'
    // Only allow same-site paths: "/foo" yes; "//evil.com" or "https://…" no.
    const from = rawFrom.startsWith('/') && !rawFrom.startsWith('//') ? rawFrom : '/'

    const host = request.headers.get('host') || 'eduskript.org'
    const protocol = host.startsWith('localhost') ? 'http' : 'https'
    const startUrl = `${protocol}://${host}${from}`

    const isDevelopment = process.env.NODE_ENV !== 'production'
    const sebConfigXml = generateSEBConfig(startUrl, 'Eduskript', { isDevelopment })
    const filename = getSEBFilename('eduskript')

    // SEB file format: "plnd" prefix (4 bytes) + gzip-compressed XML.
    // See: https://safeexambrowser.org/developer/seb-file-format.html
    const compressed = gzipSync(Buffer.from(sebConfigXml, 'utf-8'))
    const sebFile = Buffer.concat([Buffer.from('plnd', 'utf-8'), compressed])

    return new NextResponse(sebFile, {
      status: 200,
      headers: {
        'Content-Type': getSEBMimeType(),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('Error generating site SEB config:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
