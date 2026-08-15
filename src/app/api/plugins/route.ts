import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'
import { createPluginForUser } from '@/lib/services/plugins'
import { ConflictError, ValidationError } from '@/lib/services/pages'

/**
 * GET /api/plugins — List all plugins, optionally filtered by author.
 * Query params: ?author=pageSlug (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const authorFilter = searchParams.get('author')

    const pluginsRaw = await prisma.plugin.findMany({
      where: authorFilter
        ? { author: { sites: { some: { slug: authorFilter } } } }
        : undefined,
      include: {
        author: {
          select: { id: true, name: true, image: true, sites: { orderBy: PRIMARY_SITE_ORDER, take: 1, select: { slug: true, pageName: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    // Flatten the author's primary Site fields under their legacy names
    // (pageSlug, pageName) so the UI components don't need a sweep.
    const plugins = pluginsRaw.map(p => ({
      ...p,
      author: {
        id: p.author.id,
        name: p.author.name,
        image: p.author.image,
        pageSlug: p.author.sites[0]?.slug ?? null,
        pageName: p.author.sites[0]?.pageName ?? null,
      },
    }))

    return NextResponse.json({ plugins })
  } catch (error) {
    console.error('Failed to list plugins:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/plugins — Create a new plugin.
 * Body: { slug, name, description?, manifest, entryHtml }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { slug, name, description, manifest, entryHtml } = await request.json()

    const plugin = await createPluginForUser(session.user.id, { slug, name, description, manifest, entryHtml })

    return NextResponse.json({ plugin }, { status: 201 })
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('Failed to create plugin:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
