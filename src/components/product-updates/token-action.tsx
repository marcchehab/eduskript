'use client'

/**
 * One-button page body for /unsubscribe and /subscribe (product updates).
 * The click POSTs the signed token to the matching API route; GETting the
 * page alone changes nothing, so link scanners in mail gateways can't
 * (un)subscribe anybody. English with a German line, since the mails go out
 * in both languages.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  action: 'subscribe' | 'unsubscribe'
  token: string
  /** Subscriber without an account (<newsletter /> block): no settings to point to. */
  guest?: boolean
}

const COPY = {
  unsubscribe: {
    title: 'Unsubscribe from Eduskript product updates',
    titleDe: 'Von den Produkt-Updates von Eduskript abmelden',
    button: 'Unsubscribe · Abmelden',
    done: 'You are unsubscribed. You won’t get product updates any more.',
    doneDe: 'Du bist abgemeldet und erhältst keine Produkt-Updates mehr.',
  },
  subscribe: {
    title: 'Get Eduskript product updates',
    titleDe: 'Produkt-Updates von Eduskript erhalten',
    button: 'Yes, sign me up · Ja, anmelden',
    done: 'Done. You can unsubscribe any time via the link in each mail or in your account settings.',
    doneDe: 'Erledigt. Abmelden geht jederzeit über den Link in jeder Mail oder in den Kontoeinstellungen.',
  },
}

// Guests: subscribe = confirming the double opt-in; no account settings.
const GUEST_DONE = {
  unsubscribe: {
    done: 'You are unsubscribed and your address has been deleted.',
    doneDe: 'Du bist abgemeldet, deine Adresse ist gelöscht.',
  },
  subscribe: {
    done: 'Confirmed. You can unsubscribe any time via the link in each mail.',
    doneDe: 'Bestätigt. Abmelden geht jederzeit über den Link in jeder Mail.',
  },
}

export function ProductUpdatesTokenAction({ action, token, guest = false }: Props) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error' | 'expired'>('idle')
  const copy = guest ? { ...COPY[action], ...GUEST_DONE[action] } : COPY[action]

  const submit = async () => {
    setState('busy')
    try {
      const res = await fetch(`/api/product-updates/${action}?token=${encodeURIComponent(token)}`, { method: 'POST' })
      // 410: guest confirmation older than 7 days, row already deleted.
      setState(res.ok ? 'done' : res.status === 410 ? 'expired' : 'error')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center p-8 max-w-md space-y-4">
        <h1 className="text-2xl font-bold">{copy.title}</h1>
        <p className="text-muted-foreground">{copy.titleDe}</p>
        {state === 'done' ? (
          <>
            <p>{copy.done}</p>
            <p className="text-muted-foreground">{copy.doneDe}</p>
          </>
        ) : state === 'expired' ? (
          <>
            <p>This link has expired. Please sign up again.</p>
            <p className="text-muted-foreground">Dieser Link ist abgelaufen. Bitte melde dich erneut an.</p>
          </>
        ) : (
          <Button onClick={submit} disabled={state === 'busy'}>
            {copy.button}
          </Button>
        )}
        {state === 'error' && (
          <p className="text-red-600 text-sm">Something went wrong. Please try again or reply to the mail.</p>
        )}
      </div>
    </div>
  )
}

export function InvalidProductUpdatesLink() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center p-8 max-w-md space-y-2">
        <h1 className="text-2xl font-bold">Invalid link</h1>
        <p className="text-muted-foreground">
          This link is incomplete or invalid. You can change product updates in your account settings.
        </p>
        <p className="text-muted-foreground text-sm">
          Dieser Link ist ungültig. Produkt-Updates lassen sich in den Kontoeinstellungen ändern.
        </p>
      </div>
    </div>
  )
}
