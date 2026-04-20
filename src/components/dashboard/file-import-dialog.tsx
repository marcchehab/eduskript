'use client'

import { useEffect, useState } from 'react'
import { Search, Loader2, FileText, Image as ImageIcon, Database, Video, Pencil } from 'lucide-react'
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

interface SearchResult {
  id: string
  name: string
  hash: string
  contentType: string | null
  size: number | null
  sourceSkriptId: string
  sourceSkriptTitle: string
}

interface FileImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The skript that the imported file should be cloned INTO. */
  targetSkriptId: string
  /** Called after a successful import so the parent can refresh the file list. */
  onImported?: () => void
}

const SEARCH_DEBOUNCE_MS = 300

function fileIcon(name: string) {
  const lower = name.toLowerCase()
  if (lower.endsWith('.excalidraw')) return <Pencil className="w-4 h-4 text-orange-500" />
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return <ImageIcon className="w-4 h-4 text-blue-500" />
  if (/\.(db|sqlite)$/.test(lower)) return <Database className="w-4 h-4 text-purple-500" />
  if (/\.(mp4|mov|webm)$/.test(lower)) return <Video className="w-4 h-4 text-pink-500" />
  return <FileText className="w-4 h-4 text-muted-foreground" />
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function FileImportDialog({ open, onOpenChange, targetSkriptId, onImported }: FileImportDialogProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<SearchResult | null>(null)
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
        const res = await fetch(`/api/files/search?${params}`, { signal: controller.signal })
        if (!res.ok) {
          throw new Error(`Search failed (${res.status})`)
        }
        const data = await res.json()
        setResults(data.files ?? [])
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
      const res = await fetch('/api/files/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceFileId: selected.id,
          targetSkriptId,
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 409) {
        // Name conflict in target skript — surface to the user. They can rename
        // the existing file in the file browser and try again.
        setError(data.error ?? 'A file with that name already exists in this skript.')
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
          <DialogTitle>Import a file from another skript</DialogTitle>
          <DialogDescription>
            Search files across your skripts. Importing creates a reference in this skript without
            re-uploading the file.
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
              {query.trim() ? 'No files match.' : 'No files found in your other skripts.'}
            </div>
          ) : (
            <ul className="divide-y">
              {results.map((file) => {
                const isSelected = selected?.id === file.id
                return (
                  <li key={file.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(file)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted transition-colors ${
                        isSelected ? 'bg-muted' : ''
                      }`}
                    >
                      <span className="flex-shrink-0">{fileIcon(file.name)}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm truncate">{file.name}</span>
                        <span className="block text-xs text-muted-foreground truncate">
                          from <span className="italic">{file.sourceSkriptTitle}</span>
                          {file.size != null && <span> · {formatSize(file.size)}</span>}
                        </span>
                      </span>
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
