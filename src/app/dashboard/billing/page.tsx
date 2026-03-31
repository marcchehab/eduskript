'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { CreditCard, Check, AlertCircle, Loader2 } from 'lucide-react'

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

export default function BillingPage() {
  const { update: updateSession } = useSession()
  const searchParams = useSearchParams()
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
  }, [searchParams, fetchData])

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

  async function handleCancel() {
    if (!confirm('Are you sure you want to cancel your subscription?')) return
    setActionLoading('cancel')
    setError(null)
    try {
      const res = await fetch('/api/subscriptions/cancel', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to cancel')
      if (data.activeUntil) {
        setSuccessMessage(`Subscription cancelled. You'll keep access until ${formatDate(data.activeUntil)}.`)
      } else {
        setSuccessMessage('Subscription cancelled.')
      }
      await fetchData()
      await updateSession()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel subscription')
    } finally {
      setActionLoading(null)
    }
  }

  function formatPrice(rappen: number): string {
    return `CHF ${(rappen / 100).toFixed(2)}`
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
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
        <div className="rounded-lg border p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Current Plan</h2>
              <p className="text-2xl font-bold mt-1">{subscription.plan.name}</p>
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
                  ? `Cancelled — access until ${formatDate(subscription.currentPeriodEnd)}`
                  : `Next billing date: ${formatDate(subscription.currentPeriodEnd)}`}
              </p>
            ) : null}
          </div>

          {subscription.status === 'trialing' && (
            <div className="flex gap-2">
              <Button
                onClick={() => handleSubscribe(subscription.plan.id)}
                disabled={actionLoading === subscription.plan.id}
              >
                {actionLoading === subscription.plan.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Upgrade to Paid
              </Button>
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={actionLoading === 'cancel'}
              >
                {actionLoading === 'cancel' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Cancel Trial
              </Button>
            </div>
          )}

          {subscription.status === 'active' && !subscription.cancelledAt && (
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={actionLoading === 'cancel'}
            >
              {actionLoading === 'cancel' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cancel Subscription
            </Button>
          )}

          {subscription.status === 'past_due' && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Your last payment failed. Please update your payment method.
            </p>
          )}
        </div>
      )}

      {/* Available Plans */}
      {plans.length > 0 && (!subscription || subscription.status === 'trialing') && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Choose a Plan</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                onSubscribe={handleSubscribe}
                loading={actionLoading === plan.id}
                isTrialing={subscription?.status === 'trialing'}
              />
            ))}
          </div>
        </div>
      )}

      {/* Free tier info when no plans exist yet */}
      {plans.length === 0 && (!subscription || subscription.status === 'trialing') && (
        <div className="rounded-lg border p-6 text-center">
          <CreditCard className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <h2 className="text-lg font-semibold">Free Plan</h2>
          <p className="text-muted-foreground mt-1">
            You&apos;re on the free plan. Paid plans will be available soon.
          </p>
        </div>
      )}
    </div>
  )
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

function PlanCard({
  plan,
  onSubscribe,
  loading,
  isTrialing,
}: {
  plan: PlanData
  onSubscribe: (planId: string) => void
  loading: boolean
  isTrialing?: boolean
}) {
  const features = plan.features as Record<string, unknown>

  return (
    <div className="rounded-lg border p-6 flex flex-col">
      <h3 className="text-lg font-semibold">{plan.name}</h3>
      <p className="text-3xl font-bold mt-2">
        CHF {(plan.priceChf / 100).toFixed(2)}
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
        className="mt-6 w-full"
        onClick={() => onSubscribe(plan.id)}
        disabled={loading}
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {isTrialing ? 'Upgrade' : 'Subscribe'}
      </Button>
    </div>
  )
}
