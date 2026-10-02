import 'server-only'
import { prisma } from '@/lib/prisma'

export interface PageNavLink {
  slug: string
  title: string
}

/**
 * Previous/next page for <page-nav>: neighbours in skript order among pages
 * that are published and NOT unlisted. One query per render (only when the
 * page uses the tag). `null` sides when the page is first/last or itself
 * not in that list.
 */
export async function getPageNeighbours(skriptId: string, pageId: string): Promise<{ prev: PageNavLink | null; next: PageNavLink | null }> {
  const pages = await prisma.page.findMany({
    where: { skriptId, isPublished: true, isUnlisted: false },
    orderBy: { order: 'asc' },
    select: { id: true, slug: true, title: true },
  })
  const i = pages.findIndex(p => p.id === pageId)
  if (i === -1) return { prev: null, next: null }
  const pick = (p?: { slug: string; title: string }) => (p ? { slug: p.slug, title: p.title } : null)
  return { prev: pick(pages[i - 1]), next: pick(pages[i + 1]) }
}
