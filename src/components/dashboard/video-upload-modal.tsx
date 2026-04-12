'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type UploadState = 'idle' | 'preparing' | 'uploading' | 'error'

interface VideoUploadModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploadComplete?: () => void
  // Skript to associate the uploaded video with via SkriptVideos.
  // Omit for admin uploads that aren't tied to a specific skript.
  skriptId?: string
}

export function VideoUploadModal({ open, onOpenChange, onUploadComplete, skriptId }: VideoUploadModalProps) {
  const [state, setState] = useState<UploadState>('idle')
  const [filename, setFilename] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)

  const reset = useCallback(() => {
    setState('idle')
    setFilename('')
    setFile(null)
    setProgress(0)
    setError('')
    if (xhrRef.current) {
      xhrRef.current.abort()
      xhrRef.current = null
    }
  }, [])

  const handleClose = useCallback((isOpen: boolean) => {
    if (!isOpen) {
      // Don't allow closing during upload
      if (state === 'uploading') return
      reset()
    }
    onOpenChange(isOpen)
  }, [state, reset, onOpenChange])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return
    setFile(selected)
    // Default filename to file name if not set
    if (!filename) {
      setFilename(selected.name)
    }
    setError('')
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const dropped = e.dataTransfer.files?.[0]
    if (!dropped) return
    if (!dropped.type.startsWith('video/')) {
      setError('Please drop a video file')
      return
    }
    setFile(dropped)
    if (!filename) {
      setFilename(dropped.name)
    }
    setError('')
  }

  const handleUpload = async () => {
    if (!file || !filename.trim()) {
      setError('Please select a file and enter a filename')
      return
    }

    setError('')
    setState('preparing')

    try {
      // Step 1: Get signed upload URL
      const res = await fetch('/api/videos/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename.trim(), skriptId }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to get upload URL')
      }

      const { uploadUrl } = await res.json()

      // Step 2: Upload directly to Mux via PUT
      setState('uploading')
      setProgress(0)

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhrRef.current = xhr

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100))
          }
        })

        xhr.addEventListener('load', () => {
          xhrRef.current = null
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve()
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`))
          }
        })

        xhr.addEventListener('error', () => {
          xhrRef.current = null
          reject(new Error('Upload failed'))
        })

        xhr.addEventListener('abort', () => {
          xhrRef.current = null
          reject(new Error('Upload cancelled'))
        })

        xhr.open('PUT', uploadUrl)
        xhr.send(file)
      })

      // Upload complete — close modal and notify parent
      // Mux will process the video asynchronously; the webhook updates status
      reset()
      onOpenChange(false)
      onUploadComplete?.()
    } catch (err) {
      if (err instanceof Error && err.message === 'Upload cancelled') {
        reset()
        return
      }
      setError(err instanceof Error ? err.message : 'Upload failed')
      setState('error')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Video</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* File drop zone */}
          {state === 'idle' && (
            <>
              <div
                onDrop={handleDrop}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors"
              >
                {file ? (
                  <div className="space-y-1">
                    <CheckCircle2 className="w-8 h-8 mx-auto text-green-600" />
                    <p className="text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1048576).toFixed(1)} MB
                    </p>
                    <p className="text-xs text-muted-foreground">Click to change</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Drop a video file here or click to browse
                    </p>
                    <p className="text-xs text-muted-foreground">
                      MP4, MOV, WebM supported
                    </p>
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                className="hidden"
              />

              {/* Filename input */}
              <div>
                <label className="text-sm font-medium mb-1 block">Filename</label>
                <input
                  type="text"
                  value={filename}
                  onChange={e => setFilename(e.target.value)}
                  placeholder="e.g., lecture-01.mp4"
                  className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  This is how you&apos;ll reference the video in markdown
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => handleClose(false)}
                  className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  disabled={!file || !filename.trim()}
                  className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Upload
                </button>
              </div>
            </>
          )}

          {/* Preparing state */}
          {state === 'preparing' && (
            <div className="py-8 text-center space-y-2">
              <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary" />
              <p className="text-sm">Preparing upload…</p>
            </div>
          )}

          {/* Uploading state */}
          {state === 'uploading' && (
            <div className="py-8 space-y-3">
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">Uploading…</p>
                <p className="text-2xl font-bold">{progress}%</p>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-center text-muted-foreground">
                Uploading directly to Mux
              </p>
            </div>
          )}

          {/* Error state */}
          {state === 'error' && (
            <div className="py-8 text-center space-y-3">
              <AlertCircle className="w-8 h-8 mx-auto text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
              <div className="flex justify-center gap-2">
                <button
                  onClick={() => handleClose(false)}
                  className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={reset}
                  className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
