'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Mail } from 'lucide-react'

/**
 * Email-code sign-in / sign-up (src/lib/email-login.ts): enter address → get a
 * 6-digit code by mail → enter code. The same form signs in existing accounts
 * and creates new ones; `context` (same values as the OAuth signup cookie,
 * see src/lib/signup-context.ts) decides teacher vs student for NEW accounts.
 * The address stays in this component's state between the two steps; the
 * server never stores a student's address.
 */
export function EmailCodeForm({
  context,
  callbackUrl = '/dashboard',
  idPrefix = 'email-code',
  placeholder = 'name@school.ch',
}: {
  context: string
  callbackUrl?: string
  /** Unique per form when two forms share a page (org layout columns). */
  idPrefix?: string
  placeholder?: string
}) {
  const router = useRouter()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const requestCode = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/auth/email-code/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setStep('code')
        setCode('')
      } else {
        setError(data.error || 'The code could not be sent. Please try again.')
      }
    } catch {
      setError('The code could not be sent. Please try again.')
    }
    setBusy(false)
  }

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const result = await signIn('email-code', { email, code, context, redirect: false })
    if (result?.ok && !result.error) {
      router.push(callbackUrl)
      return
    }
    const err = result?.error ?? ''
    if (err.includes('EXPIRED')) setError('This code has expired. Request a new one.')
    else if (err.includes('LOCKED')) setError('Too many wrong attempts. Request a new code.')
    else if (err.includes('RATE_LIMITED')) setError('Too many attempts. Please wait a few minutes.')
    else setError('Wrong code. Please check the email and try again.')
    setBusy(false)
  }

  if (step === 'code') {
    return (
      <form onSubmit={submitCode} className="space-y-3">
        <p className="text-sm text-muted-foreground">
          We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>. It is valid for 10 minutes.
        </p>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-code`}>Login code</Label>
          <Input
            id={`${idPrefix}-code`}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
            autoFocus
            disabled={busy}
          />
        </div>
        {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
        <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <div className="flex justify-between text-xs">
          <button type="button" className="text-muted-foreground hover:underline" onClick={() => { setStep('email'); setError('') }} disabled={busy}>
            Use another address
          </button>
          <button type="button" className="text-muted-foreground hover:underline" onClick={() => requestCode()} disabled={busy}>
            Send a new code
          </button>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={requestCode} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-email`}>Email</Label>
        <Input
          id={`${idPrefix}-email`}
          type="email"
          autoComplete="email"
          placeholder={placeholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={busy}
        />
      </div>
      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
      <Button type="submit" className="w-full" disabled={busy || !email.trim()}>
        <Mail className="w-4 h-4 mr-2" />
        {busy ? 'Sending code…' : 'Continue with email'}
      </Button>
    </form>
  )
}
