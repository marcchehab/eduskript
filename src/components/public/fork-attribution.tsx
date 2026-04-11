import { GitFork } from 'lucide-react'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'

interface ForkAttributionProps {
  forkedFromPageId: string | null
  forkedFromAuthorId: string | null
}

/**
 * Displays "Forked from [Author]/[Page]" attribution on public pages.
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
              authors: {
                where: { permission: 'author' },
                orderBy: { createdAt: 'asc' as const },
                take: 1,
                include: {
                  user: { select: { pageSlug: true, name: true } },
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
          select: { name: true, pageSlug: true },
        })
      : null

  // Build attribution content
  const pageAuthor = originalPage?.skript.authors[0]?.user
  const authorName = pageAuthor?.name || originalAuthor?.name
  const authorSlug = pageAuthor?.pageSlug || originalAuthor?.pageSlug

  if (!authorName && !originalPage) return null

  return (
    <div className="flex items-center gap-1 text-[10px] leading-tight text-muted-foreground/60">
      <GitFork className="h-2.5 w-2.5 shrink-0" />
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
