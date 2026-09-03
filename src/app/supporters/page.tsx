import type { Metadata } from 'next'
import Link from 'next/link'
import { Handshake } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { readExtraSettings, DEFAULT_SUPPORTER_MESSAGE } from '@/lib/settings'

export const metadata: Metadata = {
  title: 'Supporters – Eduskript',
  description: 'The teachers whose support keeps Eduskript going.',
}

// The list changes rarely; hourly ISR is plenty and keeps the page static.
export const revalidate = 3600

export default async function SupportersPage() {
  // A supporter can own several sites; list each site that has not opted out
  // (Site.extraSettings.supporterBadgeHidden), since the site is what the
  // badge links from and what visitors know them by.
  const sites = await prisma.site.findMany({
    where: { user: { billingPlan: { startsWith: 'supporter' } } },
    select: { slug: true, pageName: true, extraSettings: true },
    orderBy: { pageName: 'asc' },
  })

  const supporters = sites
    .map((site) => ({ site, extra: readExtraSettings(site) }))
    .filter(({ extra }) => !extra.supporterBadgeHidden)
    .map(({ site, extra }) => ({
      slug: site.slug,
      name: site.pageName || site.slug,
      message: extra.supporterBadgeMessage || DEFAULT_SUPPORTER_MESSAGE,
    }))

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground mb-8 inline-block"
        >
          &larr; Back
        </Link>

        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <Handshake className="h-7 w-7 text-amber-500" />
          Supporters
        </h1>
        <p className="text-muted-foreground mb-10">
          Eduskript is built by one person. These teachers chose to pay more
          than they have to, so it can keep going. Thank you.
        </p>

        {supporters.length === 0 ? (
          <p className="text-muted-foreground">
            No supporters yet — you could be the first.
          </p>
        ) : (
          <ul className="space-y-3">
            {supporters.map((s) => (
              <li
                key={s.slug}
                className="flex items-center justify-between gap-4 rounded-lg border border-amber-400/40 bg-gradient-to-r from-amber-50/60 to-transparent dark:from-amber-950/20 px-4 py-3"
              >
                <Link
                  href={`/${s.slug}`}
                  prefetch={false}
                  className="font-medium hover:underline underline-offset-2"
                >
                  {s.name}
                </Link>
                <span className="text-sm text-muted-foreground text-right">{s.message}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-sm text-muted-foreground mt-10">
          Want to join them?{' '}
          <Link href="/dashboard/billing" className="underline underline-offset-2 hover:text-foreground">
            Become a Supporter
          </Link>{' '}
          from your dashboard.
        </p>
      </div>
    </div>
  )
}
