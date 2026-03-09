'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Pencil, Plus } from 'lucide-react'

interface Plan {
  id: string
  name: string
  slug: string
  priceChf: number
  interval: string
  features: Record<string, unknown>
  isActive: boolean
  createdAt: string
}

export default function AdminPlansPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showDialog, setShowDialog] = useState(false)
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    priceChf: '',
    interval: 'monthly',
    features: '{}',
    isActive: true,
  })

  useEffect(() => {
    if (session && !session.user.isAdmin) {
      router.push('/dashboard')
    }
  }, [session, router])

  const fetchPlans = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/plans')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setPlans(data.plans)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch plans')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session?.user.isAdmin) fetchPlans()
  }, [session])

  const openCreateDialog = () => {
    setEditingPlan(null)
    setFormData({ name: '', slug: '', priceChf: '', interval: 'monthly', features: '{}', isActive: true })
    setShowDialog(true)
  }

  const openEditDialog = (plan: Plan) => {
    setEditingPlan(plan)
    setFormData({
      name: plan.name,
      slug: plan.slug,
      priceChf: String(plan.priceChf),
      interval: plan.interval,
      features: JSON.stringify(plan.features, null, 2),
      isActive: plan.isActive,
    })
    setShowDialog(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    let features: Record<string, unknown>
    try {
      features = JSON.parse(formData.features)
    } catch {
      setError('Features must be valid JSON')
      return
    }

    const payload = {
      name: formData.name,
      slug: formData.slug,
      priceChf: Number(formData.priceChf),
      interval: formData.interval,
      features,
      isActive: formData.isActive,
    }

    try {
      const url = editingPlan ? `/api/admin/plans/${editingPlan.id}` : '/api/admin/plans'
      const method = editingPlan ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setSuccess(editingPlan ? 'Plan updated' : 'Plan created')
      setShowDialog(false)
      fetchPlans()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save plan')
    }
  }

  const handleDeactivate = async (plan: Plan) => {
    if (!confirm(`Deactivate plan "${plan.name}"?`)) return
    setError('')
    try {
      const res = await fetch(`/api/admin/plans/${plan.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSuccess(`Plan "${plan.name}" deactivated`)
      fetchPlans()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate plan')
    }
  }

  const handleReactivate = async (plan: Plan) => {
    setError('')
    try {
      const res = await fetch(`/api/admin/plans/${plan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSuccess(`Plan "${plan.name}" reactivated`)
      fetchPlans()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reactivate plan')
    }
  }

  if (!session?.user.isAdmin) {
    return <p className="p-8">Access denied.</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Subscription Plans</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-1" /> Create Plan
        </Button>
      </div>

      {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {success && <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600">{success}</div>}

      <Card className="p-6">
        {loading ? (
          <p>Loading plans...</p>
        ) : plans.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No plans yet. Create one to get started.</p>
        ) : (
          <div className="space-y-4">
            {plans.map((plan) => (
              <div key={plan.id} className="flex items-center justify-between border-b pb-4 last:border-0">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{plan.name}</h3>
                    <Badge variant="outline" className="font-mono text-xs">{plan.slug}</Badge>
                    {!plan.isActive && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    CHF {(plan.priceChf / 100).toFixed(2)} / {plan.interval}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="icon" onClick={() => openEditDialog(plan)} title="Edit plan">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {plan.isActive ? (
                    <Button variant="ghost" size="sm" onClick={() => handleDeactivate(plan)}>
                      Deactivate
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => handleReactivate(plan)}>
                      Reactivate
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <h2 className="mb-4 text-xl font-semibold">{editingPlan ? 'Edit Plan' : 'Create Plan'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="plan-name">Name</Label>
              <Input id="plan-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="plan-slug">Slug</Label>
              <Input
                id="plan-slug"
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                required
                placeholder="pro-monthly"
              />
            </div>
            <div>
              <Label htmlFor="plan-price">Price (Rappen)</Label>
              <Input id="plan-price" type="number" value={formData.priceChf} onChange={(e) => setFormData({ ...formData, priceChf: e.target.value })} required min="0" />
              <p className="text-xs text-muted-foreground mt-1">In Rappen (cents). 2000 = CHF 20.00</p>
            </div>
            <div>
              <Label htmlFor="plan-interval">Interval</Label>
              <select
                id="plan-interval"
                value={formData.interval}
                onChange={(e) => setFormData({ ...formData, interval: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div>
              <Label htmlFor="plan-features">Features (JSON)</Label>
              <textarea
                id="plan-features"
                value={formData.features}
                onChange={(e) => setFormData({ ...formData, features: e.target.value })}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                placeholder='{"maxSkripts": 50}'
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="plan-active"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              />
              <Label htmlFor="plan-active">Active</Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button type="submit">{editingPlan ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
