import { GitFork } from 'lucide-react'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'

interface ForkAttributionProps {
  forkedFromPageId: string | null
  forkedFromAuthorId: string | null
}

/**
 * Displays "Forked from [Site]" attribution on public pages, naming the site
 * (pageName, e.g. "informatikgarten.ch") the original skript is published on,
 * else the original author's name.
 * Degrades gracefully when the original page or author has been deleted.
 */
export async function ForkAttribution({
  forkedFromPageId,
  forkedFromAuthorId,
}: ForkAttributionProps) {
  if (!forkedFromPageId && !forkedFromAuthorId) return null

  // Fetch original page info (may be null if deleted)
  const originalPage = forkedFromPageId
    ? await prisma.page.findUnique({
        where: { id: forkedFromPageId },
        select: {
          title: true,
          slug: true,
          skript: {
            select: {
              slug: true,
              // The site the original is published on (first collection placing it).
              collectionSkripts: {
                take: 1,
                select: { collection: { select: { site: { select: { slug: true, pageName: true } } } } },
              },
              authors: {
                where: { permission: 'author' },
                orderBy: { createdAt: 'asc' as const },
                take: 1,
                include: {
                  user: { select: { name: true, sites: { orderBy: PRIMARY_SITE_ORDER, take: 1, select: { slug: true } } } },
                },
              },
            },
          },
        },
      })
    : null

  // Fetch original author (fallback if page was deleted)
  const originalAuthor =
    !originalPage && forkedFromAuthorId
      ? await prisma.user.findUnique({
          where: { id: forkedFromAuthorId },
          select: { name: true, sites: { orderBy: PRIMARY_SITE_ORDER, take: 1, select: { slug: true } } },
        })
      : null

  // Build attribution content
  const pageAuthor = originalPage?.skript.authors[0]?.user
  // Name: the site the original skript is published on, else the teacher.
  // The primary site is only a link target, never the name — it may be an
  // unrelated site of the same teacher.
  const site = originalPage?.skript.collectionSkripts[0]?.collection.site
  const authorSlug = site?.slug || pageAuthor?.sites[0]?.slug || originalAuthor?.sites[0]?.slug
  const authorName = site?.pageName || pageAuthor?.name || originalAuthor?.name

  if (!authorName && !originalPage) return null

  return (
    <div className="flex items-center gap-1 text-[10px] leading-tight text-muted-foreground/60">
      <GitFork className="h-2.5 w-2.5 shrink-0 rotate-90" />
      {originalPage && authorSlug ? (
        <Link
          href={`/${authorSlug}/${originalPage.skript.slug}/${originalPage.slug}`}
          className="hover:text-muted-foreground transition-colors"
          title={`Forked from "${originalPage.title}" by ${authorName || authorSlug}`}
        >
          Forked from {authorName || authorSlug}
        </Link>
      ) : authorSlug ? (
        <Link
          href={`/${authorSlug}`}
          className="hover:text-muted-foreground transition-colors"
          title={`Originally by ${authorName || authorSlug}`}
        >
          Forked from {authorName || authorSlug}
        </Link>
      ) : (
        <span title="Forked from another author">Forked from another author</span>
      )}
    </div>
  )
}
