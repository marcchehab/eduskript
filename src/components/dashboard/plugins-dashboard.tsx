'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buildPluginSrcdoc } from '@/lib/plugin-sdk'
import { Plus, Pencil, Trash2, Copy, Search, ArrowLeft, Eye, Sparkles } from 'lucide-react'

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

type View = 'list' | 'editor'

export function PluginsDashboard({ userId, userPageSlug }: PluginsDashboardProps) {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('list')
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)

  // Editor state
  const [editingPlugin, setEditingPlugin] = useState<Plugin | null>(null)
  const [editorName, setEditorName] = useState('')
  const [editorSlug, setEditorSlug] = useState('')
  const [editorDescription, setEditorDescription] = useState('')
  const [editorHtml, setEditorHtml] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // AI generation state
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  // Preview
  const { resolvedTheme } = useTheme()
  const previewRef = useRef<HTMLIFrameElement>(null)
  const [previewSrcdoc, setPreviewSrcdoc] = useState<string>('')

  const fetchPlugins = useCallback(async () => {
    setLoading(true)
    try {
      const url = showAll ? '/api/plugins' : `/api/plugins?author=${encodeURIComponent(userPageSlug)}`
      const res = await fetch(url)
      const json = await res.json()
      setPlugins(json.plugins || [])
    } catch (err) {
      console.error('Failed to fetch plugins:', err)
    } finally {
      setLoading(false)
    }
  }, [userPageSlug, showAll])

  useEffect(() => { fetchPlugins() }, [fetchPlugins])

  // Update preview when HTML or theme changes
  useEffect(() => {
    if (editorHtml) {
      setPreviewSrcdoc(buildPluginSrcdoc(editorHtml, resolvedTheme))
    }
  }, [editorHtml, resolvedTheme])

  const openEditor = (plugin?: Plugin) => {
    if (plugin) {
      setEditingPlugin(plugin)
      setEditorName(plugin.name)
      setEditorSlug(plugin.slug)
      setEditorDescription(plugin.description || '')
      setEditorHtml(plugin.entryHtml)
    } else {
      setEditingPlugin(null)
      setEditorName('')
      setEditorSlug('')
      setEditorDescription('')
      setEditorHtml(DEFAULT_PLUGIN_HTML)
    }
    setSaveError(null)
    setView('editor')
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)

    try {
      if (editingPlugin && editingPlugin.author.id === userId) {
        // Update existing
        const res = await fetch(
          `/api/plugins/${encodeURIComponent(editingPlugin.author.pageSlug || '')}/${encodeURIComponent(editingPlugin.slug)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: editorName,
              description: editorDescription || null,
              entryHtml: editorHtml,
            }),
          },
        )
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to update')
        }
      } else {
        // Create new
        const res = await fetch('/api/plugins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: editorSlug,
            name: editorName,
            description: editorDescription || null,
            manifest: {},
            entryHtml: editorHtml,
          }),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to create')
        }
      }

      await fetchPlugins()
      setView('list')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (plugin: Plugin) => {
    if (!confirm(`Delete plugin "${plugin.name}"? This cannot be undone.`)) return

    try {
      await fetch(
        `/api/plugins/${encodeURIComponent(plugin.author.pageSlug || '')}/${encodeURIComponent(plugin.slug)}`,
        { method: 'DELETE' },
      )
      await fetchPlugins()
    } catch (err) {
      console.error('Failed to delete:', err)
    }
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
      await fetchPlugins()
      // Open forked plugin in editor
      openEditor(json.plugin)
    } catch (err) {
      console.error('Failed to fork:', err)
    }
  }

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return
    setAiGenerating(true)
    setAiError(null)

    try {
      const res = await fetch('/api/plugins/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Generation failed')
      }

      const json = await res.json()
      if (json.entryHtml) {
        setEditorHtml(json.entryHtml)
        if (json.name) setEditorName(json.name)
        if (json.slug) setEditorSlug(json.slug)
        if (json.description) setEditorDescription(json.description)
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setAiGenerating(false)
    }
  }

  const filteredPlugins = plugins.filter((p) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      p.slug.toLowerCase().includes(q) ||
      p.author.pageSlug?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    )
  })

  // === LIST VIEW ===
  if (view === 'list') {
    return (
      <div className="space-y-4">
        {/* Controls */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search plugins..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? 'My Plugins' : 'All Plugins'}
          </Button>
          <Button size="sm" onClick={() => openEditor()}>
            <Plus className="h-4 w-4 mr-1" /> New Plugin
          </Button>
        </div>

        {/* Plugin list */}
        {loading ? (
          <p className="text-muted-foreground text-sm py-8 text-center">Loading...</p>
        ) : filteredPlugins.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>{search ? 'No plugins match your search' : 'No plugins yet'}</p>
            {!search && (
              <Button variant="outline" className="mt-4" onClick={() => openEditor()}>
                <Plus className="h-4 w-4 mr-1" /> Create your first plugin
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredPlugins.map((plugin) => {
              const isOwner = plugin.author.id === userId
              const authorLabel = plugin.author.pageName || plugin.author.name || plugin.author.pageSlug || 'Unknown'

              return (
                <div
                  key={plugin.id}
                  className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{plugin.name}</span>
                      <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {plugin.author.pageSlug}/{plugin.slug}
                      </code>
                    </div>
                    {plugin.description && (
                      <p className="text-sm text-muted-foreground mt-1 truncate">{plugin.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      by {authorLabel} · v{plugin.version}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 ml-3">
                    {isOwner ? (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => openEditor(plugin)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(plugin)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => openEditor(plugin)} title="View code">
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleFork(plugin)} title="Fork to your library">
                          <Copy className="h-4 w-4" />
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
    )
  }

  // === EDITOR VIEW ===
  const isNewPlugin = !editingPlugin
  const isOwner = editingPlugin?.author.id === userId
  const canEdit = isNewPlugin || isOwner

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setView('list')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h2 className="text-lg font-semibold flex-1">
          {isNewPlugin ? 'New Plugin' : `Edit: ${editingPlugin.name}`}
        </h2>
        {canEdit && (
          <Button size="sm" onClick={handleSave} disabled={saving || !editorName || !editorSlug}>
            {saving ? 'Saving...' : editingPlugin ? 'Update' : 'Create'}
          </Button>
        )}
      </div>

      {saveError && (
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {saveError}
        </div>
      )}

      {/* Metadata fields */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-sm font-medium mb-1 block">Name</label>
          <Input
            value={editorName}
            onChange={(e) => setEditorName(e.target.value)}
            placeholder="Periodic Table Explorer"
            disabled={!canEdit}
          />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Slug</label>
          <Input
            value={editorSlug}
            onChange={(e) => setEditorSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            placeholder="periodic-table"
            disabled={!!editingPlugin}
          />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Description</label>
          <Input
            value={editorDescription}
            onChange={(e) => setEditorDescription(e.target.value)}
            placeholder="Optional description"
            disabled={!canEdit}
          />
        </div>
      </div>

      {/* AI Generation */}
      {canEdit && (
        <div className="flex gap-2">
          <Input
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="Describe your plugin... (e.g., 'interactive flashcard quiz with flip animation')"
            onKeyDown={(e) => e.key === 'Enter' && !aiGenerating && handleAiGenerate()}
            className="flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleAiGenerate}
            disabled={aiGenerating || !aiPrompt.trim()}
          >
            <Sparkles className="h-4 w-4 mr-1" />
            {aiGenerating ? 'Generating...' : 'Generate'}
          </Button>
        </div>
      )}
      {aiError && (
        <p className="text-sm text-destructive">{aiError}</p>
      )}

      {/* Usage hint */}
      {editingPlugin && (
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
          Use in markdown: <code className="bg-muted px-1 rounded">{`<plugin src="${editingPlugin.author.pageSlug}/${editingPlugin.slug}" />`}</code>
        </div>
      )}

      {/* Code editor + Preview side by side */}
      <div className="grid grid-cols-2 gap-4" style={{ height: 'calc(100vh - 400px)', minHeight: 400 }}>
        {/* Code editor */}
        <div className="flex flex-col">
          <label className="text-sm font-medium mb-1">HTML</label>
          <textarea
            value={editorHtml}
            onChange={(e) => setEditorHtml(e.target.value)}
            disabled={!canEdit}
            className="flex-1 rounded-md border bg-muted/30 p-3 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            spellCheck={false}
          />
        </div>

        {/* Live preview */}
        <div className="flex flex-col">
          <label className="text-sm font-medium mb-1">Preview</label>
          <div className="flex-1 rounded-md border overflow-hidden bg-background">
            {previewSrcdoc ? (
              <iframe
                ref={previewRef}
                sandbox="allow-scripts allow-same-origin"
                srcDoc={previewSrcdoc}
                className="w-full h-full border-0"
                title="Plugin preview"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Write some HTML to see a preview
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const DEFAULT_PLUGIN_HTML = `<style>
  body {
    font-family: system-ui, sans-serif;
    padding: 16px;
    margin: 0;
  }
  .counter {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 18px;
  }
  button {
    padding: 8px 16px;
    border-radius: 6px;
    border: 1px solid #ccc;
    background: #f5f5f5;
    cursor: pointer;
    font-size: 16px;
  }
  button:hover { background: #e8e8e8; }
</style>

<div class="counter">
  <button id="dec">−</button>
  <span id="count">0</span>
  <button id="inc">+</button>
</div>

<script>
  var plugin = eduskript.init();
  var count = 0;

  plugin.onReady(function(ctx) {
    if (ctx.data && ctx.data.state) {
      count = ctx.data.state.count || 0;
    }
    document.getElementById('count').textContent = count;
    document.body.style.color = ctx.theme === 'dark' ? '#e0e0e0' : '#222';
    document.body.style.background = ctx.theme === 'dark' ? '#1a1a1a' : '#fff';
  });

  plugin.onThemeChange(function(theme) {
    document.body.style.color = theme === 'dark' ? '#e0e0e0' : '#222';
    document.body.style.background = theme === 'dark' ? '#1a1a1a' : '#fff';
  });

  function update(delta) {
    count += delta;
    document.getElementById('count').textContent = count;
    plugin.setData({ state: { count: count }, updatedAt: Date.now() });
  }

  document.getElementById('inc').addEventListener('click', function() { update(1); });
  document.getElementById('dec').addEventListener('click', function() { update(-1); });
<\/script>`
