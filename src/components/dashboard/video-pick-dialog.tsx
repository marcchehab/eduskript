'use client'

import { useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Film, Upload } from 'lucide-react'
import { VideoUploadModal } from './video-upload-modal'
import type { VideoInfo } from '@/lib/skript-files'

interface VideoPickDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Upload destination; without it the upload zone is hidden. */
  skriptId?: string
  /** This skript's uploaded videos (from the shared file/video list). */
  videos: VideoInfo[]
  /** Called with the markdown to insert. */
  onInsert: (markdown: string) => void
  /** Refresh the file/video list after an upload. */
  onUploaded?: () => void
}

/**
 * Ribbon "Video" dialog: paste a YouTube/video URL, pick one of the skript's
 * uploaded videos, or drop a file — the file goes through the existing Mux
 * upload modal (video-upload-modal.tsx) and is embedded by filename.
 * Both URL and filename insert as `![](…)` — the markdown pipeline recognizes
 * YouTube URLs and uploaded video filenames there.
 */
export function VideoPickDialog({ open, onOpenChange, skriptId, videos, onInsert, onUploaded }: VideoPickDialogProps) {
  const [url, setUrl] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setUrl('')
      setDragOver(false)
    }
    onOpenChange(next)
  }

  const insertAndClose = (markdown: string) => {
    onInsert(markdown)
    handleOpenChange(false)
  }

  const insertUrl = () => {
    const trimmed = url.trim()
    if (!trimmed) return
    insertAndClose(`![](${trimmed})`)
  }

  const startUpload = (file: File) => {
    if (!file.type.startsWith('video/')) return
    setUploadFile(file)
    setUploadOpen(true)
  }

  return (
    <>
      <Dialog open={open && !uploadOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Insert video</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') insertUrl() }}
                placeholder="https://www.youtube.com/watch?v=…"
                autoFocus
              />
              <Button onClick={insertUrl} disabled={!url.trim()}>Insert</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Tip: you can also paste a YouTube URL directly into the editor.
            </p>
            {videos.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground uppercase mb-2">Uploaded videos</div>
                <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto">
                  {videos.map(video => {
                    const ready = Boolean(video.metadata.playbackId)
                    return (
                      <button
                        key={video.filename}
                        type="button"
                        disabled={!ready}
                        title={ready ? `Insert ${video.filename}` : 'Still processing…'}
                        onClick={() => insertAndClose(`![](${video.filename})`)}
                        className="flex items-center gap-2 p-2 rounded-md border border-border hover:border-primary/60 hover:bg-accent/40 disabled:opacity-50 text-left"
                      >
                        {video.metadata.poster ? (
                          // eslint-disable-next-line @next/next/no-img-element -- tiny Mux poster thumbnail, not worth next/image
                          <img src={video.metadata.poster} alt="" className="w-12 h-8 object-cover rounded shrink-0" />
                        ) : (
                          <Film className="w-5 h-5 text-muted-foreground shrink-0" />
                        )}
                        <span className="text-sm truncate">{video.filename}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
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
                    if (file) startUpload(file)
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors ${
                    dragOver ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                  }`}
                >
                  <Upload className="w-6 h-6 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Drop a video here or click to choose</span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) startUpload(file)
                    e.target.value = ''
                  }}
                />
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <VideoUploadModal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        skriptId={skriptId}
        initialFile={uploadFile}
        onUploadComplete={(filename) => {
          onUploaded?.()
          if (filename) insertAndClose(`![](${filename})`)
        }}
      />
    </>
  )
}
