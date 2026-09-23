/**
 * Slim bar above the dashboard content while the teacher's subscription is
 * trialing: "Noch 9 Tage alle Funktionen", linking to the billing page.
 * Server component (one indexed subscription lookup per dashboard render);
 * renders nothing for paid, free or expired accounts. Turns amber in the last
 * three days. Expiry itself is handled by the daily cron (src/lib/trial.ts).
 */
import Link from 'next/link'
import { Clock } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { getUiLocale } from '@/lib/i18n/server'

const DAY_MS = 24 * 60 * 60 * 1000

// Ceil: 30 hours left reads "2 days", and the last day reads "1 day" rather
// than "0 days". Outside the component so the render body stays pure
// (react-hooks/purity flags Date.now() there).
function daysUntil(end: Date): number {
  return Math.max(1, Math.ceil((end.getTime() - Date.now()) / DAY_MS))
}

export async function TrialBanner({ userId }: { userId: string }) {
  const trial = await prisma.subscription.findFirst({
    where: { userId, status: 'trialing', currentPeriodEnd: { gt: new Date() } },
    select: { currentPeriodEnd: true },
  })
  if (!trial?.currentPeriodEnd) return null

  const locale = await getUiLocale()
  const daysLeft = daysUntil(trial.currentPeriodEnd)
  const urgent = daysLeft <= 3

  const text =
    locale === 'de'
      ? daysLeft === 1
        ? 'Noch 1 Tag alle Funktionen'
        : `Noch ${daysLeft} Tage alle Funktionen`
      : daysLeft === 1
        ? '1 day left with all features'
        : `${daysLeft} days left with all features`
  const cta = locale === 'de' ? 'Was ist in Classroom?' : "What's in Classroom?"

  return (
    <div
      className={`flex items-center justify-center gap-2 px-4 py-1.5 text-sm border-b ${
        urgent
          ? 'bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800'
          : 'bg-blue-50 text-blue-900 border-blue-100 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900'
      }`}
    >
      <Clock className="w-4 h-4 shrink-0" aria-hidden />
      <span>{text}</span>
      <span aria-hidden>·</span>
      <Link href="/dashboard/billing" className="font-medium underline underline-offset-2 hover:no-underline">
        {cta}
      </Link>
    </div>
  )
}
