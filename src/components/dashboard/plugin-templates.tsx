'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { TemplateInfo } from '@/lib/plugin-templates'
import { Loader2, Map as MapIcon, Plus, Upload } from 'lucide-react'

/**
 * Form to add an SVG to the central template list (link or file upload).
 * Used inline when the AI asks for a template, and in the templates dialog.
 */
export function TemplateAddForm({ initialTitle = '', onAdded, compact }: {
  initialTitle?: string
  onAdded: (t: TemplateInfo) => void
  compact?: boolean
}) {
  const [title, setTitle] = useState(initialTitle)
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const svg = file ? await file.text() : undefined
      const res = await fetch('/api/plugin-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, url: svg ? undefined : url, svg }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not add the template')
      onAdded(json.template as TemplateInfo)
      setUrl('')
      setFile(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the template')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`space-y-2 ${compact ? '' : 'rounded-md border p-3'}`}>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name, e.g. Africa (countries)" className="h-8 text-sm" />
      <div className="flex items-center gap-2">
        <Input
          value={file ? file.name : url}
          onChange={(e) => { setFile(null); setUrl(e.target.value) }}
          placeholder="Link to an SVG, e.g. from commons.wikimedia.org"
          className="h-8 min-w-0 flex-1 text-sm"
        />
        <span className="text-xs text-muted-foreground">or</span>
        <input ref={fileRef} type="file" accept=".svg,image/svg+xml" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 gap-1 text-xs" onClick={() => fileRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" /> Upload SVG
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Shared with all teachers. Wikimedia Commons has many free maps and diagrams.</p>
        <Button size="sm" className="h-7 shrink-0 gap-1 text-xs" disabled={busy || !title.trim() || (!url.trim() && !file)} onClick={submit}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add template
        </Button>
      </div>
    </div>
  )
}

/** Browse the central template list and add new ones. */
export function PluginTemplatesDialog({ open, onOpenChange, onUse }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Prefill the AI prompt with a request that uses this template. */
  onUse: (t: TemplateInfo) => void
}) {
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null)
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    if (!open) return
    fetch('/api/plugin-templates').then((r) => r.json()).then((j) => setTemplates(j.templates || [])).catch(() => setTemplates([]))
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MapIcon className="h-5 w-5" /> Templates</DialogTitle>
          <DialogDescription>
            Real maps and diagrams the AI can build on. It cannot draw real outlines itself, so for a map quiz it uses one of these.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto">
          {!templates ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : (
            templates.map((t) => (
              <div key={t.slug} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/50">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {t.shapes.length} parts{t.points.length ? ` · ${t.points.length} points` : ''}{t.builtIn ? ' · built in' : ''}
                  </div>
                </div>
                <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={() => { onUse(t); onOpenChange(false) }}>Use</Button>
              </div>
            ))
          )}
        </div>
        {adding ? (
          <TemplateAddForm onAdded={(t) => { setTemplates((list) => [...(list ?? []), t]); setAdding(false) }} />
        ) : (
          <Button variant="outline" size="sm" className="gap-1" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add a template</Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
