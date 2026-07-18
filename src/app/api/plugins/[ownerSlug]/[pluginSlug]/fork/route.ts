import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'

interface RouteParams {
  params: Promise<{ ownerSlug: string; pluginSlug: string }>
}

/**
 * POST /api/plugins/[ownerSlug]/[pluginSlug]/fork — Fork a plugin to current user's library.
 * Creates a copy under the current user's namespace with the same slug (or a suffixed one if taken).
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { ownerSlug, pluginSlug } = await params

    // Find the source plugin
    const source = await prisma.plugin.findFirst({
      where: {
        slug: pluginSlug,
        author: { sites: { some: { slug: ownerSlug } } },
      },
    })

    if (!source) {
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 })
    }

    // Can't fork your own plugin
    if (source.authorId === session.user.id) {
      return NextResponse.json({ error: 'Cannot fork your own plugin' }, { status: 400 })
    }

    // Find a unique slug for the fork
    let forkSlug = pluginSlug
    let suffix = 0
    while (true) {
      const existing = await prisma.plugin.findUnique({
        where: { authorId_slug: { authorId: session.user.id, slug: forkSlug } },
      })
      if (!existing) break
      suffix++
      forkSlug = `${pluginSlug}-${suffix}`
    }

    const forkedRaw = await prisma.plugin.create({
      data: {
        slug: forkSlug,
        name: source.name,
        description: source.description,
        version: '1.0.0',
        manifest: source.manifest as object,
        entryHtml: source.entryHtml,
        authorId: session.user.id,
      },
      include: {
        author: {
          select: { id: true, name: true, sites: { orderBy: PRIMARY_SITE_ORDER, take: 1, select: { slug: true, pageName: true } } },
        },
      },
    })

    const forked = {
      ...forkedRaw,
      author: {
        id: forkedRaw.author.id,
        name: forkedRaw.author.name,
        pageSlug: forkedRaw.author.sites[0]?.slug ?? null,
        pageName: forkedRaw.author.sites[0]?.pageName ?? null,
      },
    }

    return NextResponse.json({ plugin: forked }, { status: 201 })
  } catch (error) {
    console.error('Failed to fork plugin:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
