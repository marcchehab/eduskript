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
import { ClipboardPaste, FileText, Loader2, ShieldCheck, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUiLocale, UiLocaleSwitcher } from '@/lib/i18n/client'
import { pick } from '@/lib/i18n/locale'
import { ThemeToggle } from '@/components/theme-toggle'

interface Challenge {
  salt: string
  expires: number
  difficulty: number
  sig: string
}

const MAX_MB = 20

type Locale = 'de' | 'en'
/** proceed: the file is still accepted (PDF), the hint is advice only. */
type Hint = { title: string; body: string; steps: string[]; proceed?: boolean }

/**
 * Hints per file extension. .docx/.odt/.rtf: none. .doc and .pdf: accepted,
 * with a non-blocking hint (proceed). .pages and anything else: rejected with
 * instructions. .doc/.odt/.rtf are converted to .docx server-side by
 * LibreOffice (src/lib/script-import/libreoffice.ts), which also turns old
 * Equation Editor formulas into Word formulas (some Symbol-font glyphs come
 * out wrong; cleanup.ts asks the model to fix them).
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
  switch (ext) {
    case 'doc':
      // Accepted (LibreOffice converts it server-side); the hint is just a smile.
      return de
        ? {
            title: 'Oh, eine .doc-Datei – die ist älter als manche Ihrer Schülerinnen und Schüler 😄',
            body: 'Kein Problem, wir wandeln sie um. Formeln aus dem alten Formel-Editor werden dabei zu echten Formeln; bitte danach kurz prüfen.',
            steps: [],
            proceed: true,
          }
        : {
            title: 'Oh, a .doc file – older than some of your students 😄',
            body: "No problem, we'll convert it. Formulas from the old equation editor become real formulas along the way; please check them afterwards.",
            steps: [],
            proceed: true,
          }
    case 'odt':
    case 'rtf':
      return null
    case 'pages':
      return de
        ? { title: 'Pages-Dateien können wir (noch) nicht lesen.', body: 'Exportieren Sie sie als Word-Datei:', steps: [resave[2]] }
        : { title: "We can't read Pages files (yet).", body: 'Export it as a Word file:', steps: [resave[2]] }
    case 'pdf':
      // Not blocking: the PDF is imported (convert-pdf.ts), but the original is better.
      return de
        ? {
            title: 'PDF geht – aber haben Sie die Originaldatei?',
            body: 'Aus der Originaldatei gelingt das Skript meist genauer, weil Formeln, Tabellen und Bilder direkt übernommen werden können: eine Word-Datei hochladen oder LaTeX- bzw. Markdown-Text einfügen. Aus einem PDF liest die KI den Inhalt vom Seitenbild ab und schneidet Abbildungen aus – das klappt oft gut, aber nicht immer.',
            steps: [],
            proceed: true,
          }
        : {
            title: 'PDF works – but do you have the original file?',
            body: 'The original file usually gives a more accurate skript, because formulas, tables and images can be taken over directly: upload a Word file or paste LaTeX or Markdown text. From a PDF the AI reads the content off the page images and cuts out figures – this often works well, but not always.',
            steps: [],
            proceed: true,
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
  const [mode, setMode] = useState<'file' | 'text'>('file')
  const [text, setText] = useState('')
  /** HTML flavour of the last paste (Word, Google Docs, websites): keeps headings, tables. */
  const [pastedHtml, setPastedHtml] = useState<string | null>(null)
  const ready = mode === 'file' ? !!file : !!text.trim()

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
        setHint(formatProblem)
        if (!formatProblem.proceed) {
          setFile(null)
          return
        }
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
    if (!ready || !pow) return
    setSubmitting(true)
    setError('')
    const form = new FormData(e.currentTarget)
    if (mode === 'file' && file) form.set('file', file)
    else {
      form.set('text', text)
      if (pastedHtml) form.set('html', pastedHtml)
    }
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
        <div className="flex items-center gap-2">
          <UiLocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-10 sm:py-16">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          {t('Wie sähe mein Skript auf Eduskript aus?', 'What would my script look like on Eduskript?')}
        </h1>
        <p className="mt-4 text-muted-foreground text-lg">
          {t(
            'Laden Sie ein Arbeitsblatt oder Skript als Word-Datei (auch .doc, .odt) oder PDF hoch, oder fügen Sie Text ein. Nach etwa einer Minute sehen Sie es als Eduskript-Skript: mit Formeln, Tabellen, Bildern und Aufgaben. Ohne Account.',
            'Upload a worksheet or script as a Word file (also .doc, .odt) or PDF, or paste text. After about a minute you see it as an Eduskript skript: with formulas, tables, images and exercises. No account needed.'
          )}
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          {/* Honeypot: hidden from humans, bots tend to fill every field. */}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
          <div role="tablist" className="inline-flex rounded-lg border border-border p-1 text-sm">
            {(['file', 'text'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m)
                  setError('')
                  setHint(null)
                }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 ${mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {m === 'file' ? <Upload className="w-4 h-4" /> : <ClipboardPaste className="w-4 h-4" />}
                {m === 'file' ? t('Datei hochladen', 'Upload file') : t('Text einfügen', 'Paste text')}
              </button>
            ))}
          </div>
          {mode === 'text' ? (
            <div className="space-y-2">
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  if (!e.target.value.trim()) setPastedHtml(null)
                }}
                onPaste={(e) => {
                  const html = e.clipboardData.getData('text/html')
                  setPastedHtml(html && html.trim() ? html : null)
                }}
                rows={14}
                maxLength={150_000}
                placeholder={t(
                  'Text hier einfügen: aus Word, Google Docs, einer Webseite, oder als Markdown bzw. LaTeX …',
                  'Paste text here: from Word, Google Docs, a website, or as Markdown or LaTeX …'
                )}
                className="w-full rounded-xl border border-border bg-background p-4 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              {pastedHtml && (
                <p className="text-xs text-muted-foreground">
                  {t('Formatierung aus der Zwischenablage erkannt (Überschriften, Tabellen, Bilder werden übernommen).', 'Formatting detected in the clipboard (headings, tables and images are kept).')}{' '}
                  <button type="button" className="underline" onClick={() => setPastedHtml(null)}>
                    {t('Nur Text verwenden', 'Use plain text only')}
                  </button>
                </p>
              )}
            </div>
          ) : (
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
              {file ? file.name : t('Word-Datei oder PDF hierher ziehen oder klicken', 'Drop a Word file or PDF here or click')}
            </span>
            <span className="text-sm text-muted-foreground">
              {t(`.docx, .doc, .odt, .rtf oder .pdf, bis ${MAX_MB} MB, bis 30 Seiten`, `.docx, .doc, .odt, .rtf or .pdf, up to ${MAX_MB} MB, up to 30 pages`)}
            </span>
            <input
              ref={inputRef}
              type="file"
              // Old/other formats are selectable on purpose: picking one shows formatHint.
              accept=".docx,.doc,.odt,.rtf,.pdf,.pages,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>
          )}

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

          {hint && mode === 'file' && (
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

          <Button type="submit" size="lg" className="w-full" disabled={!ready || !pow || submitting}>
            {submitting || (ready && !pow) ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {submitting
              ? t('Wird hochgeladen …', 'Uploading …')
              : ready && !pow
                ? t('Einen Moment …', 'One moment …')
                : mode === 'file' && hint?.proceed
                  ? t('PDF trotzdem umwandeln', 'Convert the PDF anyway')
                  : t('Skript umwandeln', 'Convert script')}
          </Button>
        </form>
      </main>
    </div>
  )
}
