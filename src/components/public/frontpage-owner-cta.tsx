'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'

/**
 * "Create a frontpage" prompt, shown only to the site owner.
 *
 * Deliberately client-side: the pages that render this are ISR-cached, so the
 * server render must be identical for every visitor. Reading the session on the
 * server to decide this would opt the whole route out of static rendering (and
 * a cached response would then show one visitor's affordances to everyone).
 * The owner sees it once the session resolves.
 */
export function FrontpageOwnerCta({ ownerId, href }: { ownerId: string; href: string }) {
  const { data: session } = useSession()
  if (session?.user?.id !== ownerId) return null

  return (
    <div className="text-center pb-8">
      <p className="text-muted-foreground mb-4">
        You haven&apos;t created a frontpage yet.
      </p>
      <Link
        href={href}
        className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
      >
        Create Frontpage
      </Link>
    </div>
  )
}
