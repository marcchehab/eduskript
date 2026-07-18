import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'

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

    if (!slug || !name || !entryHtml) {
      return NextResponse.json(
        { error: 'slug, name, and entryHtml are required' },
        { status: 400 },
      )
    }

    // Validate slug format: lowercase alphanumeric + hyphens
    const slugRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/
    if (slug.length < 2 || slug.length > 64 || !slugRegex.test(slug)) {
      return NextResponse.json(
        { error: 'Slug must be 2-64 characters, lowercase alphanumeric with hyphens' },
        { status: 400 },
      )
    }

    // Check uniqueness for this author
    const existing = await prisma.plugin.findUnique({
      where: { authorId_slug: { authorId: session.user.id, slug } },
    })
    if (existing) {
      return NextResponse.json(
        { error: `You already have a plugin with slug "${slug}"` },
        { status: 409 },
      )
    }

    const pluginRaw = await prisma.plugin.create({
      data: {
        slug,
        name,
        description: description || null,
        manifest: manifest || {},
        entryHtml,
        authorId: session.user.id,
      },
      include: {
        author: {
          select: { id: true, name: true, image: true, sites: { orderBy: PRIMARY_SITE_ORDER, take: 1, select: { slug: true, pageName: true } } },
        },
      },
    })

    const plugin = {
      ...pluginRaw,
      author: {
        id: pluginRaw.author.id,
        name: pluginRaw.author.name,
        image: pluginRaw.author.image,
        pageSlug: pluginRaw.author.sites[0]?.slug ?? null,
        pageName: pluginRaw.author.sites[0]?.pageName ?? null,
      },
    }

    return NextResponse.json({ plugin }, { status: 201 })
  } catch (error) {
    console.error('Failed to create plugin:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
