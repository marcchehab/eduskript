'use client'

import { useRef, useState } from 'react'
import { ImageUp, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { downscalePluginThumbnail } from '@/lib/plugin-thumbnail'

/** The plugin's screenshot, or a tile with its first letter. Sized by className. */
export function PluginThumbnail({ name, url, className = '' }: { name: string; url?: string | null; className?: string }) {
  const box = `aspect-[8/5] shrink-0 overflow-hidden rounded-md border bg-muted ${className}`
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- public bucket file, already 480x300
    return <img src={url} alt="" loading="lazy" className={`object-cover ${box}`} />
  }
  // Array.from: a first character outside the BMP (emoji) is two UTF-16 units.
  const letter = Array.from(name.trim())[0]?.toUpperCase() || '?'
  return (
    <div aria-hidden className={`flex items-center justify-center font-semibold text-muted-foreground ${box}`}>
      {letter}
    </div>
  )
}

/**
 * Thumbnail controls for the plugin editor. Upload, paste and remove take effect
 * immediately, independent of the editor's Save (like a file upload).
 */
export function PluginThumbnailField({ apiPath, name, url, onChange }: {
  /** /api/plugins/<owner>/<slug>/thumbnail */
  apiPath: string
  name: string
  url: string | null
  onChange: (url: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async (init: RequestInit) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(apiPath, init)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Saving the thumbnail failed')
      onChange(json.thumbnailUrl ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving the thumbnail failed')
    } finally {
      setBusy(false)
    }
  }

  const upload = async (image: Blob) => {
    let small: Blob
    try {
      small = await downscalePluginThumbnail(image)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This image could not be read')
      return
    }
    const form = new FormData()
    form.append('file', small, 'thumbnail')
    await send({ method: 'POST', body: form })
  }

  const onPaste = (e: React.ClipboardEvent) => {
    const image = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'))
    if (!image) return
    e.preventDefault()
    void upload(image)
  }

  return (
    <div className="space-y-1.5 border-t pt-3">
      <Label className="text-xs font-medium">Thumbnail</Label>
      <div className="flex items-center gap-3">
        <PluginThumbnail name={name} url={url} className="w-28 text-2xl" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div
            tabIndex={0}
            role="textbox"
            aria-label="Paste a screenshot here"
            onPaste={onPaste}
            className="cursor-text rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
          >
            Click here and paste a screenshot
          </div>
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              aria-label="Upload a thumbnail"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void upload(file)
              }}
            />
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageUp className="h-3.5 w-3.5" />} Upload
            </Button>
            {url && (
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => void send({ method: 'DELETE' })}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" /> Remove
              </Button>
            )}
          </div>
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
