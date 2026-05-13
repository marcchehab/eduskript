import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { searchPagesForUser } from '@/lib/services/pages'

const MAX_RESULTS = 20

/**
 * GET /api/pages/search?q=<query>
 *
 * Search pages the current user authors (directly or via skript/collection
 * authorship). Powers the markdown-link autocomplete in the page editor —
 * authors typing inside `[title](|)` get a list of pages and selecting one
 * inserts a `/p/{id}` stable link.
 *
 * Empty/missing q returns the user's most recently updated pages (so the
 * dropdown is useful even before the user has typed anything).
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim() ?? ''

  // searchPagesForUser short-circuits on empty query, so list recent pages
  // separately for that case.
  const userId = session.user.id
  const pages = q
    ? await searchPagesForUser(userId, q, MAX_RESULTS)
    : await prisma.page.findMany({
        where: {
          OR: [
            { authors: { some: { userId } } },
            { skript: { authors: { some: { userId } } } },
            {
              skript: {
                collectionSkripts: {
                  some: { collection: { site: { userId } } },
                },
              },
            },
          ],
        },
        include: {
          skript: { select: { id: true, title: true, slug: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: MAX_RESULTS,
      })

  return NextResponse.json({
    pages: pages.map(p => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      skriptId: p.skript.id,
      skriptTitle: p.skript.title,
    })),
  })
}
