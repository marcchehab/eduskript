'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, FileText, GraduationCap, Handshake, Building2, ShieldCheck } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ctaTypography } from '@/components/markdown/cta-button'
import {
  PLAN_COPY,
  formatChf,
  monthlyEquivalent,
  pickPlans,
  type PlanCopyLang,
  type PublicPlan,
} from '@/lib/plan-copy'

interface PricingTableProps {
  lang?: string
  /** Where the CTA points; defaults to the signup page. */
  signup?: string
}

/**
 * `<pricing lang="de" />` — public price table: Free / Classroom / Supporter,
 * the School licence, and a "no traps" list. Prices and trial length come
 * live from /api/plans (the same Plan rows the billing page sells), so the
 * page can't advertise a stale price. Copy lives in src/lib/plan-copy.ts.
 *
 * Uses div/span (role=list for lists), not <p>/<ul>: the paper's prose styles
 * restyle every <p> and <li> (size, weight, indent), which would flatten the
 * card typography. `not-prose` doesn't help — .prose-theme is our own class.
 *
 * Client-side fetch: until the plans arrive the paid cards show a skeleton;
 * if the request fails they're simply omitted (Free + School + guarantees
 * still render — no fabricated prices).
 */
export function PricingTable({ lang, signup = '/auth/signup' }: PricingTableProps) {
  const l: PlanCopyLang = lang === 'de' ? 'de' : 'en'
  const t = PLAN_COPY[l]
  const [plans, setPlans] = useState<PublicPlan[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/plans')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: { plans: PublicPlan[] }) => { if (!cancelled) setPlans(json.plans) })
      .catch((err) => { console.error('Failed to load plans:', err); if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [])

  const { classroomYearly, classroomMonthly, supporter, trialDays } = pickPlans(plans ?? [])
  const loading = !plans && !failed

  return (
    <div className="not-prose my-8 space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {/* Free */}
        <Card>
          <CardTitle icon={<FileText className="h-5 w-5 text-muted-foreground" />} name={t.free.name} />
          <Price amount="CHF 0" period={t.free.period} />
          <div className="mt-1 text-sm text-muted-foreground">{t.free.tagline}</div>
          <FeatureList features={t.free.features} />
        </Card>

        {/* Classroom */}
        {loading ? (
          <SkeletonCard />
        ) : classroomYearly ? (
          <Card highlighted badge={t.classroom.badge}>
            <CardTitle icon={<GraduationCap className="h-5 w-5 text-primary" />} name={t.classroom.name} />
            <Price amount={formatChf(classroomYearly.priceChf)} period={t.perYear} />
            <div className="mt-1 text-sm text-muted-foreground">
              ≈ {formatChf(monthlyEquivalent(classroomYearly.priceChf))} {t.perMonth}
              {classroomMonthly && <> · {t.orMonthly(formatChf(classroomMonthly.priceChf))}</>}
            </div>
            <FeatureList features={t.classroom.features} />
          </Card>
        ) : null}

        {/* Supporter */}
        {loading ? (
          <SkeletonCard />
        ) : supporter ? (
          <Card supporter>
            <CardTitle icon={<Handshake className="h-5 w-5 text-amber-500" />} name={t.supporter.name} />
            <Price amount={formatChf(supporter.priceChf)} period={t.perYear} />
            <div className="mt-1 text-sm text-muted-foreground">{t.supporter.tagline}</div>
            <FeatureList features={t.supporter.features} accent />
          </Card>
        ) : null}
      </div>

      {/* School */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <span className="text-lg font-semibold">{t.school.name}</span>
            <span className="text-sm text-muted-foreground">— {t.school.price}</span>
          </div>
          <div role="list" className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            {t.school.features.map((f) => (
              <div role="listitem" key={f} className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
                {f}
              </div>
            ))}
          </div>
        </div>
        <a href={t.school.mailto} className={cn(buttonVariants({ variant: 'outline' }), 'shrink-0')} style={proseLink('outline')}>
          {t.school.contact}
        </a>
      </div>

      {/* No traps */}
      <div className="rounded-xl border border-green-500/30 bg-green-50/50 p-5 dark:bg-green-950/20">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
          {t.guaranteesTitle}
        </div>
        <div role="list" className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {t.guarantees(trialDays).map((g) => (
            <div role="listitem" key={g} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
              <span>{g}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-center pt-2">
        <Link href={signup} className={buttonVariants({ size: 'lg' })} style={{ ...proseLink('default'), ...ctaTypography('heading', 'bold', 'xl') }}>{t.cta}</Link>
      </div>
    </div>
  )
}

/**
 * `.prose-theme a { text-primary underline }` outranks the button utility
 * classes (same problem and fix as cta-button.tsx): without the inline colour
 * the default button is blue text on blue.
 */
function proseLink(variant: 'default' | 'outline'): React.CSSProperties {
  return {
    textDecoration: 'none',
    color: variant === 'default' ? 'var(--color-primary-foreground)' : 'var(--color-foreground)',
  }
}

function Card({ children, highlighted, supporter, badge }: {
  children: React.ReactNode
  highlighted?: boolean
  supporter?: boolean
  badge?: string
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col rounded-xl border bg-card p-6',
        highlighted && 'border-2 border-primary shadow-sm',
        supporter && 'border-amber-400/60 bg-gradient-to-br from-amber-50/60 to-transparent dark:from-amber-950/20',
      )}
    >
      {badge && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground">
          {badge}
        </span>
      )}
      {children}
    </div>
  )
}

function CardTitle({ icon, name }: { icon: React.ReactNode; name: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-lg font-semibold">{name}</span>
    </div>
  )
}

function Price({ amount, period }: { amount: string; period: string }) {
  return (
    <div className="mt-3 text-3xl font-bold leading-tight">
      {amount}
      <span className="text-sm font-normal text-muted-foreground"> / {period}</span>
    </div>
  )
}

function FeatureList({ features, accent }: { features: readonly string[]; accent?: boolean }) {
  return (
    <div role="list" className="mt-4 flex-1 space-y-2">
      {features.map((f) => (
        <div role="listitem" key={f} className="flex items-start gap-2 text-sm">
          <Check className={cn('mt-0.5 h-4 w-4 shrink-0', accent ? 'text-amber-500' : 'text-green-500')} />
          <span>{f}</span>
        </div>
      ))}
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border p-6" aria-busy="true">
      <div className="h-5 w-1/3 rounded bg-muted" />
      <div className="mt-4 h-8 w-1/2 rounded bg-muted" />
      <div className="mt-6 space-y-2">
        {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-3 rounded bg-muted" />)}
      </div>
    </div>
  )
}
