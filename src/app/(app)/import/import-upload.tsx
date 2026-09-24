'use client'

/**
 * Upload form of the anonymous skript import (/import). Solves the
 * proof-of-work challenge (src/lib/script-import/pow.ts) in the background
 * while the user picks a file, then POSTs to /api/script-import and moves on
 * to the preview /import/<token>. Bilingual (de default) like the other
 * marketing-facing surfaces, see src/lib/i18n/locale.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { FileText, Loader2, ShieldCheck, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUiLocale, UiLocaleSwitcher } from '@/lib/i18n/client'
import { pick } from '@/lib/i18n/locale'

interface Challenge {
  salt: string
  expires: number
  difficulty: number
  sig: string
}

const MAX_MB = 20

type Locale = 'de' | 'en'
type Hint = { title: string; body: string; steps: string[] }

/**
 * Friendly explanations for formats we don't import (yet). Only .docx is
 * converted; there is deliberately no server-side LibreOffice (image size),
 * so the teacher re-saves the file themselves. Formula note (checked locally
 * 2026-09-23 with LibreOffice 26.8 on a 1999 .doc): LibreOffice turns old
 * Equation Editor formulas into Word formulas when saving as .docx, but
 * Symbol-font glyphs come out wrong (∞ → ¥, ² → ´; cleanup.ts asks the model
 * to fix these). Word was NOT tested (no Word here); it is assumed to keep
 * them as OLE objects with a WMF picture, which the import transcribes.
 */
function formatHint(ext: string, locale: Locale): Hint | null {
  const de = locale === 'de'
  const resave = de
    ? [
        'Word: Datei → Speichern unter → Dateityp «Word-Dokument (*.docx)»',
        'LibreOffice: Datei → Speichern unter → Dateityp «Word 2007–365 (.docx)»',
        'Pages: Ablage → Exportieren → Word',
      ]
    : [
        'Word: File → Save As → type "Word Document (*.docx)"',
        'LibreOffice: File → Save As → type "Word 2007–365 (.docx)"',
        'Pages: File → Export To → Word',
      ]
  const formulas = de
    ? 'Formeln aus dem alten Formel-Editor gehen dabei nicht verloren: wir lesen sie beim Import automatisch ab.'
    : "Formulas from the old equation editor aren't lost: the import reads them automatically."
  switch (ext) {
    case 'doc':
      return de
        ? {
            title: 'Oh, eine .doc-Datei – die ist älter als manche Ihrer Schülerinnen und Schüler 😄',
            body: `Öffnen Sie sie kurz und speichern Sie sie als .docx, dann klappt's. ${formulas}`,
            steps: resave,
          }
        : {
            title: 'Oh, a .doc file – older than some of your students 😄',
            body: `Open it and save it as .docx, then it works. ${formulas}`,
            steps: resave,
          }
    case 'odt':
    case 'ott':
      return de
        ? {
            title: 'Eine LibreOffice-Datei – sympathisch! Wir lesen aber (noch) nur Word.',
            body: 'Speichern Sie sie in LibreOffice kurz als .docx. Formeln werden dabei zu echten Word-Formeln.',
            steps: [resave[1]],
          }
        : {
            title: 'A LibreOffice file – nice! We only read Word (for now).',
            body: 'Save it as .docx in LibreOffice. Formulas become real Word formulas along the way.',
            steps: [resave[1]],
          }
    case 'pages':
      return de
        ? { title: 'Pages-Dateien können wir (noch) nicht lesen.', body: 'Exportieren Sie sie als Word-Datei:', steps: [resave[2]] }
        : { title: "We can't read Pages files (yet).", body: 'Export it as a Word file:', steps: [resave[2]] }
    case 'pdf':
      return de
        ? {
            title: 'PDF kommt in Phase 2 – versprochen.',
            body: 'Aus einem PDF lassen sich Formeln und Tabellen nur mühsam zurückgewinnen. Haben Sie die Word-Datei, aus der das PDF entstanden ist? Die klappt schon heute.',
            steps: [],
          }
        : {
            title: 'PDF is coming in phase 2 – promise.',
            body: 'Formulas and tables are hard to recover from a PDF. Do you have the Word file the PDF was made from? That works today.',
            steps: [],
          }
    case 'docx':
      return null
    default:
      return de
        ? { title: 'Dieses Format können wir nicht lesen.', body: 'Bitte laden Sie eine Word-Datei (.docx) hoch.', steps: [] }
        : { title: "We can't read this format.", body: 'Please upload a Word file (.docx).', steps: [] }
  }
}

function zeroBits(bytes: Uint8Array): number {
  let bits = 0
  for (const b of bytes) {
    if (b === 0) {
      bits += 8
      continue
    }
    return bits + Math.clz32(b) - 24
  }
  return bits
}

