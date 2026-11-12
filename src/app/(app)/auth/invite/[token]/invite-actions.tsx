'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ShieldCheck } from 'lucide-react'

export function InviteActions({ token, inviteCode }: { token: string; inviteCode: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [optedOut, setOptedOut] = useState(false)

  const join = async () => {
    setBusy(true)
    setError('')
    const result = await signIn('email-code', { inviteToken: token, redirect: false })
    if (result?.ok && !result.error) {
      // Membership + identity consent run through the regular join page.
      router.push(`/classes/join/${inviteCode}`)
      return
    }
    setError('This invite link is invalid or has expired.')
    setBusy(false)
  }

  const optOut = async () => {
    setBusy(true)
    setError('')
    const res = await fetch('/api/auth/invite/opt-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (res.ok) setOptedOut(true)
    else setError('This invite link is invalid or has expired.')
    setBusy(false)
  }

  if (optedOut) {
    return (
      <p className="text-sm text-center text-muted-foreground">
        Done. You won&apos;t receive class invitations from Eduskript anymore.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <Button className="w-full" onClick={join} disabled={busy}>
        {busy ? 'Signing in…' : 'Join the class'}
      </Button>
      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
        <span>Eduskript doesn&apos;t store your email address. Student accounts use a pseudonym.</span>
      </div>
      <button
        type="button"
        onClick={optOut}
        disabled={busy}
        className="w-full text-xs text-muted-foreground hover:underline"
      >
        Don&apos;t send me invites
      </button>
    </div>
  )
}
