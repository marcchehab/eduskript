'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'

/** Send / discard buttons on the product-update approval page. */
export function DraftActions({
  id,
  token,
  status,
  expired,
  recipientCount,
}: {
  id: string
  token: string
  status: string
  expired: boolean
  recipientCount: number
}) {
  const router = useRouter()
  const [message, setMessage] = useState('')

  const post = async (action: 'send' | 'discard') => {
    const res = await fetch(`/api/admin/product-updates/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token }),
    })
    const data = await res.json().catch(() => ({}))
    setMessage(
      res.ok
        ? action === 'send'
          ? `Sending to ${data.recipients} recipients. Reload to see progress.`
          : 'Discarded.'
        : `Failed: ${data.error ?? res.status}`
    )
    router.refresh()
  }

  if (status !== 'pending') {
    return <p className="text-sm text-muted-foreground">{message || `This update is ${status}; nothing to do.`}</p>
  }
  if (expired) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          The approval link expired (24 h). Send the mail again to get a new draft.
        </p>
        <Button variant="outline" onClick={() => post('discard')}>Discard</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <ConfirmationDialog
        title={`Send to ${recipientCount} recipients?`}
        description="Each opted-in teacher gets an individual mail from Marc Chéhab <marc@eduskript.org>. This cannot be undone."
        confirmText={`Send to ${recipientCount} recipients`}
        onConfirm={() => post('send')}
        trigger={<Button disabled={recipientCount === 0}>Send to {recipientCount} recipients</Button>}
      />
      <ConfirmationDialog
        title="Discard this draft?"
        description="Nothing is sent. To send it later, mail it again."
        confirmText="Discard"
        variant="destructive"
        onConfirm={() => post('discard')}
        trigger={<Button variant="outline">Discard</Button>}
      />
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  )
}

/** One-time consent mail trigger on /dashboard/admin/product-updates. */
export function ConsentRequestButton({ count }: { count: number }) {
  const [message, setMessage] = useState('')

  const send = async () => {
    const res = await fetch('/api/admin/product-updates/consent-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedCount: count }),
    })
    const data = await res.json().catch(() => ({}))
    setMessage(res.ok ? `Sending to ${data.count} teachers.` : `Failed: ${data.error ?? res.status}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <ConfirmationDialog
        title={`Send consent request to ${count} teachers?`}
        description="Each gets one mail asking whether they want product updates, with a sign-up link. Sending again mails them again."
        confirmText={`Send to ${count} teachers`}
        onConfirm={send}
        trigger={<Button variant="outline" disabled={count === 0 || !!message}>Send consent request to {count} teachers</Button>}
      />
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  )
}
