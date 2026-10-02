import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { PageNavLink } from '@/lib/page-nav.server'

/**
 * `<page-nav>`: previous / next page of the skript (published, not unlisted).
 * Links are relative (`<slug>`), so they resolve to the sibling page under
 * every route shape (custom domain, /org/…, /<site>/…). Renders nothing
 * without neighbour data (e.g. the editor preview).
 */
export function PageNav({ prev, next }: { prev: PageNavLink | null; next: PageNavLink | null }) {
  if (!prev && !next) return null
  const card = 'flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-card px-4 py-3 no-underline transition-colors hover:bg-muted'
  return (
    <nav className="not-prose my-8 flex gap-3" aria-label="Page navigation">
      {prev ? (
        <a href={prev.slug} className={card}>
          <ChevronLeft className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">Previous</span>
            <span className="block truncate font-medium text-foreground">{prev.title}</span>
          </span>
        </a>
      ) : <span className="flex-1" />}
      {next ? (
        <a href={next.slug} className={`${card} justify-end text-right`}>
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">Next</span>
            <span className="block truncate font-medium text-foreground">{next.title}</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        </a>
      ) : <span className="flex-1" />}
    </nav>
  )
}
