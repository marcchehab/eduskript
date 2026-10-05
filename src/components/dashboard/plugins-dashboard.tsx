'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { Plus, Pencil, Trash2, Copy, Search, Eye, Check, GitFork, User, Globe, FileText } from 'lucide-react'

interface Plugin {
  id: string
  slug: string
  name: string
  description: string | null
  version: string
  manifest: Record<string, unknown>
  entryHtml: string
  createdAt: string
  updatedAt: string
  author: {
    id: string
    pageSlug: string | null
    pageName: string | null
    name: string | null
    image: string | null
  }
}

interface PluginsDashboardProps {
  userId: string
  userPageSlug: string
}

interface UsageRow {
  pageId: string
  title: string
  pageSlug: string
  skriptSlug: string
  skriptTitle: string
  canEdit: boolean
}

const editHref = (p: Plugin) =>
  `/dashboard/plugins/edit/${encodeURIComponent(p.author.pageSlug || '')}/${encodeURIComponent(p.slug)}`

/**
 * Plugin library: own plugins and everyone's (tabs like the Insert → Plugin
 * picker). Creating/editing happens in PluginEditor on its own route
 * (/dashboard/plugins/new, /dashboard/plugins/edit/<owner>/<slug>).
 */
export function PluginsDashboard({ userId }: PluginsDashboardProps) {
  const router = useRouter()
  const dialog = useAlertDialog()
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'mine' | 'all'>('mine')
  const [usage, setUsage] = useState<Record<string, UsageRow[]>>({})
  const [copiedPluginId, setCopiedPluginId] = useState<string | null>(null)

  const fetchPlugins = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/plugins')
      const json = await res.json()
      const list: Plugin[] = json.plugins || []
      setPlugins(list)
      const mine = list.filter((p) => p.author.id === userId).map((p) => p.slug)
      if (mine.length) {
        const u = await fetch(`/api/plugins/usage?slugs=${encodeURIComponent(mine.join(','))}`).then((r) => r.json())
        setUsage(u.usage || {})
      }
    } catch (err) {
      console.error('Failed to fetch plugins:', err)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { fetchPlugins() }, [fetchPlugins])

  const handleDelete = (plugin: Plugin) => {
    const pages = usage[plugin.slug] || []
    const where = pages.length
      ? `It is used on ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}: ${pages.slice(0, 5).map((p) => `"${p.title}" (${p.skriptTitle})`).join(', ')}${pages.length > 5 ? ', …' : ''}. Students will see "not available" there instead.`
      : 'It is not used on any page.'
    dialog.showConfirm(
      `Delete plugin "${plugin.name}"? ${where} This cannot be undone.`,
      async () => {
        try {
          await fetch(
            `/api/plugins/${encodeURIComponent(plugin.author.pageSlug || '')}/${encodeURIComponent(plugin.slug)}`,
            { method: 'DELETE' },
          )
          await fetchPlugins()
        } catch (err) {
          console.error('Failed to delete:', err)
        }
      },
      { destructive: true, title: 'Delete plugin', confirmText: 'Delete' },
    )
  }

  const handleFork = async (plugin: Plugin) => {
    try {
      const res = await fetch(
        `/api/plugins/${encodeURIComponent(plugin.author.pageSlug || '')}/${encodeURIComponent(plugin.slug)}/fork`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to fork')
      }
      const json = await res.json()
      router.push(editHref(json.plugin))
    } catch (err) {
      console.error('Failed to fork:', err)
    }
  }

  const handleCopyEmbedLink = async (plugin: Plugin) => {
    const ownerSlug = plugin.author.pageSlug
    if (!ownerSlug) return
    const url = `${window.location.origin}/embed/${ownerSlug}/${plugin.slug}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedPluginId(plugin.id)
      setTimeout(() => {
        setCopiedPluginId((current) => (current === plugin.id ? null : current))
      }, 1500)
    } catch (err) {
      console.error('Failed to copy embed link:', err)
    }
  }

  const myCount = plugins.filter((p) => p.author.id === userId).length
  const filteredPlugins = plugins.filter((p) => {
    if (tab === 'mine' && p.author.id !== userId) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      p.slug.toLowerCase().includes(q) ||
      p.author.pageSlug?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    )
  })

  const tabClass = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
      active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
    }`

  return (
    <>
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search plugins..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button size="sm" asChild>
          <Link href="/dashboard/plugins/new"><Plus className="h-4 w-4 mr-1" /> New Plugin</Link>
        </Button>
      </div>

      <div className="flex gap-1 border-b">
        <button onClick={() => setTab('mine')} className={tabClass(tab === 'mine')}>
          <User className="w-3.5 h-3.5" /> Mine ({myCount})
        </button>
        <button onClick={() => setTab('all')} className={tabClass(tab === 'all')}>
          <Globe className="w-3.5 h-3.5" /> All ({plugins.length})
        </button>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm py-8 text-center">Loading...</p>
      ) : filteredPlugins.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>{search ? 'No plugins match your search' : tab === 'mine' ? 'No plugins yet' : 'No plugins available'}</p>
          {!search && tab === 'mine' && (
            <>
              <p className="mt-1 text-sm">Describe a game, quiz or simulation and the AI builds it — no coding needed.</p>
              <Button variant="outline" className="mt-4" asChild>
                <Link href="/dashboard/plugins/new"><Plus className="h-4 w-4 mr-1" /> Create your first plugin</Link>
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredPlugins.map((plugin) => {
            const isOwner = plugin.author.id === userId
            const authorLabel = plugin.author.pageName || plugin.author.name || plugin.author.pageSlug || 'Unknown'
            const used = usage[plugin.slug] || []

            return (
              <div key={plugin.id} className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted/50 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link href={editHref(plugin)} className="font-medium truncate hover:underline">{plugin.name}</Link>
                    <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {plugin.author.pageSlug}/{plugin.slug}
                    </code>
                  </div>
                  {plugin.description && (
                    <p className="text-sm text-muted-foreground mt-1 truncate">{plugin.description}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {isOwner ? (
                      <span className="inline-flex items-center gap-1" title={used.map((p) => `${p.title} (${p.skriptTitle})`).join('\n') || undefined}>
                        <FileText className="h-3.5 w-3.5" />
                        {used.length ? `Used on ${used.length} ${used.length === 1 ? 'page' : 'pages'}` : 'Not used on any page yet'}
                      </span>
                    ) : (
                      <span>by {authorLabel}</span>
                    )}
                    {plugin.author.pageSlug && (
                      <span className="inline-flex items-center gap-1">
                        <a href={`/embed/${plugin.author.pageSlug}/${plugin.slug}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-mono" title="Public URL (for other websites)">
                          /embed/{plugin.author.pageSlug}/{plugin.slug}
                        </a>
                        <button
                          type="button"
                          onClick={() => handleCopyEmbedLink(plugin)}
                          title="Copy public URL"
                          className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-muted hover:text-foreground transition-colors"
                        >
                          {copiedPluginId === plugin.id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-3">
                  {isOwner ? (
                    <>
                      <Button variant="ghost" size="sm" asChild title="Edit plugin">
                        <Link href={editHref(plugin)}><Pencil className="h-4 w-4 mr-1" /> Edit</Link>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(plugin)} title="Delete plugin">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" asChild title="Look at this plugin">
                        <Link href={editHref(plugin)}><Eye className="h-4 w-4 mr-1" /> View</Link>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleFork(plugin)} title="Copy into your own plugins to change it">
                        <GitFork className="h-4 w-4 mr-1" /> Copy
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
    <AlertDialogModal
      open={dialog.open} onOpenChange={dialog.setOpen}
      type={dialog.type} title={dialog.title} message={dialog.message}
      onConfirm={dialog.onConfirm} showCancel={dialog.showCancel}
      confirmText={dialog.confirmText} cancelText={dialog.cancelText}
      destructive={dialog.destructive}
    />
    </>
  )
}
