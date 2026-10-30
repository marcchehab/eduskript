'use client'

/**
 * <newsletter /> — sign-up box for Eduskript product updates
 * (src/lib/product-updates/).
 *
 *   <newsletter />
 *   <newsletter lang="de" title="…" description="…" button="…" />
 *
 * Which variant shows is decided on the client from the session, so the
 * block works on cached/ISR public pages (same approach as only-for.tsx):
 * - session loading                   → nothing
 * - not signed in                     → email form, double opt-in
 *                                       (POST /api/product-updates/signup)
 * - student                           → nothing (students get no product mail)
 * - teacher, product updates off      → one "Enable" button
 *                                       (PATCH /api/user/product-updates)
 * - teacher, already on / check fails → nothing
 *
 * Language: `lang` attribute, else the site's pageLanguage (threaded through
 * createMarkdownComponents); German for de*, English otherwise. The guest's
 * language is stored with the subscription and picks the mail footer.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export type NewsletterVariant = 'hidden' | 'guest' | 'enable'

/** Pure visibility rule; `enabled` is null while the teacher's flag is loading or unknown. */
export function newsletterVariant({
  status,
  accountType,
  enabled,
}: {
  status: 'loading' | 'authenticated' | 'unauthenticated'
  accountType?: string
  enabled: boolean | null
}): NewsletterVariant {
  if (status === 'loading') return 'hidden'
  if (status === 'unauthenticated') return 'guest'
  if (accountType !== 'teacher') return 'hidden'
  return enabled === false ? 'enable' : 'hidden'
}

const COPY = {
  de: {
    title: 'Produkt-Updates von Eduskript',
    description: 'Ein paar Mal im Jahr eine Mail, was neu ist. Abmelden jederzeit.',
    signUp: 'Anmelden',
    placeholder: 'name@schule.ch',
    emailLabel: 'E-Mail-Adresse',
    privacy: 'Gespeichert werden nur Adresse, Sprache und Zeitpunkt der Anmeldung.',
    privacyLink: 'Datenschutz',
    checkInbox: 'Fast fertig: Bitte bestätige die Anmeldung über den Link in der Mail, die wir dir eben geschickt haben.',
    enable: 'Produkt-Updates aktivieren',
    enabled: 'Aktiviert. Abschalten kannst du sie in den Kontoeinstellungen.',
    invalid: 'Bitte gib eine gültige E-Mail-Adresse ein.',
    tooMany: 'Zu viele Versuche. Bitte versuche es später nochmals.',
    failed: 'Das hat nicht geklappt. Bitte versuche es später nochmals.',
  },
  en: {
    title: 'Eduskript product updates',
    description: 'A few mails a year about what’s new. Unsubscribe any time.',
    signUp: 'Sign up',
    placeholder: 'you@example.com',
    emailLabel: 'Email address',
    privacy: 'We only store your address, language and when you signed up.',
    privacyLink: 'Privacy',
    checkInbox: 'Almost done: please confirm via the link in the mail we just sent you.',
    enable: 'Enable product updates',
    enabled: 'Enabled. You can turn them off in your account settings.',
    invalid: 'Please enter a valid email address.',
    tooMany: 'Too many attempts. Please try again later.',
    failed: 'That didn’t work. Please try again later.',
  },
}

interface NewsletterBoxProps {
  /** Explicit `lang` attribute or the site's pageLanguage (e.g. "de-CH"). */
  lang?: string | null
  title?: string
  description?: string
  button?: string
}

type Status = 'idle' | 'busy' | 'done' | 'error'

export function NewsletterBox({ lang, title, description, button }: NewsletterBoxProps) {
  const l = lang?.toLowerCase().startsWith('de') ? 'de' : 'en'
  const t = COPY[l]
  const { data: session, status: sessionStatus } = useSession()
  const accountType = session?.user?.accountType
  const isTeacher = sessionStatus === 'authenticated' && accountType === 'teacher'

  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isTeacher) return
    let cancelled = false
    fetch('/api/user/product-updates')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // Unknown state → stay hidden rather than nag.
        if (!cancelled && typeof d?.enabled === 'boolean') setEnabled(d.enabled)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isTeacher])

  const variant = newsletterVariant({ status: sessionStatus, accountType, enabled })
  // After a successful click the variant would flip to hidden; keep the confirmation visible.
  if (variant === 'hidden' && status !== 'done') return null

  const fail = (res: Response | null) => {
    setStatus('error')
    setError(res?.status === 429 ? t.tooMany : res?.status === 400 ? t.invalid : t.failed)
  }

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (status === 'busy') return
    setStatus('busy')
    setError('')
    try {
      const res = await fetch('/api/product-updates/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, lang: l }),
      })
      if (!res.ok) return fail(res)
      setStatus('done')
      setEmail('')
    } catch {
      fail(null)
    }
  }

  const enable = async () => {
    if (status === 'busy') return
    setStatus('busy')
    setError('')
    try {
      const res = await fetch('/api/user/product-updates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      })
      if (!res.ok) return fail(res)
      setStatus('done')
    } catch {
      fail(null)
    }
  }

  return (
    // span wrappers, not div: the tag can end up inside a paragraph (see cta-button.tsx).
    <span className="my-6 block rounded-lg border bg-muted/30 p-5">
      <span className="block font-medium">{title || t.title}</span>
      <span className="mt-1 block text-sm text-muted-foreground">{description || t.description}</span>

      {status === 'done' ? (
        <span className="mt-4 block text-sm font-medium text-primary">
          {sessionStatus === 'unauthenticated' ? t.checkInbox : t.enabled}
        </span>
      ) : variant === 'enable' ? (
        <span className="mt-4 block">
          <Button type="button" onClick={enable} disabled={status === 'busy'}>
            {button || t.enable}
          </Button>
        </span>
      ) : (
        <>
          <form onSubmit={signUp} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.placeholder}
              aria-label={t.emailLabel}
              autoComplete="email"
              disabled={status === 'busy'}
              className="bg-background sm:flex-1"
            />
            <Button type="submit" disabled={status === 'busy' || !email}>
              {button || t.signUp}
            </Button>
          </form>
          <span className="mt-2 block text-xs text-muted-foreground">
            {t.privacy}{' '}
            <Link href="/datenschutz" className="underline">
              {t.privacyLink}
            </Link>
          </span>
        </>
      )}

      {status === 'error' && <span className="mt-2 block text-sm text-destructive">{error}</span>}
    </span>
  )
}
