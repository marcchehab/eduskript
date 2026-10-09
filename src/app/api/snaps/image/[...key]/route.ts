/**
 * GET /api/snaps/image/snaps/{ownerId}/{pageId}/{snapId}.{ext}
 *
 * Serves a snap image from the (private) Scaleway user bucket after an access
 * check. Snaps used to be uploaded public-read. Only relevant where
 * SCW_USER_BUCKET is set: production has none (2026-09-23), so snaps there are
 * stored as base64 inside UserData and this route is unused. Stored
 * snap URLs are unchanged (full S3 URLs in UserData); clients rewrite them to
 * this route via snapImageSrc() in src/lib/snap-url.ts.
 *
 * Access:
 * - the snap's owner;
 * - anyone, if the owner is a teacher (teacher snaps are broadcast content and
 *   may be shown on public pages, same as before);
 * - a manager of a site that holds the owner's snaps for that page (site
 *   scoping, bughunt #33 — was: any class teacher of the student, regardless
 *   of site; org admins had no access).
 * One or two small indexed queries per image; responses are cached privately
 * in the browser (snaps are immutable — a new snap gets a new snapId).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { downloadFromS3, isS3Configured } from '@/lib/s3'
import { getManagedSiteIds } from '@/lib/site-access'

const KEY_RE = /^snaps\/([^/]+)\/([^/]+)\/[^/]+\.(png|jpe?g|webp|gif)$/

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  if (!isS3Configured()) return new NextResponse('Not found', { status: 404 })

  const { key: parts } = await params
  const key = parts.map(decodeURIComponent).join('/')
  const m = key.match(KEY_RE)
  if (!m) return new NextResponse('Not found', { status: 404 })
  const [, ownerId, pageId, ext] = m

  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { accountType: true },
  })
  if (!owner) return new NextResponse('Not found', { status: 404 })

  if (owner.accountType !== 'teacher') {
    const session = await getServerSession(authOptions)
    const viewerId = session?.user?.id
    if (!viewerId) return new NextResponse('Unauthorized', { status: 401 })
    if (viewerId !== ownerId) {
      const managed = await getManagedSiteIds(viewerId)
      const held = managed.length
        ? await prisma.userData.findFirst({
            where: { userId: ownerId, adapter: 'snaps', itemId: pageId, siteId: { in: managed } },
            select: { id: true },
          })
        : null
      if (!held) return new NextResponse('Forbidden', { status: 403 })
    }
  }

  let body: Buffer
  try {
    body = await downloadFromS3(key)
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': ext === 'jpg' ? 'image/jpeg' : `image/${ext}`,
      // Teacher snaps may be public, student snaps must not land in shared caches.
      'Cache-Control': owner.accountType === 'teacher'
        ? 'public, max-age=31536000, immutable'
        : 'private, max-age=31536000, immutable',
    },
  })
}
