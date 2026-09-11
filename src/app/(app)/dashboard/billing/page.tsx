'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Check, AlertCircle, Loader2, Handshake, GraduationCap, Building2, FileText } from 'lucide-react'
import { SupporterBadge } from '@/components/ui/supporter-badge'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'

interface PlanData {
  id: string
  name: string
  slug: string
  priceChf: number
  interval: string
  features: Record<string, unknown>
}

interface SubscriptionData {
  id: string
  status: string
  plan: PlanData
  currentPeriodEnd: string | null
  cancelledAt: string | null
  trialEndsAt: string | null
}

// Marketing copy per plan family (matched on slug prefix). Plans without a
// match render as a generic card, so DB-only plans (e.g. legacy "pro-monthly")
// still work.
const CLASSROOM_FEATURES = [
  'AI editing',
  'Classes with live student progress',
  'Exams with Safe Exam Browser (SEB)',
  'SEB-Lockdown mode in class',
  'AI-assisted grading with rubrics',
  'Broadcast your annotations to students',
  'Create your own plugins with AI',
]

const SUPPORTER_FEATURES = [
  'Everything in Classroom',
  'Supporter badge on your public page',
]

const FREE_FEATURES = [
  'Unlimited skripts & pages',
  'Full markdown editor, math & code editors',
  'File & media uploads',
  'Your public teacher page',
]

const SCHOOL_FEATURES = [
  'Classroom for your whole team',
  'Billing by invoice — no credit card',
  'Admin overview',
  'Priority support',
]

const SCHOOL_CONTACT = 'mailto:marc@informatikgarten.ch?subject=Eduskript%20School%20licence'

function isSupporter(slug: string) {
  return slug.startsWith('supporter')
}

