'use client'

import { useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ImagePlus, Loader2 } from 'lucide-react'

interface PictureDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Upload destination; without it the upload zone is hidden (URL only). */
  skriptId?: string
  /** Called with the markdown to insert (`![](url-or-filename)`). */
  onInsert: (markdown: string) => void
}

/**
 * Ribbon "Picture" dialog: paste an external image URL, or drop/pick a file —
 * the file is uploaded to the skript's files (same /api/upload call as paste
 * upload in editor-with-media.tsx) and embedded by name.
 */
export function PictureDialog({ open, onOpenChange, skriptId, onInsert }: PictureDialogProps) {
  const [url, setUrl] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setUrl('')
      setError(null)
      setDragOver(false)
    }
    onOpenChange(next)
  }

  const insertUrl = () => {
    const trimmed = url.trim()
    if (!trimmed) return
    onInsert(`![](${trimmed})`)
    handleOpenChange(false)
  }

  const uploadFile = async (file: File) => {
    if (!skriptId) return
    if (!file.type.startsWith('image/')) {
      setError('Only image files can be uploaded here.')
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
      onInsert(`![](${uploaded.name ?? file.name})`)
      window.dispatchEvent(new Event('sidebar:refresh'))
      handleOpenChange(false)
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
          <DialogTitle>Insert picture</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') insertUrl() }}
              placeholder="https://… image URL"
              autoFocus
            />
            <Button onClick={insertUrl} disabled={!url.trim()}>Insert</Button>
          </div>
          {skriptId && (
            <>
              <div className="text-xs text-muted-foreground text-center uppercase">or</div>
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
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors ${
                  dragOver ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                }`}
              >
                {uploading ? (
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                ) : (
                  <ImagePlus className="w-6 h-6 text-muted-foreground" />
                )}
                <span className="text-sm text-muted-foreground">
                  {uploading ? 'Uploading…' : 'Drop an image here or click to choose'}
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
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
