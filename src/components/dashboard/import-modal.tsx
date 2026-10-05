'use client'

/**
 * "Import" button + modal in the page builder's content library.
 * One drop zone, routed by file type:
 *   - .zip → Eduskript export, imported in the browser (zip-import-panel.tsx)
 *   - .docx/.doc/.odt/.rtf/.pdf or pasted text → document importer
 *     (src/lib/script-import/): POST /api/script-import (signed-in teachers
 *     skip proof of work + per-IP cap), poll GET /api/script-import/<token>,
 *     then POST /api/script-import/claim. No preview step: the skript lands
 *     unpublished in the account (claimImport → createSkriptForUser).
 *
 * Conversion state lives in this component, not in DialogContent, so closing
 * the modal mid-conversion keeps polling and still claims the skript.
 * Closing is blocked only while a ZIP import runs (it uploads from the tab).
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle, ClipboardPaste, HardDriveUpload, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FileDropzone } from '@/components/import/file-dropzone'
import { formatHint, importNotices, SCRIPT_IMPORT_EXTENSIONS, type Hint } from '@/lib/script-import/format-hints'
import type { ImportWarnings } from '@/lib/script-import/service'
import { ZipImportPanel } from './zip-import-panel'

const MAX_MB = 20
const POLL_MS = 2000

export type ImportKind = 'zip' | 'document' | 'unsupported'

/** Which importer handles a file name. */
export function importKindFor(fileName: string): ImportKind {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'zip') return 'zip'
  return (SCRIPT_IMPORT_EXTENSIONS as readonly string[]).includes(ext) ? 'document' : 'unsupported'
}

type DocState =
  | { stage: 'idle' }
  | { stage: 'converting'; token: string; name: string }
  | { stage: 'claiming'; name: string }
  | { stage: 'done'; title: string; slug: string; pages: number; notices: string[] }
  | { stage: 'error'; message: string }

interface ImportModalProps {
  /** Called after content was created (library reload). */
  onImported: () => void
}

