import { Handshake } from 'lucide-react'
import Link from 'next/link'
import { DEFAULT_SUPPORTER_MESSAGE } from '@/lib/settings'

/**
 * The Eduskript Supporter badge. Shown on the billing page and, unless the
 * site opts out (Site.extraSettings.supporterBadgeHidden), at the bottom of a
 * supporter's public sidebar, linking to the /supporters thank-you page.
 */
export function SupporterBadge({ message, href }: { message?: string | null; href?: string }) {
  const inner = (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/60 bg-gradient-to-r from-amber-100 to-amber-50 dark:from-amber-900/50 dark:to-amber-950/30 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
      <Handshake className="h-3.5 w-3.5 shrink-0" />
      {message || DEFAULT_SUPPORTER_MESSAGE}
    </span>
  )
  if (!href) return inner
  return (
    <Link href={href} prefetch={false} className="hover:opacity-80" title="Eduskript Supporter — see all supporters">
      {inner}
    </Link>
  )
}
