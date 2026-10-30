'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/** Account-settings toggle for product-update mails (PATCH /api/user/product-updates). */
export function ProductUpdatesCard({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggle = async (next: boolean) => {
    setSaving(true)
    setError('')
    setEnabled(next)
    try {
      const res = await fetch('/api/user/product-updates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setEnabled(!next)
      setError('Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product updates</CardTitle>
        <CardDescription>
          A few mails a year about what&apos;s new in Eduskript, sent by Marc Chéhab. Each mail has
          an unsubscribe link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <Switch id="product-updates" checked={enabled} onCheckedChange={toggle} disabled={saving} />
          <Label htmlFor="product-updates">Email me product updates</Label>
        </div>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </CardContent>
    </Card>
  )
}
