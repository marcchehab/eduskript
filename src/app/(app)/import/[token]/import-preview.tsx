'use client'

/**
 * Preview of an anonymous skript import. While the job runs it polls
 * GET /api/script-import/<token>; once ready it renders the pages with the
 * regular client MarkdownRenderer (images from the import's media route).
 * "Create account & take over" stores the token in a cookie
 * (POST /api/script-import/<token>) and sends the user to signup; the
 * dashboard then claims it (ImportClaimer). Signed-in users claim directly.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MarkdownRenderer } from '@/components/markdown/markdown-renderer.client'
import { useUiLocale, UiLocaleSwitcher } from '@/lib/i18n/client'
import { pick } from '@/lib/i18n/locale'
import type { ImportWarnings } from '@/lib/script-import/service'

interface Props {
  token: string
  status: 'processing' | 'ready' | 'failed'
  error: string | null
  title: string
  pages: { title: string; slug: string; content: string }[]
  startedAt: string
  expiresAt: string
  claimed: boolean
  fileList: { id: string; name: string; url: string }[]
  signedIn: boolean
  warnings: ImportWarnings | null
}

export function ImportPreview(props: Props) {
  const { token, status, error, title, pages, fileList, signedIn, claimed } = props
  const locale = useUiLocale()
  const t = (de: string, en: string) => pick(locale, { de, en })
  const router = useRouter()
  const [active, setActive] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [claimError, setClaimError] = useState('')

  useEffect(() => {
    if (status !== 'processing') return
    const started = new Date(props.startedAt).getTime()
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000)
    const poll = setInterval(async () => {
      const res = await fetch(`/api/script-import/${token}`).catch(() => null)
      const data = await res?.json().catch(() => null)
      if (data && data.status !== 'processing') router.refresh()
    }, 3000)
    return () => {
      clearInterval(tick)
      clearInterval(poll)
    }
  }, [status, token, router, props.startedAt])

  const takeOver = async () => {
    setBusy(true)
    setClaimError('')
    if (!signedIn) {
      const res = await fetch(`/api/script-import/${token}`, { method: 'POST' })
      if (!res.ok) {
        setClaimError(t('Das Skript ist nicht mehr verfügbar.', 'This skript is no longer available.'))
        setBusy(false)
        return
      }
      router.push('/auth/signup')
      return
    }
    const res = await fetch('/api/script-import/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setClaimError(data.error || `HTTP ${res.status}`)
      setBusy(false)
      return
    }
    router.push(`/dashboard/skripts/${data.skriptSlug}`)
  }

  const header = (
    <header className="flex items-center justify-between gap-4 px-4 sm:px-8 py-3 border-b border-border">
      <Link href="/import" className="font-semibold text-lg">Eduskript</Link>
      <UiLocaleSwitcher />
    </header>
  )

  if (status === 'processing') {
    return (
      <div className="min-h-screen bg-background">
        {header}
        <main className="max-w-xl mx-auto px-4 py-20 text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin mx-auto text-primary" />
          <h1 className="text-2xl font-semibold">{t('Ihr Skript wird umgewandelt …', 'Converting your script …')}</h1>
          <p className="text-muted-foreground">
            {t(
              'Formeln, Tabellen und Bilder werden übernommen, Merksätze und Aufgaben als Kästen gesetzt und das Dokument in Seiten pro Kapitel aufgeteilt. Das dauert meist 30–60 Sekunden.',
              'Formulas, tables and images are kept, key points and exercises become boxes, and the document is split into one page per chapter. This usually takes 30–60 seconds.'
            )}
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">{elapsed} s</p>
        </main>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="min-h-screen bg-background">
        {header}
        <main className="max-w-xl mx-auto px-4 py-20 text-center space-y-4">
          <AlertTriangle className="w-10 h-10 mx-auto text-destructive" />
          <h1 className="text-2xl font-semibold">{t('Umwandlung fehlgeschlagen', 'Conversion failed')}</h1>
          <p className="text-muted-foreground">{error}</p>
          <Button asChild variant="outline">
            <Link href="/import">{t('Andere Datei hochladen', 'Upload another file')}</Link>
          </Button>
        </main>
      </div>
    )
  }

  const page = pages[Math.min(active, pages.length - 1)]
  const w = props.warnings
  const notices = [
    w?.formulasTranscribed
      ? t(
          `${w.formulasTranscribed} Formeln lagen im alten Word-Formeleditor vor und wurden automatisch abgelesen. Bitte stichprobenartig prüfen.`,
          `${w.formulasTranscribed} formulas used Word's old equation editor and were read automatically. Please spot-check them.`
        )
      : null,
    w?.formulasAsImages
      ? t(
          `${w.formulasAsImages} Formeln konnten nicht abgelesen werden und erscheinen als Bild.`,
          `${w.formulasAsImages} formulas could not be read and are shown as pictures.`
        )
      : null,
    w?.imagesDropped
      ? t(
          `${w.imagesDropped} Grafiken liegen als Word-Vektorgrafik vor und fehlen. Sie sind im Text markiert.`,
          `${w.imagesDropped} graphics are Word vector graphics and are missing. They are marked in the text.`
        )
      : null,
    w?.drawingsRendered
      ? t(
          `${w.drawingsRendered} Zeichnungen aus Word-Formen wurden als Bild nachgezeichnet. Kleine Abweichungen (Schrift, Abstände) sind möglich.`,
          `${w.drawingsRendered} drawings made from Word shapes were redrawn as pictures. Small differences (fonts, spacing) are possible.`
        )
      : null,
    w?.drawingsDropped
      ? t(
          `${w.drawingsDropped} Zeichnungen aus Word-Formen (Pfeile, Kästchen mit Beschriftung) konnten nicht übernommen werden. Sie sind im Text markiert.`,
          `${w.drawingsDropped} drawings made from Word shapes (arrows, labelled boxes) could not be taken over. They are marked in the text.`
        )
      : null,
    w?.chunksUncleaned
      ? t(
          `${w.chunksUncleaned} Abschnitte wurden nur umgewandelt, nicht aufbereitet (Kästen, Formeln).`,
          `${w.chunksUncleaned} sections were only converted, not tidied up (boxes, formulas).`
        )
      : null,
  ].filter(Boolean)
  const expires = new Date(props.expiresAt).toLocaleDateString(locale === 'de' ? 'de-CH' : 'en-GB')

  return (
    <div className="min-h-screen bg-background">
      {header}
      <div className="sticky top-0 z-20 border-b border-border bg-primary/5 backdrop-blur px-4 sm:px-8 py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <p className="text-sm">
          <Sparkles className="inline w-4 h-4 mr-1 text-primary" />
          {claimed
            ? (
                <>
                  {t('Dieses Skript wurde bereits in einen Account übernommen.', 'This skript has already been taken over into an account.')}{' '}
                  <Link href="/dashboard" className="underline">Dashboard</Link>
                </>
              )
            : t(
                `Private Vorschau, gelöscht am ${expires}. Gefällt es Ihnen? Übernehmen Sie es in Ihren Account und bearbeiten Sie es weiter.`,
                `Private preview, deleted on ${expires}. Like it? Take it over into your account and keep editing.`
              )}
        </p>
        {!claimed && (
          <div className="flex flex-col items-end gap-1">
            <Button onClick={takeOver} disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {signedIn
                ? t('In meinen Account übernehmen', 'Take over into my account')
                : t('Account erstellen & Skript übernehmen', 'Create account & take over skript')}
            </Button>
            {!signedIn && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={async () => {
                  await fetch(`/api/script-import/${token}`, { method: 'POST' })
                  router.push('/auth/signin?callbackUrl=/dashboard')
                }}
              >
                {t('Ich habe schon einen Account', 'I already have an account')}
              </button>
            )}
            {claimError && <span className="text-xs text-destructive">{claimError}</span>}
          </div>
        )}
      </div>

      <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-6 px-4 sm:px-8 py-6">
        <nav className="md:w-60 shrink-0">
          <p className="font-semibold mb-2">{title}</p>
          <ol className="space-y-1 text-sm">
            {pages.map((p, i) => (
              <li key={p.slug}>
                <button
                  type="button"
                  onClick={() => {
                    setActive(i)
                    window.scrollTo({ top: 0 })
                  }}
                  className={`w-full text-left rounded px-2 py-1 ${
                    i === active ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'
                  }`}
                >
                  {p.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <article className="flex-1 min-w-0 prose-theme">
          {notices.length > 0 && active === 0 && (
            <div className="not-prose mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm space-y-1">
              {notices.map((n) => (
                <p key={n}>
                  <AlertTriangle className="inline w-4 h-4 mr-1 text-amber-600" />
                  {n}
                </p>
              ))}
            </div>
          )}
          {page && <MarkdownRenderer key={page.slug} content={page.content} fileList={fileList} pageLanguage="de-CH" />}
          <div className="flex justify-between mt-10 text-sm">
            {active > 0 ? (
              <button type="button" className="underline" onClick={() => { setActive(active - 1); window.scrollTo({ top: 0 }) }}>
                ← {pages[active - 1].title}
              </button>
            ) : <span />}
            {active < pages.length - 1 && (
              <button type="button" className="underline" onClick={() => { setActive(active + 1); window.scrollTo({ top: 0 }) }}>
                {pages[active + 1].title} →
              </button>
            )}
          </div>
        </article>
      </div>
    </div>
  )
}