export default function BillingPage() {
  const { update: updateSession } = useSession()
  const searchParams = useSearchParams()
  const dialog = useAlertDialog()
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [plans, setPlans] = useState<PlanData[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/subscriptions')
      if (!res.ok) throw new Error('Failed to fetch subscription data')
      const data = await res.json()
      setSubscription(data.subscription)
      setPlans(data.plans)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Handle redirect status from Payrexx
  useEffect(() => {
    const status = searchParams.get('status')
    if (status === 'success') {
      setSuccessMessage('Payment successful! Your subscription is being activated.')
      // Re-fetch after a short delay to allow webhook processing
      setTimeout(async () => {
        await fetchData()
        await updateSession()
      }, 3000)
    } else if (status === 'failed') {
      setError('Payment failed. Please try again.')
    } else if (status === 'cancelled') {
      setError('Payment was cancelled.')
    }
  }, [searchParams, fetchData, updateSession])

  async function handleSubscribe(planId: string) {
    setActionLoading(planId)
    setError(null)
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create checkout')
      // Redirect to Payrexx checkout
      window.location.href = data.checkoutUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout')
      setActionLoading(null)
    }
  }

  async function handleReactivate() {
    setActionLoading('reactivate')
    setError(null)
    try {
      const res = await fetch('/api/subscriptions/reactivate', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to re-enable auto-renewal')
      setSuccessMessage('Auto-renewal is back on.')
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-enable auto-renewal')
    } finally {
      setActionLoading(null)
    }
  }

  function handleCancel() {
    dialog.showConfirm('Stop auto-renewal? You keep full access until the end of the period you already paid for.', async () => {
      setActionLoading('cancel')
      setError(null)
      try {
        const res = await fetch('/api/subscriptions/cancel', { method: 'POST' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to cancel')
        if (data.activeUntil) {
          setSuccessMessage(`Auto-renewal stopped. You'll keep access until ${formatDate(data.activeUntil)}.`)
        } else {
          setSuccessMessage('Subscription ended.')
        }
        await fetchData()
        await updateSession()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to cancel subscription')
      } finally {
        setActionLoading(null)
      }
    }, { destructive: true, title: 'Stop auto-renewal', confirmText: 'Stop auto-renewal' })
  }

  const classroomYearly = plans.find((p) => p.slug === 'classroom-yearly')
  const classroomMonthly = plans.find((p) => p.slug === 'classroom-monthly')
  const supporterPlan = plans.find((p) => isSupporter(p.slug))
  const knownIds = new Set(
    [classroomYearly, classroomMonthly, supporterPlan].filter(Boolean).map((p) => p!.id)
  )
  const otherPlans = plans.filter((p) => !knownIds.has(p.id))
  // With an active/past_due subscription the grid stays visible for
  // comparison, but other plans can't be bought (the API blocks checkout
  // while a subscription is active).
  const lockedIn = subscription != null && subscription.status !== 'trialing'
  const currentSlug = subscription?.plan.slug

  function planButton(plan: PlanData, label: string, variant?: 'outline', className?: string) {
    if (lockedIn && plan.slug === currentSlug) {
      return (
        <Button variant="outline" className={`mt-6 w-full ${className ?? ''}`} disabled>
          Current plan
        </Button>
      )
    }
    if (lockedIn) {
      return (
        <div className="mt-6 space-y-1">
          <Button variant="outline" className={`w-full ${className ?? ''}`} disabled>
            {label}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Available when your current plan ends
          </p>
        </div>
      )
    }
    return (
      <Button
        variant={variant}
        className={`mt-6 w-full ${className ?? ''}`}
        onClick={() => handleSubscribe(plan.id)}
        disabled={actionLoading === plan.id}
      >
        {actionLoading === plan.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {label}
      </Button>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <>
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground mt-1">
          Manage your subscription and payment method.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/50 bg-green-500/10 p-4 text-green-700 dark:text-green-400">
          <Check className="h-5 w-5 shrink-0" />
          <p>{successMessage}</p>
        </div>
      )}

      {/* Current Subscription */}
      {subscription && (
        <div className={`rounded-xl border p-6 space-y-4 ${isSupporter(subscription.plan.slug) ? 'border-amber-400/60 bg-gradient-to-br from-amber-50/60 to-transparent dark:from-amber-950/20' : ''}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">Current plan</h2>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-2xl font-bold">{subscription.plan.name}</p>
                {isSupporter(subscription.plan.slug) && <SupporterBadge />}
              </div>
            </div>
            <StatusBadge status={subscription.status} />
          </div>

          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              {formatPrice(subscription.plan.priceChf)} / {subscription.plan.interval === 'monthly' ? 'month' : 'year'}
            </p>
            {subscription.status === 'trialing' && subscription.trialEndsAt ? (
              <p>Trial ends in {daysUntil(subscription.trialEndsAt)} days ({formatDate(subscription.trialEndsAt)})</p>
            ) : subscription.currentPeriodEnd ? (
              <p>
                {subscription.cancelledAt
                  ? `Auto-renewal off — access until ${formatDate(subscription.currentPeriodEnd)}`
                  : `Next billing date: ${formatDate(subscription.currentPeriodEnd)}`}
              </p>
            ) : null}
          </div>

          {/* No cancel button during a trial: a trial costs nothing and ends
              on its own. Cancelling it was irreversible for the user — nothing
              re-grants a trial, so only an admin could restore access. */}

          {subscription.status === 'active' && !subscription.cancelledAt && (
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={actionLoading === 'cancel'}
            >
              {actionLoading === 'cancel' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Stop Auto-Renewal
            </Button>
          )}

          {subscription.status === 'active' && subscription.cancelledAt && (
            <div className="space-y-2">
              <Button
                onClick={handleReactivate}
                disabled={actionLoading === 'reactivate'}
              >
                {actionLoading === 'reactivate' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Re-enable Auto-Renewal
              </Button>
              <p className="text-sm text-muted-foreground">
                Billing simply continues on {subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : 'the next billing date'}.
              </p>
            </div>
          )}

          {subscription.status === 'past_due' && (
            <div className="space-y-3">
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Your last payment failed. Update your payment method to keep your subscription active.
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleSubscribe(subscription.plan.id)}
                  disabled={actionLoading === subscription.plan.id}
                >
                  {actionLoading === subscription.plan.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Update payment method
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={actionLoading === 'cancel'}
                >
                  {actionLoading === 'cancel' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Stop Auto-Renewal
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Plans */}
      <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            {subscription?.status === 'trialing' ? 'Choose your plan' : 'Plans'}
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {/* Free */}
            <div className="rounded-xl border p-6 flex flex-col">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold">Free</h3>
              </div>
              <p className="text-3xl font-bold mt-3">
                CHF 0
                <span className="text-sm font-normal text-muted-foreground"> / forever</span>
              </p>
              <p className="text-sm text-muted-foreground mt-1">Write and publish without limits.</p>
              <FeatureList features={FREE_FEATURES} />
              <div className="mt-6 h-10 flex items-center justify-center text-sm text-muted-foreground">
                {!subscription && 'Your current plan'}
              </div>
            </div>

            {/* Classroom */}
            {classroomYearly && (
              <div className="relative rounded-xl border-2 border-primary p-6 flex flex-col shadow-sm">
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground">
                  Recommended
                </span>
                <div className="flex items-center gap-2">
                  <GraduationCap className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold">Classroom</h3>
                </div>
                <p className="text-3xl font-bold mt-3">
                  {formatPrice(classroomYearly.priceChf)}
                  <span className="text-sm font-normal text-muted-foreground"> / year</span>
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {formatPrice(Math.round(classroomYearly.priceChf / 12 / 10) * 10)} per month
                </p>
                <FeatureList features={CLASSROOM_FEATURES} />
                {/* The monthly variant shares the card; mark it current too */}
                {lockedIn && currentSlug === 'classroom-monthly' ? (
                  <Button variant="outline" className="mt-6 w-full" disabled>
                    Current plan (monthly)
                  </Button>
                ) : (
                  planButton(classroomYearly, subscription?.status === 'trialing' ? 'Upgrade' : 'Subscribe')
                )}
                {classroomMonthly && !lockedIn && (
                  <button
                    className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                    onClick={() => handleSubscribe(classroomMonthly.id)}
                    disabled={actionLoading === classroomMonthly.id}
                  >
                    {actionLoading === classroomMonthly.id
                      ? 'Redirecting…'
                      : `or ${formatPrice(classroomMonthly.priceChf)} monthly`}
                  </button>
                )}
              </div>
            )}

            {/* Supporter */}
            {supporterPlan && (
              <div className="rounded-xl border border-amber-400/60 bg-gradient-to-br from-amber-50/60 to-transparent dark:from-amber-950/20 p-6 flex flex-col">
                <div className="flex items-center gap-2">
                  <Handshake className="h-5 w-5 text-amber-500" />
                  <h3 className="text-lg font-semibold">Supporter</h3>
                </div>
                <p className="text-3xl font-bold mt-3">
                  {formatPrice(supporterPlan.priceChf)}
                  <span className="text-sm font-normal text-muted-foreground"> / year</span>
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  For teachers who want Eduskript to exist.
                </p>
                <FeatureList features={SUPPORTER_FEATURES} accent />
                <div className="mt-4 flex justify-center">
                  <SupporterBadge />
                </div>
                <div className="-mt-2">
                  {planButton(supporterPlan, 'Become a Supporter', 'outline', 'border-amber-400/60 hover:bg-amber-100/60 dark:hover:bg-amber-950/40')}
                </div>
              </div>
            )}

            {/* Any plans without curated copy (e.g. legacy ones) */}
            {otherPlans.map((plan) => (
              <GenericPlanCard
                key={plan.id}
                plan={plan}
                onSubscribe={handleSubscribe}
                loading={actionLoading === plan.id}
                isTrialing={subscription?.status === 'trialing'}
                isCurrent={lockedIn && plan.slug === currentSlug}
                locked={lockedIn}
              />
            ))}
          </div>

          {/* School */}
          <div className="rounded-xl border p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold">School</h3>
                <span className="text-sm text-muted-foreground">
                  — CHF 59 per teacher / year, from 5 teachers
                </span>
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                {SCHOOL_FEATURES.map((f) => (
                  <li key={f} className="flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <Button variant="outline" asChild className="shrink-0">
              <a href={SCHOOL_CONTACT}>Contact us</a>
            </Button>
          </div>
      </div>
    </div>
    <AlertDialogModal
      open={dialog.open} onOpenChange={dialog.setOpen}
      type={dialog.type} title={dialog.title} message={dialog.message}
      onConfirm={dialog.onConfirm} showCancel={dialog.showCancel}
      confirmText={dialog.confirmText} cancelText={dialog.cancelText}
      destructive={dialog.destructive}
    />
    </>
  )
}

function FeatureList({ features, accent }: { features: string[]; accent?: boolean }) {
  return (
    <ul className="mt-4 space-y-2 flex-1">
      {features.map((f) => (
        <li key={f} className="flex items-start gap-2 text-sm">
          <Check className={`h-4 w-4 shrink-0 mt-0.5 ${accent ? 'text-amber-500' : 'text-green-500'}`} />
          <span>{f}</span>
        </li>
      ))}
    </ul>
  )
}

function formatPrice(rappen: number): string {
  const chf = rappen / 100
  return Number.isInteger(chf) ? `CHF ${chf}` : `CHF ${chf.toFixed(2)}`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('de-CH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function daysUntil(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    trialing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    past_due: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
    incomplete: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.incomplete}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

function GenericPlanCard({
  plan,
  onSubscribe,
  loading,
  isTrialing,
  isCurrent,
  locked,
}: {
  plan: PlanData
  onSubscribe: (planId: string) => void
  loading: boolean
  isTrialing?: boolean
  isCurrent?: boolean
  locked?: boolean
}) {
  const features = plan.features as Record<string, unknown>

  return (
    <div className="rounded-xl border p-6 flex flex-col">
      <h3 className="text-lg font-semibold">{plan.name}</h3>
      <p className="text-3xl font-bold mt-3">
        {formatPrice(plan.priceChf)}
        <span className="text-sm font-normal text-muted-foreground">
          /{plan.interval === 'monthly' ? 'mo' : 'yr'}
        </span>
      </p>

      {features && Object.keys(features).length > 0 && (
        <ul className="mt-4 space-y-2 flex-1">
          {Object.entries(features).map(([key, value]) => (
            <li key={key} className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              <span>
                {typeof value === 'boolean'
                  ? key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())
                  : `${key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}: ${value}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant={locked ? 'outline' : undefined}
        className="mt-6 w-full"
        onClick={() => onSubscribe(plan.id)}
        disabled={loading || locked}
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {isCurrent ? 'Current plan' : isTrialing ? 'Upgrade' : 'Subscribe'}
      </Button>
    </div>
  )
}
