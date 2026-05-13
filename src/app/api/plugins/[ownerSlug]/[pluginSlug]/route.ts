import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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

    const plugin = await prisma.plugin.findFirst({
      where: {
        slug: pluginSlug,
        author: { site: { slug: ownerSlug } },
      },
      include: {
        author: {
          select: { id: true, pageName: true, name: true, site: { select: { slug: true } } },
        },
      },
    })

    if (!plugin) {
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 })
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
        author: { site: { slug: ownerSlug } },
      },
    })

    if (!plugin) {
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 })
    }

    if (plugin.authorId !== session.user.id) {
      return NextResponse.json({ error: 'Only the author can update this plugin' }, { status: 403 })
    }

    const body = await request.json()
    const { name, description, manifest, entryHtml, version } = body

    const updated = await prisma.plugin.update({
      where: { id: plugin.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(manifest !== undefined && { manifest }),
        ...(entryHtml !== undefined && { entryHtml }),
        ...(version !== undefined && { version }),
      },
      include: {
        author: {
          select: { id: true, pageName: true, name: true, site: { select: { slug: true } } },
        },
      },
    })

    return NextResponse.json({ plugin: updated })
  } catch (error) {
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
        author: { site: { slug: ownerSlug } },
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
