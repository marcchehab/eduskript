import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { updatePluginForUser } from '@/lib/services/plugins'
import { NotFoundError, PermissionDeniedError } from '@/lib/services/pages'

interface RouteParams {
  params: Promise<{ ownerSlug: string; pluginSlug: string }>
}

/**
 * GET /api/plugins/[ownerSlug]/[pluginSlug] — Get plugin HTML for rendering.
 * Public endpoint (needed for iframe srcdoc on public pages).
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { ownerSlug, pluginSlug } = await params

    const pluginRaw = await prisma.plugin.findFirst({
      where: {
        slug: pluginSlug,
        author: { sites: { some: { slug: ownerSlug } } },
      },
      include: {
        author: {
          select: { id: true, name: true, sites: { where: { slug: ownerSlug }, take: 1, select: { slug: true, pageName: true } } },
        },
      },
    })

    if (!pluginRaw) {
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 })
    }

    const plugin = {
      ...pluginRaw,
      author: {
        id: pluginRaw.author.id,
        name: pluginRaw.author.name,
        pageSlug: pluginRaw.author.sites[0]?.slug ?? null,
        pageName: pluginRaw.author.sites[0]?.pageName ?? null,
      },
    }

    return NextResponse.json({ plugin })
  } catch (error) {
    console.error('Failed to get plugin:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/plugins/[ownerSlug]/[pluginSlug] — Update plugin (author only).
 * Body: { name?, description?, manifest?, entryHtml?, version? }
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { ownerSlug, pluginSlug } = await params

    const plugin = await prisma.plugin.findFirst({
      where: {
        slug: pluginSlug,
        author: { sites: { some: { slug: ownerSlug } } },
      },
    })

    if (!plugin) {
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 })
    }

    const { name, description, manifest, entryHtml, version } = await request.json()
    const updated = await updatePluginForUser(session.user.id, plugin.id, { name, description, manifest, entryHtml, version }, ownerSlug)

    return NextResponse.json({ plugin: updated })
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error('Failed to update plugin:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/plugins/[ownerSlug]/[pluginSlug] — Delete plugin (author only).
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { ownerSlug, pluginSlug } = await params

    const plugin = await prisma.plugin.findFirst({
      where: {
        slug: pluginSlug,
        author: { sites: { some: { slug: ownerSlug } } },
      },
    })

    if (!plugin) {
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 })
    }

    if (plugin.authorId !== session.user.id) {
      return NextResponse.json({ error: 'Only the author can delete this plugin' }, { status: 403 })
    }

    await prisma.plugin.delete({ where: { id: plugin.id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete plugin:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