/** Brute-force a nonce; yields to the event loop every 2000 hashes. */
async function solve(c: Challenge, signal: { cancelled: boolean }): Promise<string | null> {
  const enc = new TextEncoder()
  for (let n = 0; !signal.cancelled; n++) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${c.salt}:${n}`)))
    if (zeroBits(digest) >= c.difficulty) return String(n)
    if (n % 2000 === 0) await new Promise((r) => setTimeout(r, 0))
  }
  return null
}

export function ImportUpload() {
  const locale = useUiLocale()
  const t = (de: string, en: string) => pick(locale, { de, en })
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [pow, setPow] = useState<{ challenge: Challenge; nonce: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [hint, setHint] = useState<Hint | null>(null)

  useEffect(() => {
    const signal = { cancelled: false }
    fetch('/api/script-import/challenge')
      .then((r) => r.json())
      .then(async (challenge: Challenge) => {
        const nonce = await solve(challenge, signal)
        if (nonce !== null) setPow({ challenge, nonce })
      })
      .catch(() => setError('Network error'))
    return () => {
      signal.cancelled = true
    }
  }, [])

  const pickFile = useCallback(
    (f: File | undefined) => {
      setError('')
      setHint(null)
      if (!f) return
      const formatProblem = formatHint(f.name.split('.').pop()?.toLowerCase() ?? '', locale)
      if (formatProblem) {
        setFile(null)
        setHint(formatProblem)
        return
      }
      if (f.size > MAX_MB * 1024 * 1024) {
        setError(t(`Die Datei ist grösser als ${MAX_MB} MB.`, `The file is larger than ${MAX_MB} MB.`))
        return
      }
      setFile(f)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale]
  )

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!file || !pow) return
    setSubmitting(true)
    setError('')
    const form = new FormData(e.currentTarget)
    form.set('file', file)
    form.set('challenge', JSON.stringify(pow.challenge))
    form.set('nonce', pow.nonce)
    try {
      const res = await fetch('/api/script-import', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      router.push(`/import/${data.token}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between px-4 sm:px-8 py-4 border-b border-border">
        <Link href="/" className="font-semibold text-lg">Eduskript</Link>
        <UiLocaleSwitcher />
      </header>
      <main className="max-w-2xl mx-auto px-4 py-10 sm:py-16">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          {t('Wie sähe mein Skript auf Eduskript aus?', 'What would my script look like on Eduskript?')}
        </h1>
        <p className="mt-4 text-muted-foreground text-lg">
          {t(
            'Laden Sie ein Arbeitsblatt oder Skript als Word-Datei hoch. Nach etwa einer Minute sehen Sie es als Eduskript-Skript: mit Formeln, Tabellen, Bildern und Aufgaben. Ohne Account.',
            'Upload a worksheet or script as a Word file. After about a minute you see it as an Eduskript skript: with formulas, tables, images and exercises. No account needed.'
          )}
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          {/* Honeypot: hidden from humans, bots tend to fill every field. */}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              pickFile(e.dataTransfer.files[0])
            }}
            className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 cursor-pointer transition-colors ${
              dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
            }`}
          >
            {file ? <FileText className="w-10 h-10 text-primary" /> : <Upload className="w-10 h-10 text-muted-foreground" />}
            <span className="font-medium text-center break-all">
              {file ? file.name : t('Word-Datei hierher ziehen oder klicken', 'Drop a Word file here or click')}
            </span>
            <span className="text-sm text-muted-foreground">
              {t(`.docx, bis ${MAX_MB} MB, bis ca. 30 Seiten`, `.docx, up to ${MAX_MB} MB, about 30 pages`)}
            </span>
            <input
              ref={inputRef}
              type="file"
              // Old/other formats are selectable on purpose: picking one shows formatHint.
              accept=".docx,.doc,.odt,.pdf,.pages,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>

          <div className="flex gap-3 rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
            <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" />
            <p>
              {t(
                'Bitte keine Schülerdaten hochladen (Namen, Noten, Fotos von Schülerinnen und Schülern). Die Vorschau ist privat: nur wer den Link hat, sieht sie, und sie wird nicht von Suchmaschinen erfasst. Übernehmen Sie das Skript nicht in einen Account, wird es nach 7 Tagen gelöscht. Zur Umwandlung wird der Text an ein KI-Modell (Google Gemini, ohne Speicherung beim Anbieter) gesendet.',
                'Please do not upload student data (names, grades, photos of students). The preview is private: only people with the link can see it, and search engines do not index it. If you do not take it over into an account, it is deleted after 7 days. The text is sent to an AI model (Google Gemini, not stored by the provider) for conversion.'
              )}{' '}
              <Link href="/datenschutz" className="underline">{t('Datenschutz', 'Privacy')}</Link>
            </p>
          </div>

          {hint && (
            <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm space-y-2">
              <p className="font-medium">{hint.title}</p>
              <p>{hint.body}</p>
              {hint.steps.length > 0 && (
                <ul className="list-disc pl-5 space-y-1">
                  {hint.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" size="lg" className="w-full" disabled={!file || !pow || submitting}>
            {submitting || (file && !pow) ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {submitting
              ? t('Wird hochgeladen …', 'Uploading …')
              : file && !pow
                ? t('Einen Moment …', 'One moment …')
                : t('Skript umwandeln', 'Convert script')}
          </Button>
        </form>
      </main>
    </div>
  )
}
