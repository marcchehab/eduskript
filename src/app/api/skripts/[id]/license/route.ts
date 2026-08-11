import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'

/**
 * GET /api/skripts/[id]/license
 *
 * Authorship + fork-provenance data for the exported LICENSE.txt (see
 * src/lib/skript-export-client.ts). Content on Eduskript is CC BY-NC-SA 4.0
 * (docs/organization/03-content-license.md) — exporting a skript you only
 * have viewer access to must not silently drop who actually owns it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const skript = await prisma.skript.findUnique({
    where: { id },
    include: {
      authors: {
        where: { permission: 'author' },
        orderBy: { createdAt: 'asc' },
        include: {
          user: { select: { id: true, name: true, sites: { orderBy: PRIMARY_SITE_ORDER, take: 1, select: { slug: true } } } }
        }
      },
      pages: {
        where: { forkedFromPageId: { not: null } },
        select: {
          slug: true,
          title: true,
          forkedFromPage: {
            select: {
              title: true,
              slug: true,
              skript: {
                select: {
                  slug: true,
                  authors: {
                    where: { permission: 'author' },
                    orderBy: { createdAt: 'asc' },
                    take: 1,
                    include: { user: { select: { name: true, sites: { orderBy: PRIMARY_SITE_ORDER, take: 1, select: { slug: true } } } } }
                  }
                }
              }
            }
          },
          forkedFromAuthor: {
            select: { name: true, sites: { orderBy: PRIMARY_SITE_ORDER, take: 1, select: { slug: true } } }
          }
        }
      }
    }
  })

  if (!skript) {
    return NextResponse.json({ error: 'Skript not found' }, { status: 404 })
  }

  // Permission check needs the full authors list (view included below is filtered to 'author').
  const allAuthors = await prisma.skriptAuthor.findMany({
    where: { skriptId: id },
    include: { user: true }
  })
  const permissions = checkSkriptPermissions(session.user.id, allAuthors, session.user.isAdmin)
  if (!permissions.canView) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  return NextResponse.json({
    authors: skript.authors.map(a => ({
      userId: a.user.id,
      name: a.user.name,
      siteSlug: a.user.sites[0]?.slug ?? null
    })),
    forkedPages: skript.pages.map(p => {
      const originalAuthor = p.forkedFromPage?.skript.authors[0]?.user ?? p.forkedFromAuthor
      return {
        pageSlug: p.slug,
        pageTitle: p.title,
        originalPageSlug: p.forkedFromPage?.slug ?? null,
        originalPageTitle: p.forkedFromPage?.title ?? null,
        originalSkriptSlug: p.forkedFromPage?.skript.slug ?? null,
        originalAuthorName: originalAuthor?.name ?? null,
        originalAuthorSiteSlug: originalAuthor?.sites[0]?.slug ?? null
      }
    })
  })
}