export function ImportModal({ onImported }: ImportModalProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'file' | 'text'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [hint, setHint] = useState<Hint | null>(null)
  const [fileError, setFileError] = useState('')
  const [text, setText] = useState('')
  const [pastedHtml, setPastedHtml] = useState<string | null>(null)
  const [zipBusy, setZipBusy] = useState(false)
  const [doc, setDoc] = useState<DocState>({ stage: 'idle' })
  const [uploading, setUploading] = useState(false)

  const docBusy = uploading || doc.stage === 'converting' || doc.stage === 'claiming'
  const kind = file ? importKindFor(file.name) : null

  const reset = useCallback(() => {
    setFile(null)
    setHint(null)
    setFileError('')
    setText('')
    setPastedHtml(null)
    setDoc({ stage: 'idle' })
  }, [])

  const chooseFile = (f: File) => {
    setFileError('')
    setDoc({ stage: 'idle' })
    const k = importKindFor(f.name)
    const h = formatHint(f.name.split('.').pop()?.toLowerCase() ?? '', 'en')
    setHint(h)
    if (k === 'unsupported') {
      setFile(null)
      if (!h) setFileError('Supported: Eduskript export (.zip), Word (.docx, .doc), OpenDocument (.odt), RTF and PDF.')
      return
    }
    if (k === 'document' && f.size > MAX_MB * 1024 * 1024) {
      setFile(null)
      setFileError(`The file is larger than ${MAX_MB} MB.`)
      return
    }
    setFile(f)
  }

  const startDocument = async () => {
    const form = new FormData()
    let name: string
    if (mode === 'file' && file) {
      form.set('file', file)
      name = file.name
    } else {
      form.set('text', text)
      if (pastedHtml) form.set('html', pastedHtml)
      name = 'Pasted text'
    }
    setUploading(true)
    try {
      const res = await fetch('/api/script-import', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setDoc({ stage: 'converting', token: data.token, name })
    } catch (err) {
      setDoc({ stage: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setUploading(false)
    }
  }

  // Poll the conversion, then claim. Runs while the dialog is closed, too.
  const token = doc.stage === 'converting' ? doc.token : null
  const docName = doc.stage === 'converting' ? doc.name : ''
  useEffect(() => {
    if (!token) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const res = await fetch(`/api/script-import/${token}`, { cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        if (stopped) return
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (data.status === 'failed') throw new Error(data.error || 'The conversion failed.')
        if (data.status !== 'ready') {
          timer = setTimeout(poll, POLL_MS)
          return
        }
        setDoc({ stage: 'claiming', name: docName })
        const claim = await fetch('/api/script-import/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const claimed = await claim.json().catch(() => ({}))
        if (!claim.ok) throw new Error(claimed.error || `HTTP ${claim.status}`)
        setDoc({
          stage: 'done',
          title: data.title || docName,
          slug: claimed.skriptSlug,
          pages: data.pages ?? 0,
          notices: importNotices(data.warnings as ImportWarnings | null, 'en'),
        })
        onImported()
      } catch (err) {
        if (!stopped) setDoc({ stage: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }
    timer = setTimeout(poll, POLL_MS)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [token, docName, onImported])

  const onOpenChange = (next: boolean) => {
    if (!next && zipBusy) return
    setOpen(next)
    // Keep a running conversion; otherwise start fresh next time.
    if (!next && !docBusy) reset()
  }

  const docView = () => {
    if (uploading || doc.stage === 'converting' || doc.stage === 'claiming') {
      const label =
        uploading ? 'Uploading…' : doc.stage === 'claiming' ? 'Creating the skript…' : 'Converting — usually under a minute…'
      return (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            {label}
          </div>
          <p className="text-xs text-muted-foreground">You can close this window; the skript will appear in your library.</p>
        </div>
      )
    }
    if (doc.stage === 'done') {
      return (
        <div className="space-y-3 rounded-lg border border-green-500/20 bg-green-500/10 p-4 text-sm">
          <div className="flex items-center gap-2 font-medium text-green-700 dark:text-green-400">
            <CheckCircle className="h-5 w-5" />
            Imported: {doc.title}
          </div>
          <p>
            {doc.pages} {doc.pages === 1 ? 'page' : 'pages'}, unpublished. Please read it through before publishing.
          </p>
          {doc.notices.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {doc.notices.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button asChild size="sm">
              <Link href={`/dashboard/skripts/${doc.slug}`}>Open skript</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={reset}>
              Import another
            </Button>
          </div>
        </div>
      )
    }
    return null
  }

  const showPicker = !docBusy && doc.stage !== 'done' && kind !== 'zip'

  return (
    <>
      <Button
        variant="outline"
        className="h-10 shrink-0 items-center justify-center gap-1 whitespace-nowrap text-xs"
        onClick={() => setOpen(true)}
        title="Import a Word file, PDF, pasted text or an Eduskript export (.zip)"
      >
        {docBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HardDriveUpload className="h-3.5 w-3.5" />}
        Import
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Import</DialogTitle>
            <DialogDescription>
              A Word file, PDF or pasted text becomes a new skript (converted with AI). An Eduskript export (.zip) restores its collections and skripts.
            </DialogDescription>
          </DialogHeader>

          {file && kind === 'zip' ? (
            <ZipImportPanel file={file} onReset={reset} onImported={onImported} onBusyChange={setZipBusy} />
          ) : (
            <div className="space-y-4">
              {showPicker && (
                <>
                  <div role="tablist" className="inline-flex rounded-lg border border-border p-1 text-sm">
                    {(['file', 'text'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={mode === m}
                        onClick={() => {
                          setMode(m)
                          setFileError('')
                          setHint(null)
                          if (doc.stage === 'error') setDoc({ stage: 'idle' })
                        }}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 ${mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        {m === 'file' ? <Upload className="h-4 w-4" /> : <ClipboardPaste className="h-4 w-4" />}
                        {m === 'file' ? 'Upload file' : 'Paste text'}
                      </button>
                    ))}
                  </div>

                  {mode === 'file' ? (
                    <FileDropzone
                      accept=".zip,.docx,.doc,.odt,.rtf,.pdf,.pages"
                      onFile={chooseFile}
                      fileName={file?.name}
                      prompt="Drop a file here or click to choose"
                      hint={`.docx, .doc, .odt, .rtf, .pdf (up to ${MAX_MB} MB, 30 pages) or an Eduskript export .zip`}
                    />
                  ) : (
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
                        rows={10}
                        maxLength={150_000}
                        placeholder="Paste text here: from Word, Google Docs, a website, or as Markdown or LaTeX …"
                        className="w-full rounded-lg border border-border bg-background p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                      {pastedHtml && (
                        <p className="text-xs text-muted-foreground">
                          Formatting detected in the clipboard (headings, tables and images are kept).{' '}
                          <button type="button" className="underline" onClick={() => setPastedHtml(null)}>
                            Use plain text only
                          </button>
                        </p>
                      )}
                    </div>
                  )}

                  {mode === 'file' && hint && (
                    <div className="space-y-1 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
                      <p className="font-medium">{hint.title}</p>
                      <p className="text-muted-foreground">{hint.body}</p>
                      {hint.steps.length > 0 && (
                        <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
                          {hint.steps.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}

                  {fileError && <p className="text-sm text-destructive">{fileError}</p>}
                  {doc.stage === 'error' && (
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      {doc.message}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">No student data, please: the content is processed by an AI model.</p>
                    <Button
                      onClick={startDocument}
                      disabled={mode === 'file' ? kind !== 'document' : !text.trim()}
                      className="shrink-0"
                    >
                      Import
                    </Button>
                  </div>
                </>
              )}
              {docView()}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
