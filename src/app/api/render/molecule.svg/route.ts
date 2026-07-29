import { NextRequest } from 'next/server'
import { isPlausibleSmiles, renderMolecule, type MoleculeTheme } from '@/lib/chem/molecule-svg'

/**
 * GET /api/render/molecule.svg?smiles=CCO&w=420&h=300&theme=light
 *
 * Structural formula for a SMILES string. Public and unauthenticated on
 * purpose: the images sit on public skript pages, and the response depends on
 * nothing but the query — no database, no user data.
 *
 * Everything about the picture is in the URL, so the answer never changes for a
 * given URL and can be cached hard (a year, immutable). That is the whole point
 * of the route: `O` renders once per browser, not once per page view, and the
 * 1.1 MB openchemlib build stays on the server.
 */
export const runtime = 'nodejs'

const YEAR = 60 * 60 * 24 * 365

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const smiles = (params.get('smiles') ?? '').trim()
  const width = Number(params.get('w') ?? 420)
  const height = Number(params.get('h') ?? 300)
  const theme: MoleculeTheme = params.get('theme') === 'dark' ? 'dark' : 'light'

  if (!isPlausibleSmiles(smiles)) {
    return errorImage('Invalid SMILES', width, height)
  }

  const result = renderMolecule({ smiles, width, height, theme })
  if ('error' in result) {
    return errorImage(result.error, width, height)
  }

  return new Response(result.svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': `public, max-age=${YEAR}, immutable`,
    },
  })
}

/**
 * A broken SMILES answers with a picture of the problem, not with a 4xx: the
 * author is looking at an `<img>`, and a failed request shows nothing but a
 * broken-image icon. Not cached, so a fixed typo takes effect immediately.
 */
function errorImage(message: string, width: number, height: number): Response {
  const w = Number.isFinite(width) ? Math.min(1200, Math.max(160, width)) : 420
  const h = Number.isFinite(height) ? Math.min(1200, Math.max(80, height)) : 300
  const text = escapeXml(message.slice(0, 120))
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">` +
    `<rect width="${w}" height="${h}" fill="none" stroke="#b91c1c" stroke-width="1.5" stroke-dasharray="6 4" rx="8"/>` +
    `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#b91c1c">` +
    `${text}</text></svg>`

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
