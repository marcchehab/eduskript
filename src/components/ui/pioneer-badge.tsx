import { Flag } from 'lucide-react'
import Link from 'next/link'

/**
 * The Eduskript Pioneer badge: a thank-you to teachers in the pioneer
 * programme (src/lib/pioneer.ts). Shown on the billing page and at the bottom
 * of a pioneer's public sidebar (src/components/public/layout.tsx). Unlike the
 * supporter badge it has no opt-out and no custom text.
 */
export function PioneerBadge({ href }: { href?: string }) {
  const inner = (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/60 bg-gradient-to-r from-sky-100 to-sky-50 dark:from-sky-900/50 dark:to-sky-950/30 px-3 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300">
      <Flag className="h-3.5 w-3.5 shrink-0" />
      Eduskript Pioneer
    </span>
  )
  if (!href) return inner
  return (
    <Link href={href} prefetch={false} className="hover:opacity-80" title="Early teacher helping shape Eduskript">
      {inner}
    </Link>
  )
}
