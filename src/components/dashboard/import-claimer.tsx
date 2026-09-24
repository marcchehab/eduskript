'use client'

/**
 * Takes over a pending anonymous skript import after signup. Rendered by the
 * dashboard layout when the IMPORT_COOKIE is present (set by the import
 * preview's "Create account & take over" button). Claims once, then opens the
 * new skript. See src/app/api/script-import/claim/route.ts.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export function ImportClaimer() {
  const router = useRouter()
  const started = useRef(false)
  const [state, setState] = useState<'working' | 'error' | 'done'>('working')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (started.current) return
    started.current = true
    fetch('/api/script-import/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        setState('done')
        router.push(`/dashboard/skripts/${data.skriptSlug}`)
        router.refresh()
      })
      .catch((err) => {
        setState('error')
        setMessage(err instanceof Error ? err.message : String(err))
      })
  }, [router])

  if (state === 'done') return null
  return (
    <div
      className={`px-6 py-2 text-sm border-b ${
        state === 'error' ? 'bg-destructive/10 text-destructive border-destructive/30' : 'bg-primary/5 border-border'
      }`}
    >
      {state === 'working' ? (
        <span>
          <Loader2 className="inline w-4 h-4 mr-2 animate-spin" />
          Taking over your imported skript…
        </span>
      ) : (
        <span>Could not take over the imported skript: {message}</span>
      )}
    </div>
  )
}
