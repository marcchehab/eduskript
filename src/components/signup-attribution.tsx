'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { isOwnHost, readVisitSource, type VisitSource } from '@/lib/visit-source'

const STORAGE_KEY = 'eduskript-signup-source'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

interface StoredSource extends VisitSource {
  at: number
}

function readStored(): StoredSource | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as StoredSource
    if (typeof stored.at !== 'number' || Date.now() - stored.at > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return stored
  } catch {
    return null
  }
}

/**
 * First-touch signup attribution (see src/lib/visit-source.ts).
 *
 * On the app's own site, the first visit carrying a source (?ref=, utm_*,
 * external referrer) is remembered in localStorage for 30 days. Once the
 * visitor is logged in, it is sent to the server — which attaches it only to
 * an account created in the last 48 hours — and removed from the browser.
 * Nothing leaves the browser for visitors who never sign up.
 */
export function SignupAttribution() {
  const { status } = useSession()

  useEffect(() => {
    if (!isOwnHost(window.location.hostname)) return
    if (/^\/(auth|oauth|dashboard)(\/|$)/.test(window.location.pathname)) return
    if (readStored()) return
    const source = readVisitSource(new URL(window.location.href), document.referrer)
    if (!source) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...source, at: Date.now() }))
    } catch {
      // Storage blocked (private mode etc.) — attribution is best-effort.
    }
  }, [])

  useEffect(() => {
    if (status !== 'authenticated') return
    const stored = readStored()
    if (!stored) return
    const { at: _at, ...source } = stored
    fetch('/api/user/signup-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(source),
    })
      .then(res => {
        if (res.ok) localStorage.removeItem(STORAGE_KEY)
      })
      .catch(() => {})
  }, [status])

  return null
}
