'use client'

import { useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Upload } from 'lucide-react'

interface SolutionPickDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Upload destination; without it the upload zone is hidden. */
  skriptId?: string
  /** The skript's files; images and Excalidraw drawings are offered. */
  files: Array<{ id: string; name: string; url?: string }>
  /** The tag's current solution value, highlighted in the list. */
  current: string | null
  /** Called with the solution="…" value: an image filename or a drawing's base name. */
  onSelect: (solution: string) => void
  /** Refresh the file list after an upload. */
  onUploaded?: () => void
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif|svg)$/i
const DRAWING_EXPORT_RE = /\.excalidraw\.(light|dark)\.svg$/i

/**
 * Candidates for a reference solution, in the form solutionFilename()
 * (src/lib/ai/feedback-context.ts) resolves: images by full name, Excalidraw
 * drawings once by base name, previewed via their light export.
 */
function solutionCandidates(files: SolutionPickDialogProps['files']) {
  const byName = new Map(files.map(f => [f.name, f]))
  const out: Array<{ value: string; label: string; previewUrl?: string }> = []
  for (const f of files) {
    if (f.name.endsWith('.excalidraw')) {
      const base = f.name.slice(0, -'.excalidraw'.length)
      out.push({ value: base, label: `${base} (drawing)`, previewUrl: byName.get(`${base}.excalidraw.light.svg`)?.url })
    } else if (IMAGE_RE.test(f.name) && !DRAWING_EXPORT_RE.test(f.name)) {
      out.push({ value: f.name, label: f.name, previewUrl: f.url })
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * "Provide solution" dialog for <ai-feedback>: pick one of the skript's images
 * or drawings, or drop/choose a new image — uploaded via /api/upload (same
 * call as pdf-pick-dialog.tsx).
 */
export function SolutionPickDialog({ open, onOpenChange, skriptId, files, current, onSelect, onUploaded }: SolutionPickDialogProps) {
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const candidates = solutionCandidates(files)

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setError(null)
      setDragOver(false)
    }
    onOpenChange(next)
  }

  const selectAndClose = (value: string) => {
    onSelect(value)
    handleOpenChange(false)
  }

  const uploadFile = async (file: File) => {
    if (!skriptId) return
    if (!file.type.startsWith('image/') && !IMAGE_RE.test(file.name)) {
      setError('Only images (PNG, JPG, WebP, GIF, SVG) can be used as a solution.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('uploadType', 'skript')
      formData.append('skriptId', skriptId)
      const response = await fetch('/api/upload', { method: 'POST', body: formData })
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Upload failed' }))
        throw new Error(err.error || 'Upload failed')
      }
      const uploaded = await response.json()
      onUploaded?.()
      selectAndClose(uploaded.name ?? file.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reference solution</DialogTitle>
          <DialogDescription>
            Students never see this. The AI compares their work against it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {candidates.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground uppercase mb-2">This skript&apos;s images and drawings</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto">
                {candidates.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => selectAndClose(c.value)}
                    className={`flex flex-col gap-1 rounded-md border p-1.5 text-left hover:border-primary/60 hover:bg-accent/40 ${
                      c.value === current ? 'border-primary ring-1 ring-primary' : 'border-border'
                    }`}
                  >
                    <div className="flex h-20 items-center justify-center overflow-hidden rounded bg-white">
                      {c.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- picker thumbnail from S3
                        <img src={c.previewUrl} alt="" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <span className="text-xs text-muted-foreground">no preview</span>
                      )}
                    </div>
                    <span className="truncate text-xs">{c.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {skriptId && (
            <>
              {candidates.length > 0 && <div className="text-xs text-muted-foreground text-center uppercase">or</div>}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  const file = e.dataTransfer.files[0]
                  if (file) uploadFile(file)
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors ${
                  dragOver ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                }`}
              >
                {uploading ? (
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                ) : (
                  <Upload className="w-6 h-6 text-muted-foreground" />
                )}
                <span className="text-sm text-muted-foreground">
                  {uploading ? 'Uploading…' : 'Drop an image here or click to choose'}
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadFile(file)
                  e.target.value = ''
                }}
              />
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
