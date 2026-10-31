import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import sharp from 'sharp'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { siteHasOrHadSlug } from '@/lib/site-slugs'
import { PLUGIN_THUMBNAIL } from '@/lib/plugin-thumbnail'
import { isTeacherS3Configured, uploadTeacherFile } from '@/lib/s3'
import { pluginThumbnailUrl, setPluginThumbnail } from '@/lib/services/plugins'
import { NotFoundError, PermissionDeniedError } from '@/lib/services/pages'

interface RouteParams {
  params: Promise<{ ownerSlug: string; pluginSlug: string }>
}

// Decided from the bytes: the object is served inline from a public bucket, so
// the client's Content-Type is not trusted.
const FORMATS: Record<string, { ext: string; mime: string }> = {
  webp: { ext: 'webp', mime: 'image/webp' },
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
}

/** Multipart overhead around the file; only for the early Content-Length check. */
const MULTIPART_SLACK = 1024

async function authorizedPlugin(params: RouteParams['params']) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { ownerSlug, pluginSlug } = await params
  const plugin = await prisma.plugin.findFirst({
    where: { slug: pluginSlug, author: { sites: { some: siteHasOrHadSlug(ownerSlug) } } },
    select: { id: true, authorId: true },
  })
  if (!plugin) return { error: NextResponse.json({ error: 'Plugin not found' }, { status: 404 }) }
  if (plugin.authorId !== session.user.id) {
    return { error: NextResponse.json({ error: 'Only the author can change the thumbnail' }, { status: 403 }) }
  }
  return { userId: session.user.id, pluginId: plugin.id }
}

function serviceError(error: unknown, action: string) {
  if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
  if (error instanceof PermissionDeniedError) return NextResponse.json({ error: error.message }, { status: 403 })
  console.error(`Failed to ${action} plugin thumbnail:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

/**
 * POST /api/plugins/[ownerSlug]/[pluginSlug]/thumbnail — Set the thumbnail
 * (author only). Multipart field `file`: WebP or JPEG, the editor downscales
 * it first (src/lib/plugin-thumbnail.ts). Does not change updatedAt.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authorizedPlugin(params)
    if (auth.error) return auth.error

    const tooLarge = () => NextResponse.json(
      { error: `Thumbnail must be at most ${PLUGIN_THUMBNAIL.maxBytes / 1000} KB` },
      { status: 413 },
    )
    // Cheap refusal before formData() reads the body. A missing header is
    // caught by the file.size check below.
    if (Number(request.headers.get('content-length')) > PLUGIN_THUMBNAIL.maxBytes + MULTIPART_SLACK) return tooLarge()

    const file = (await request.formData()).get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (file.size > PLUGIN_THUMBNAIL.maxBytes) return tooLarge()

    if (!isTeacherS3Configured()) {
      return NextResponse.json({ error: 'File storage not configured' }, { status: 500 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const metadata = await sharp(buffer).metadata().catch(() => null)
    const format = metadata ? FORMATS[metadata.format] : undefined
    if (!format) return NextResponse.json({ error: 'Thumbnail must be a WebP or JPEG image' }, { status: 400 })

    const hash = crypto.createHash('sha256').update(buffer).digest('hex')
    const key = await uploadTeacherFile(hash, format.ext, buffer, format.mime)
    const manifest = await setPluginThumbnail(auth.userId, auth.pluginId, key)

    return NextResponse.json({ thumbnailUrl: pluginThumbnailUrl(manifest) })
  } catch (error) {
    return serviceError(error, 'set')
  }
}

/**
 * DELETE /api/plugins/[ownerSlug]/[pluginSlug]/thumbnail — Remove the thumbnail
 * (author only). The S3 object stays: a fork may use the same key.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authorizedPlugin(params)
    if (auth.error) return auth.error

    await setPluginThumbnail(auth.userId, auth.pluginId, null)
    return NextResponse.json({ thumbnailUrl: null })
  } catch (error) {
    return serviceError(error, 'remove')
  }
}
