'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import Link from 'next/link'
import { Search, Puzzle, User, Globe, Sparkles } from 'lucide-react'

interface PluginInfo {
  id: string
  slug: string
  name: string
  description: string | null
  version: string
  manifest: Record<string, unknown>
  author: {
    id: string
    pageSlug: string | null
    pageName: string | null
    name: string | null
  }
}

interface PluginPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (pluginSrc: string, configHint: string) => void
  userId?: string
  /** Link to the plugin editor ("New plugin with AI"); the editor returns here on "Save & insert". */
  newPluginHref?: string
  /** Called right before following newPluginHref (to remember the cursor position). */
  onNewPlugin?: () => void
}

export function PluginPicker({ open, onOpenChange, onSelect, userId, newPluginHref, onNewPlugin }: PluginPickerProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'mine' | 'all'>('mine')

  const fetchPlugins = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/plugins')
      const json = await res.json()
      setPlugins(json.plugins || [])
    } catch (err) {
      console.error('Failed to fetch plugins:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch on open
  useEffect(() => {
    if (open) {
      fetchPlugins()
      setSearch('')
    }
  }, [open, fetchPlugins])

  const filtered = useMemo(() => {
    let list = plugins
    if (tab === 'mine') {
      list = list.filter((p) => p.author.id === userId)
    }
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          p.author.pageSlug?.toLowerCase().includes(q),
      )
    }
    return list
  }, [plugins, tab, search, userId])

  const myCount = useMemo(() => plugins.filter((p) => p.author.id === userId).length, [plugins, userId])
  const allCount = plugins.length

  function handleSelect(plugin: PluginInfo) {
    const src = `${plugin.author.pageSlug}/${plugin.slug}`

    // Build config hint from configSchema
    const manifest = plugin.manifest as { configSchema?: Record<string, { type?: string; default?: unknown }> }
    let configAttrs = ''
    if (manifest.configSchema) {
      const entries = Object.entries(manifest.configSchema)
      if (entries.length > 0) {
        configAttrs = entries
          .filter(([, v]) => v.default !== undefined)
          .map(([k, v]) => ` ${k}="${v.default}"`)
          .join('')
      }
    }

    onSelect(src, configAttrs)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Puzzle className="w-5 h-5" />
            Insert Plugin
          </DialogTitle>
        </DialogHeader>

        {newPluginHref && (
          <Link
            href={newPluginHref}
            onClick={() => { onNewPlugin?.(); onOpenChange(false) }}
            className="flex items-center gap-3 rounded-md border border-blue-400/60 bg-linear-to-b from-blue-500/15 to-blue-500/[0.02] px-3 py-2.5 text-left hover:from-blue-500/25 dark:border-blue-500/50"
          >
            <Sparkles className="h-5 w-5 shrink-0 text-blue-500" />
            <span>
              <span className="block text-sm font-medium">New plugin with AI</span>
              <span className="block text-xs text-muted-foreground">Describe a game, quiz or simulation. It is inserted here when you save.</span>
            </span>
          </Link>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search plugins..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b pb-0">
          <button
            onClick={() => setTab('mine')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
              tab === 'mine'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            Mine ({myCount})
          </button>
          <button
            onClick={() => setTab('all')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
              tab === 'all'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            All ({allCount})
          </button>
        </div>

        {/* Plugin list */}
        <div className="flex-1 overflow-y-auto min-h-0 -mx-2">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">{search ? 'No plugins match your search' : tab === 'mine' ? 'No plugins yet' : 'No plugins available'}</p>
              {tab === 'mine' && !search && (
                <p className="text-xs mt-2">Use &quot;New plugin with AI&quot; above to make one.</p>
              )}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((plugin) => {
                const authorLabel = plugin.author.pageName || plugin.author.name || plugin.author.pageSlug || '?'
                const isOwn = plugin.author.id === userId

                return (
                  <button
                    key={plugin.id}
                    onClick={() => handleSelect(plugin)}
                    className="w-full text-left px-3 py-2.5 rounded-md hover:bg-accent transition-colors group"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm group-hover:text-accent-foreground">{plugin.name}</span>
                      {!isOwn && (
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {authorLabel}
                        </span>
                      )}
                    </div>
                    {plugin.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{plugin.description}</p>
                    )}
                    <code className="text-[10px] text-muted-foreground/70 mt-0.5 block">
                      {plugin.author.pageSlug}/{plugin.slug}
                    </code>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
