'use client'

/**
 * Supporter badge section in site settings. Rendered only for supporter-plan
 * teachers (parent checks billingPlan). Saves via /api/user/supporter-badge.
 */

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Loader2 } from 'lucide-react'
import { SupporterBadge } from '@/components/ui/supporter-badge'

export function SupporterBadgeSettings({ siteId }: { siteId?: string }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [message, setMessage] = useState('')
  const [defaultMessage, setDefaultMessage] = useState('')
  const [saved, setSaved] = useState(false)

  const siteQuery = siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''

  useEffect(() => {
    fetch(`/api/user/supporter-badge${siteQuery}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setHidden(data.hidden)
          setMessage(data.message)
          setDefaultMessage(data.defaultMessage)
        }
      })
      .finally(() => setLoading(false))
  }, [siteQuery])

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/user/supporter-badge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, hidden, message }),
      })
      if (res.ok) setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <div className="space-y-4 border-t pt-6">
      <div>
        <Label className="text-sm font-medium">Supporter Badge</Label>
        <p className="text-sm text-muted-foreground mt-1">
          Thank you for supporting Eduskript! Your badge shows at the bottom of
          this site&apos;s sidebar and links to the supporters page.
        </p>
      </div>

      {!hidden && (
        <SupporterBadge message={message || defaultMessage} />
      )}

      <div className="space-y-2">
        <Label htmlFor="supporter-message" className="text-sm">Badge message</Label>
        <Input
          id="supporter-message"
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 60))}
          placeholder={defaultMessage}
          maxLength={60}
          className="max-w-sm"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={hidden}
          onChange={(e) => setHidden(e.target.checked)}
        />
        Hide my badge (also removes this site from the supporters page)
      </label>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving} variant="outline">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Badge Settings
        </Button>
        {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
      </div>
    </div>
  )
}
