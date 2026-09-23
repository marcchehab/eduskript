/**
 * GET /api/snaps/image/snaps/{ownerId}/{pageId}/{snapId}.{ext}
 *
 * Serves a snap image from the (private) Scaleway user bucket after an access
 * check. Snaps used to be uploaded public-read, so anyone holding the URL could
 * see a student's screenshot without logging in (see /datenschutz). Stored
 * snap URLs are unchanged (full S3 URLs in UserData); clients rewrite them to
 * this route via snapImageSrc() in src/lib/snap-url.ts.
 *
 * Access:
 * - the snap's owner;
 * - anyone, if the owner is a teacher (teacher snaps are broadcast content and
 *   may be shown on public pages, same as before);
 * - a teacher of any class the (student) owner is a member of.
 * One or two small indexed queries per image; responses are cached privately
 * in the browser (snaps are immutable — a new snap gets a new snapId).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { downloadFromS3, isS3Configured } from '@/lib/s3'

const KEY_RE = /^snaps\/([^/]+)\/[^/]+\/[^/]+\.(png|jpe?g|webp|gif)$/

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  if (!isS3Configured()) return new NextResponse('Not found', { status: 404 })

  const { key: parts } = await params
  const key = parts.map(decodeURIComponent).join('/')
  const m = key.match(KEY_RE)
  if (!m) return new NextResponse('Not found', { status: 404 })
  const [, ownerId, ext] = m

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
      const membership = await prisma.classMembership.findFirst({
        where: { studentId: ownerId, class: { teacherId: viewerId } },
        select: { id: true },
      })
      if (!membership) return new NextResponse('Forbidden', { status: 403 })
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
