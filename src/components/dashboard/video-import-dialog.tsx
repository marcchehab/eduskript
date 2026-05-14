'use client'

import { useEffect, useState } from 'react'
import { Search, Loader2, Film } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface VideoSearchResult {
  id: string
  filename: string
  provider: string
  poster: string | null
  status: string
  skriptTitles: string[]
}

interface VideoImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The skript the video should be linked INTO. */
  targetSkriptId: string
  /** Called after a successful import so the parent can refresh the video list. */
  onImported?: () => void
}

const SEARCH_DEBOUNCE_MS = 300

export function VideoImportDialog({ open, onOpenChange, targetSkriptId, onImported }: VideoImportDialogProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<VideoSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<VideoSearchResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state every time the dialog opens
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setSelected(null)
      setError(null)
    }
  }, [open])

  // Debounced search
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      setSearching(true)
      setError(null)
      try {
        const params = new URLSearchParams({ excludeSkriptId: targetSkriptId })
        if (query.trim()) params.set('q', query.trim())
        const res = await fetch(`/api/videos/search?${params}`, { signal: controller.signal })
        if (!res.ok) {
          throw new Error(`Search failed (${res.status})`)
        }
        const data = await res.json()
        setResults(data.videos ?? [])
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setError((e as Error).message)
        setResults([])
      } finally {
        setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [query, targetSkriptId, open])

  async function handleImport() {
    if (!selected) return
    setImporting(true)
    setError(null)
    try {
      const res = await fetch('/api/videos/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceVideoId: selected.id,
          targetSkriptId,
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 409) {
        // Already linked to this skript — surface it; the user can pick another.
        setError(data.error ?? 'That video is already in this skript.')
        return
      }
      if (!res.ok) {
        throw new Error(data.error ?? `Import failed (${res.status})`)
      }

      onImported?.()
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import a video from another skript</DialogTitle>
          <DialogDescription>
            Search videos across your skripts. Importing links the video to this skript without
            re-uploading it to Mux.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            autoFocus
            placeholder="Search by filename..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(null)
            }}
            className="pl-8"
          />
        </div>

        <div className="border rounded-md max-h-80 overflow-y-auto">
          {searching && results.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {query.trim() ? 'No videos match.' : 'No videos found in your other skripts.'}
            </div>
          ) : (
            <ul className="divide-y">
              {results.map((video) => {
                const isSelected = selected?.id === video.id
                return (
                  <li key={video.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(video)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted transition-colors ${
                        isSelected ? 'bg-muted' : ''
                      }`}
                    >
                      {video.poster ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={video.poster}
                          alt=""
                          className="w-14 h-9 object-cover rounded flex-shrink-0 bg-muted"
                        />
                      ) : (
                        <div className="w-14 h-9 flex items-center justify-center rounded flex-shrink-0 bg-muted">
                          <Film className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm truncate">{video.filename}</span>
                        <span className="block text-xs text-muted-foreground truncate">
                          {video.skriptTitles.length > 0
                            ? <>in <span className="italic">{video.skriptTitles.join(', ')}</span></>
                            : 'not in any skript yet'}
                        </span>
                      </span>
                      {video.status !== 'ready' && (
                        <span className="flex-shrink-0 text-xs text-muted-foreground">{video.status}</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!selected || importing}>
            {importing ? (
              <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Importing...</>
            ) : (
              'Import'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
