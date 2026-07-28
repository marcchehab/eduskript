'use client'

/**
 * <newsletter> — email capture for page content.
 *
 *   <newsletter />
 *   <newsletter title="Stay in the loop" description="..." button="Subscribe" />
 *
 * Addresses go to Brevo (the same account that already sends transactional
 * mail), not to our database: Brevo owns the list, the unsubscribe link and
 * the export, which is where subscription state belongs. See
 * /api/newsletter.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface NewsletterBoxProps {
  /** Identifies the site whose list this is; the server resolves it. */
  pageId?: string
  title?: string
  description?: string
  button?: string
  /**
   * Optional Brevo list id. Honoured only when it is the list the page's own
   * site already owns — the server checks, since list ids are small integers
   * shared across the whole Brevo account.
   */
  listId?: string
}

type Status = 'idle' | 'submitting' | 'done' | 'error'

export function NewsletterBox({
  pageId,
  title = 'Newsletter',
  description = 'Occasional updates. No spam, unsubscribe any time.',
  button = 'Subscribe',
  listId,
}: NewsletterBoxProps) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (status === 'submitting') return

    setStatus('submitting')
    setMessage('')

    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, pageId, listId }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setStatus('error')
        setMessage(data.error || 'Could not subscribe. Please try again later.')
        return
      }

      setStatus('done')
      setMessage(data.message || 'You are subscribed. Welcome!')
      setEmail('')
    } catch {
      setStatus('error')
      setMessage('Could not reach the server. Please try again later.')
    }
  }

  return (
    <span className="my-6 block rounded-lg border bg-muted/30 p-5">
      <span className="block font-medium">{title}</span>
      <span className="mt-1 block text-sm text-muted-foreground">{description}</span>

      {status === 'done' ? (
        <span className="mt-4 block text-sm font-medium text-primary">{message}</span>
      ) : (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email address"
            autoComplete="email"
            disabled={status === 'submitting'}
            className="bg-background sm:flex-1"
          />
          <Button type="submit" disabled={status === 'submitting' || !email}>
            {status === 'submitting' ? 'Subscribing…' : button}
          </Button>
        </form>
      )}

      {status === 'error' && (
        <span className="mt-2 block text-sm text-destructive">{message}</span>
      )}
    </span>
  )
}
