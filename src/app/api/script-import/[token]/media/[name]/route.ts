import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getImportByToken } from '@/lib/script-import/service'

/** Image of an unclaimed import, served from the DB (ScriptImportAsset). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; name: string }> }) {
  const { token, name } = await params
  const row = await getImportByToken(token)
  if (!row) return new NextResponse('Not found', { status: 404 })
  const asset = await prisma.scriptImportAsset.findUnique({
    where: { importId_name: { importId: row.id, name } },
    select: { contentType: true, data: true },
  })
  if (!asset) return new NextResponse('Not found', { status: 404 })
  return new NextResponse(new Uint8Array(asset.data), {
    headers: {
      'Content-Type': asset.contentType,
      'Cache-Control': 'private, max-age=3600',
      'X-Robots-Tag': 'noindex',
      'X-Content-Type-Options': 'nosniff',
      // SVGs from Word could carry scripts; never execute them in our origin.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  })
}
