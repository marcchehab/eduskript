'use client'

import { useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FileText, Loader2, Upload } from 'lucide-react'

interface PdfPickDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Upload destination; without it the upload zone is hidden. */
  skriptId?: string
  /** The skript's files (PDFs are filtered out of this list). */
  files: Array<{ id: string; name: string }>
  /** Called with the markdown to insert (`<pdf src="…">`). */
  onInsert: (markdown: string) => void
  /** Refresh the file list after an upload. */
  onUploaded?: () => void
}

/**
 * Ribbon "PDF" dialog: pick one of the skript's PDFs or drop/choose a new one
 * — uploaded via /api/upload (same call as picture-dialog.tsx) and embedded
 * with the native-viewer <pdf> tag.
 */
export function PdfPickDialog({ open, onOpenChange, skriptId, files, onInsert, onUploaded }: PdfPickDialogProps) {
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const pdfs = files.filter(f => f.name?.toLowerCase().endsWith('.pdf'))

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setError(null)
      setDragOver(false)
    }
    onOpenChange(next)
  }

  const insertAndClose = (name: string) => {
    onInsert(`<pdf src="${name}" height="1267"></pdf>`)
    handleOpenChange(false)
  }

  const uploadFile = async (file: File) => {
    if (!skriptId) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files can be uploaded here.')
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
      insertAndClose(uploaded.name ?? file.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Insert PDF</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {pdfs.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground uppercase mb-2">This skript&apos;s PDFs</div>
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {pdfs.map(pdf => (
                  <button
                    key={pdf.id}
                    type="button"
                    onClick={() => insertAndClose(pdf.name)}
                    className="flex items-center gap-2 w-full p-2 rounded-md border border-border hover:border-primary/60 hover:bg-accent/40 text-left"
                  >
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{pdf.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {skriptId && (
            <>
              {pdfs.length > 0 && <div className="text-xs text-muted-foreground text-center uppercase">or</div>}
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
                  {uploading ? 'Uploading…' : 'Drop a PDF here or click to choose'}
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
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
