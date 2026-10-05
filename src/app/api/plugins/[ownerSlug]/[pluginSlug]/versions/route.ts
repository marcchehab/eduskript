import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { siteHasOrHadSlug } from '@/lib/site-slugs'
import { listPluginVersions, restorePluginVersion } from '@/lib/services/plugins'
import { NotFoundError, PermissionDeniedError } from '@/lib/services/pages'

interface RouteParams {
  params: Promise<{ ownerSlug: string; pluginSlug: string }>
}

async function findPlugin(params: RouteParams['params']) {
  const { ownerSlug, pluginSlug } = await params
  return prisma.plugin.findFirst({
    where: { slug: pluginSlug, author: { sites: { some: siteHasOrHadSlug(ownerSlug) } } },
    select: { id: true },
  })
}

function errorResponse(error: unknown, what: string) {
  if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
  if (error instanceof PermissionDeniedError) return NextResponse.json({ error: error.message }, { status: 403 })
  console.error(`Failed to ${what}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

/** GET — versions of the plugin, newest first (author only). */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const plugin = await findPlugin(params)
    if (!plugin) return NextResponse.json({ error: 'Plugin not found' }, { status: 404 })
    const versions = await listPluginVersions(session.user.id, plugin.id)
    return NextResponse.json({ versions })
  } catch (error) {
    return errorResponse(error, 'list plugin versions')
  }
}

/** POST { versionId } — restore that version (saved as a new version). */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const plugin = await findPlugin(params)
    if (!plugin) return NextResponse.json({ error: 'Plugin not found' }, { status: 404 })
    const { versionId } = await request.json()
    if (typeof versionId !== 'string') return NextResponse.json({ error: 'versionId is required' }, { status: 400 })
    const updated = await restorePluginVersion(session.user.id, plugin.id, versionId)
    return NextResponse.json({ plugin: updated })
  } catch (error) {
    return errorResponse(error, 'restore plugin version')
  }
}
