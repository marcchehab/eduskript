'use client'

/**
 * Nickname join / sign-in on the class join page (/join/<code>) for classes
 * with nickname login (src/lib/nickname-login.ts). "New here" creates the
 * account and enrols it; "Already joined" signs in again, from any device.
 * Both go through the 'nickname' credentials provider (src/lib/auth.ts).
 */

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { NICKNAME_PROMPT_FLAG } from '@/components/onboarding/nickname-modal'

const PASSWORD_MIN = 6

function errorText(err: string): string {
  if (err.includes('NICKNAME_TAKEN')) return 'This nickname is already taken in this class. Choose another one.'
  if (err.includes('NICKNAME_INVALID')) return 'Nicknames have 2–24 characters: letters, digits, spaces, - and _.'
  if (err.includes('PASSWORD_INVALID')) return `The password needs at least ${PASSWORD_MIN} characters.`
  if (err.includes('CLASS_FULL')) return 'This class has reached its maximum number of students.'
  if (err.includes('CLASS_UNAVAILABLE')) return 'This class does not accept nickname sign-in (any more). Ask your teacher.'
  if (err.includes('RATE_LIMITED')) return 'Too many attempts. Please wait a few minutes.'
  if (err.includes('INVALID_CREDENTIALS')) return 'Nickname or password is wrong. Your teacher can reset your password.'
  return 'Something went wrong. Please try again.'
}

export function NicknameLoginForm({ inviteCode, onSignedIn }: {
  inviteCode: string
  /** Called after a successful sign-up (created=true) or sign-in. */
  onSignedIn: (nickname: string, created: boolean) => void
}) {
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (mode === 'new' && password !== password2) {
      setError('The two passwords are not the same.')
      return
    }
    setBusy(true)
    const result = await signIn('nickname', {
      code: inviteCode,
      nickname,
      password,
      create: mode === 'new' ? '1' : '0',
      redirect: false,
    })
    if (result?.ok && !result.error) {
      // The nickname is chosen here; skip the "Choose your nickname" welcome
      // modal (src/components/onboarding/nickname-modal-gate.tsx).
      try { window.localStorage.setItem(NICKNAME_PROMPT_FLAG, '1') } catch { /* private mode */ }
      onSignedIn(nickname.trim(), mode === 'new')
      return
    }
    setError(errorText(result?.error ?? ''))
    setBusy(false)
  }

  const switchMode = (next: 'new' | 'existing') => {
    setMode(next)
    setError('')
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
        {(['new', 'existing'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            className={`rounded-md px-3 py-1.5 ${mode === m ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`}
          >
            {m === 'new' ? 'New here' : 'Already joined'}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <Label htmlFor="nick-name">Nickname</Label>
        <Input
          id="nick-name"
          autoComplete="username"
          autoCapitalize="none"
          maxLength={24}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          required
        />
        {mode === 'new' && (
          <p className="text-xs text-muted-foreground">Pick a nickname, not your real name.</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="nick-password">Password</Label>
        <Input
          id="nick-password"
          type="password"
          autoComplete={mode === 'new' ? 'new-password' : 'current-password'}
          minLength={mode === 'new' ? PASSWORD_MIN : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {mode === 'new' && (
        <div className="space-y-2">
          <Label htmlFor="nick-password2">Repeat password</Label>
          <Input
            id="nick-password2"
            type="password"
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            required
          />
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {mode === 'new' ? 'Join class' : 'Sign in'}
      </Button>
      <p className="text-xs text-muted-foreground">
        {mode === 'new'
          ? 'Remember your nickname and password: with them and this link you can sign in again from any device. Your work is saved on the server.'
          : 'Forgot your password? Your teacher can set a new one.'}
      </p>
    </form>
  )
}
