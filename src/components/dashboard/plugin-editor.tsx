'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { PageCog } from '@/components/icons/settings-icons'
import { PAYWALL_COPY } from '@/components/dashboard/upgrade-prompt'
import { useUnsavedChangesGuard } from '@/components/dashboard/unsaved-changes-guard'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { useIsFreeTeacher } from '@/hooks/use-billing'
import { useUiLocale } from '@/lib/i18n/client'
import { buildPluginSrcdoc } from '@/lib/plugin-sdk'
import { generateSlug } from '@/lib/markdown'
import { extractPluginHtml } from '@/lib/ai/plugin-prompt'
import { expandTemplates, findTemplateRefs } from '@/lib/plugin-templates'
import { PluginTemplatesDialog, TemplateAddForm } from '@/components/dashboard/plugin-templates'
import {
  AlertTriangle, ArrowLeft, Check, ChevronLeft, ChevronRight, Code2, Copy, Eye, GitFork, History,
  Loader2, Lock, Map as MapIcon, RotateCcw, Save, Send, Sparkles, Square, Undo2, Wand2,
} from 'lucide-react'

export interface PluginData {
  id: string
  slug: string
  name: string
  description: string | null
  entryHtml: string
  author: { id: string; pageSlug: string | null; pageName: string | null; name: string | null }
}

interface PluginVersionRow {
  id: string
  version: number
  changeLog: string | null
  createdAt: string
  entryHtml: string
}

type Turn =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'ai'; text: string; htmlBefore: string }
  | { id: string; role: 'question'; text: string }
  | { id: string; role: 'error'; text: string }
  /** The AI needs an SVG template; `request` is the wish to resend once one is added. */
  | { id: string; role: 'template'; text: string; request: string; done?: string }

/** sessionStorage handshake with the page editor's Insert → Plugin → "New plugin with AI". */
export const PLUGIN_INSERT_KEY = 'eduskript:plugin-insert'
export interface PluginInsertRequest {
  /** Page editor path to return to. */
  returnTo: string
  /** Cursor offset in the page markdown when the picker was opened. */
  pos: number
  /** Set by the plugin editor on "Save & insert": the `<plugin src>` to insert. */
  src?: string
}

const SPLIT_KEY = 'eduskript:plugin-editor-split'
const AI_HEIGHT_KEY = 'eduskript:plugin-editor-ai-height'
const AI_HEIGHT = { min: 110, default: 170, max: 640 }
const READY_TIMEOUT_MS = 5000

const START_IDEAS = [
  'A memory game with word pairs',
  'A quiz with 5 multiple-choice questions',
  'A simulation with sliders',
  'Sort items into groups by drag and drop',
]
const FOLLOW_UPS = ['Make it more colourful', 'Make it work well on phones', 'Make it easier', 'Add a score']

const pluginSlugFrom = (name: string) =>
  generateSlug(name).replace(/_/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '')

/** "eine grosse Karte von Afrika mit Ländergrenzen (nur …)" → "Grosse Karte von Afrika" */
const shortTitle = (need: string) => {
  const head = need.replace(/^(eine?|die|der|das)\s+/i, '').split(/[,(;:]| mit /)[0].trim()
  const cut = head.length > 40 ? head.slice(0, 40).replace(/\s+\S*$/, '') : head
  return cut.replace(/^./, (c) => c.toUpperCase())
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

/**
 * Plugin editor (/dashboard/plugins/new, /dashboard/plugins/edit/<owner>/<slug>).
 * Same layout language as the page editor: title row (name, cog popover with
 * details, version history, Save), an AI strip on top (AI Edit look: short
 * history with one-sentence summaries, Undo per step), and below a preview |
 * code split with a draggable divider; either side can be collapsed.
 * Decisions: qa/DECISIONS.md "Plugins (2026-10-05)" in the eduskript-qa worktree.
 */
export function PluginEditor({ userId, ownerSlug, plugin, returnTo }: {
  userId: string
  /** The current user's primary site slug (prefix of new plugins' src). */
  ownerSlug: string
  plugin: PluginData | null
  /** Page editor path when opened via Insert → Plugin → "New plugin with AI". */
  returnTo?: string
}) {
  const router = useRouter()
  const dialog = useAlertDialog()
  const isFreePlan = useIsFreeTeacher()
  const paywall = PAYWALL_COPY[useUiLocale()]
  const { resolvedTheme } = useTheme()

  const isNew = !plugin
  const canEdit = isNew || plugin.author.id === userId
  const srcOwner = plugin?.author.pageSlug || ownerSlug

  // --- Plugin fields (saved* = last saved state, for the dirty flag) ---
  const [name, setName] = useState(plugin?.name ?? '')
  const [slug, setSlug] = useState(plugin?.slug ?? '')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState(plugin?.description ?? '')
  const [html, setHtml] = useState(plugin?.entryHtml ?? DEFAULT_PLUGIN_HTML)
  const [saved, setSaved] = useState(() => ({
    name: plugin?.name ?? '', description: plugin?.description ?? '', html: plugin?.entryHtml ?? DEFAULT_PLUGIN_HTML,
  }))
  const [savedPlugin, setSavedPlugin] = useState<PluginData | null>(plugin)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Summary of the last AI step, used as the version note on the next save.
  const lastAiSummary = useRef<string | null>(null)

  const effectiveSlug = savedPlugin ? savedPlugin.slug : (slugTouched ? slug : pluginSlugFrom(name))
  const isDirty = canEdit && (name !== saved.name || description !== saved.description || html !== saved.html || !savedPlugin)
  const hasChanges = canEdit && (name !== saved.name || description !== saved.description || html !== saved.html)

  // --- Preview (debounced) + error/ready reporting from the iframe ---
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [previewHtml, setPreviewHtml] = useState(html)
  const [previewError, setPreviewError] = useState<{ message: string; line: number } | null>(null)
  const [notReady, setNotReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setPreviewHtml(html), 400)
    return () => clearTimeout(t)
  }, [html])
  // Template SVGs referenced by the plugin (<es-template name="…">), fetched once each.
  const [templateSvgs, setTemplateSvgs] = useState<Record<string, string>>({})
  const missingRefs = useMemo(() => findTemplateRefs(previewHtml).filter((s) => !(s in templateSvgs)), [previewHtml, templateSvgs])
  useEffect(() => {
    if (missingRefs.length === 0) return
    fetch(`/api/plugin-templates/svg?slugs=${encodeURIComponent(missingRefs.join(','))}`)
      .then((r) => r.json())
      .then((j) => setTemplateSvgs((prev) => {
        const next = { ...prev, ...(j.svgs || {}) }
        // Unknown slugs: remember as missing so they render the "not found" note instead of refetching.
        for (const slug of missingRefs) if (!(slug in next)) next[slug] = `<p style="color:#b91c1c;font:14px system-ui">Template "${slug}" not found.</p>`
        return next
      }))
      .catch(() => {})
  }, [missingRefs])
  const expandedPreview = useMemo(() => expandTemplates(previewHtml, templateSvgs), [previewHtml, templateSvgs])
  const srcdoc = useMemo(() => buildPluginSrcdoc(expandedPreview, resolvedTheme), [expandedPreview, resolvedTheme])
  const themeRef = useRef(resolvedTheme)
  themeRef.current = resolvedTheme
  const readyRef = useRef(false)
  // One permanent listener, attached in a layout effect, and the iframe is only
  // rendered after mount: with SSR the srcdoc iframe loaded and posted
  // plugin:ready before hydration attached any listener → false "does not start".
  const [mounted, setMounted] = useState(false)
  useLayoutEffect(() => {
    setMounted(true)
    const onMessage = (e: MessageEvent) => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return
      const msg = e.data as { type?: string; message?: string; line?: number; requestId?: number }
      if (!msg || typeof msg.type !== 'string') return
      const reply = (m: Record<string, unknown>) => iframeRef.current?.contentWindow?.postMessage(m, '*')
      if (msg.type === 'plugin:ready') {
        readyRef.current = true
        setNotReady(false)
        // Act as the host so onReady callbacks run in the preview too.
        reply({ type: 'host:init', config: {}, data: null, theme: themeRef.current || 'light' })
      } else if (msg.type === 'plugin:getData') {
        reply({ type: 'host:data', requestId: msg.requestId, data: null })
      } else if (msg.type === 'plugin:error') {
        setPreviewError((prev) => prev ?? { message: msg.message || 'Script error', line: msg.line || 0 })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  // New document → forget the old one's state before its scripts can run.
  useLayoutEffect(() => {
    readyRef.current = false
    setPreviewError(null)
    setNotReady(false)
  }, [srcdoc])
  // The SDK announces readiness at the latest on load; give it a moment after
  // load (a plugin stuck in an endless loop never fires load at all).
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    readyTimer.current = setTimeout(() => { if (!readyRef.current) setNotReady(true) }, READY_TIMEOUT_MS)
    return () => { if (readyTimer.current) clearTimeout(readyTimer.current) }
  }, [srcdoc])
  // Error lines count from the top of the srcdoc (SDK + wrapper); shift them so
  // they match the line numbers of the code pane.
  const lineOffset = useMemo(() => {
    const at = srcdoc.indexOf(expandedPreview)
    return at < 0 ? 0 : srcdoc.slice(0, at).split('\n').length - 1
  }, [srcdoc, expandedPreview])
  const codeLine = previewError && previewError.line > lineOffset ? previewError.line - lineOffset : 0
  const previewProblem = previewError
    ? `${previewError.message}${codeLine ? ` (code line ${codeLine})` : ''}`
    : notReady ? 'The plugin does not start (it never finished loading).' : null

  // While dragging, the preview iframe must not swallow pointer events,
  // otherwise moving over it stops the drag (pointermove goes to the iframe).
  const [dragging, setDragging] = useState(false)
  // AI strip height (drag handle at its bottom edge), remembered per browser.
  const [aiHeight, setAiHeight] = useState(AI_HEIGHT.default)
  useEffect(() => {
    try {
      const h = Number(localStorage.getItem(AI_HEIGHT_KEY))
      if (h >= AI_HEIGHT.min && h <= AI_HEIGHT.max) setAiHeight(h)
    } catch { /* private mode */ }
  }, [])
  const startAiDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = aiHeight
    let latest = startH
    setDragging(true)
    const onMove = (ev: PointerEvent) => {
      latest = Math.min(AI_HEIGHT.max, Math.max(AI_HEIGHT.min, startH + ev.clientY - startY))
      setAiHeight(latest)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setDragging(false)
      try { localStorage.setItem(AI_HEIGHT_KEY, String(latest)) } catch { /* private mode */ }
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const strayText = useMemo(() => extractPluginHtml(html) !== html.trim(), [html])

  // --- AI ---
  const [turns, setTurns] = useState<Turn[]>([])
  const [prompt, setPrompt] = useState('')
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [aiPhase, setAiPhase] = useState<'thinking' | 'writing' | null>(null)
  const [aiChars, setAiChars] = useState(0)
  const [aiStarted, setAiStarted] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const turnsRef = useRef<HTMLDivElement>(null)
  const aiBusy = aiPhase !== null
  useEffect(() => {
    const el = turnsRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, aiPhase])

  const sendPrompt = useCallback(async (text: string) => {
    const request = text.trim()
    if (!request || abortRef.current) return
    const htmlBefore = html
    const controller = new AbortController()
    abortRef.current = controller
    setTurns((t) => [...t, { id: newId(), role: 'user', text: request }])
    setPrompt('')
    setAiPhase('thinking')
    setAiChars(0)
    setAiStarted(Date.now())
    const fail = (message: string) => {
      setTurns((t) => [...t, { id: newId(), role: 'error', text: message }])
      setPrompt((p) => p || request)
    }
    try {
      const res = await fetch('/api/plugins/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: request, currentHtml: htmlBefore || undefined }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}))
        return fail(err.error || 'The AI is not reachable right now. Please try again.')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const ev = JSON.parse(line) as { type: string; phase?: 'thinking' | 'writing'; chars?: number; entryHtml?: string; summary?: string | null; question?: string; error?: string }
          if (ev.type === 'progress') {
            setAiPhase(ev.phase ?? 'thinking')
            setAiChars(ev.chars ?? 0)
          } else if (ev.type === 'done' && typeof ev.entryHtml === 'string') {
            finished = true
            const summary = ev.summary || 'Done — see the preview.'
            lastAiSummary.current = ev.summary || null
            setHtml(ev.entryHtml)
            setTurns((t) => [...t, { id: newId(), role: 'ai', text: summary, htmlBefore }])
            // A brand-new plugin gets a name from the first wish, so Save works right away.
            setName((n) => n || request.replace(/\s+/g, ' ').slice(0, 48).replace(/^./, (c) => c.toUpperCase()))
          } else if (ev.type === 'needs-template' && (ev as { need?: string }).need) {
            finished = true
            setTurns((t) => [...t, { id: newId(), role: 'template', text: (ev as { need?: string }).need!, request }])
          } else if (ev.type === 'question' && ev.question) {
            finished = true
            setTurns((t) => [...t, { id: newId(), role: 'question', text: ev.question! }])
          } else if (ev.type === 'error') {
            finished = true
            fail(ev.error || 'The AI could not build this. Please try again.')
          }
        }
      }
      if (!finished && !controller.signal.aborted) fail('The connection to the AI was interrupted. Please try again.')
    } catch {
      if (controller.signal.aborted) {
        setTurns((t) => [...t, { id: newId(), role: 'error', text: 'Stopped.' }])
      } else {
        fail('The AI is not reachable right now. Please try again.')
      }
    } finally {
      abortRef.current = null
      setAiPhase(null)
      setAiStarted(null)
    }
  }, [html])

  const undoTurn = (turnId: string) => {
    const index = turns.findIndex((t) => t.id === turnId)
    const turn = turns[index]
    if (!turn || turn.role !== 'ai') return
    setHtml(turn.htmlBefore)
    // Later steps were built on top of this one, so they go too.
    setTurns(turns.slice(0, index))
    lastAiSummary.current = null
  }
  const lastAiTurnId = [...turns].reverse().find((t) => t.role === 'ai')?.id

  // --- Save ---
  const doSave = useCallback(async (): Promise<PluginData | null> => {
    setSaving(true)
    setSaveError(null)
    try {
      const changeLog = lastAiSummary.current || undefined
      let res: Response
      if (savedPlugin) {
        res = await fetch(`/api/plugins/${encodeURIComponent(srcOwner)}/${encodeURIComponent(savedPlugin.slug)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), description: description || null, entryHtml: html, changeLog }),
        })
      } else {
        res = await fetch('/api/plugins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: effectiveSlug, name: name.trim(), description: description || null, manifest: {}, entryHtml: html, changeLog }),
        })
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Saving failed')
      const next = json.plugin as PluginData
      setSavedPlugin(next)
      setSaved({ name: name.trim(), description, html })
      lastAiSummary.current = null
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 1500)
      if (!savedPlugin && !returnTo) {
        // Give the new plugin its own URL so reload/back keep working.
        router.replace(`/dashboard/plugins/edit/${encodeURIComponent(next.author.pageSlug || srcOwner)}/${encodeURIComponent(next.slug)}`)
      }
      return next
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Saving failed')
      return null
    } finally {
      setSaving(false)
    }
  }, [savedPlugin, srcOwner, name, description, html, effectiveSlug, returnTo, router])

  const finishSave = useCallback(async () => {
    const result = await doSave()
    if (result && returnTo) {
      try {
        const req = JSON.parse(sessionStorage.getItem(PLUGIN_INSERT_KEY) || 'null') as PluginInsertRequest | null
        sessionStorage.setItem(PLUGIN_INSERT_KEY, JSON.stringify({
          returnTo, pos: req?.returnTo === returnTo ? req.pos : -1, src: `${result.author.pageSlug || srcOwner}/${result.slug}`,
        } satisfies PluginInsertRequest))
      } catch { /* storage blocked: the teacher inserts via the picker */ }
      router.push(returnTo)
    }
    return !!result
  }, [doSave, returnTo, router, srcOwner])

  const handleSave = () => {
    if (!name.trim()) {
      setSaveError('Give your plugin a name first (top left).')
      return
    }
    if (previewProblem) {
      dialog.showConfirm(
        `The preview shows a problem: "${previewProblem}". Students would see a broken plugin. Save anyway?`,
        () => { void finishSave() },
        { title: 'Plugin has an error', confirmText: 'Save anyway' },
      )
      return
    }
    void finishSave()
  }

  // Ctrl/Cmd+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (canEdit && !saving) handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const unsavedGuard = useUnsavedChangesGuard({ isDirty: isDirty && !(isNew && html === DEFAULT_PLUGIN_HTML && !name), onSave: async () => !!(await doSave()) })

  const handleFork = async () => {
    if (!plugin) return
    const res = await fetch(`/api/plugins/${encodeURIComponent(srcOwner)}/${encodeURIComponent(plugin.slug)}/fork`, { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setSaveError(json.error || 'Could not copy this plugin')
      return
    }
    const fork = json.plugin as PluginData
    router.push(`/dashboard/plugins/edit/${encodeURIComponent(fork.author.pageSlug || ownerSlug)}/${encodeURIComponent(fork.slug)}`)
  }

  // --- Version history (existing own plugins) ---
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versions, setVersions] = useState<PluginVersionRow[] | null>(null)
  useEffect(() => {
    if (!historyOpen || !savedPlugin) return
    fetch(`/api/plugins/${encodeURIComponent(srcOwner)}/${encodeURIComponent(savedPlugin.slug)}/versions`)
      .then((r) => r.json())
      .then((j) => setVersions(j.versions || []))
      .catch(() => setVersions([]))
  }, [historyOpen, savedPlugin, srcOwner])
  const restoreVersion = (v: PluginVersionRow) => {
    dialog.showConfirm(
      `Restore version ${v.version}? It is saved as a new version and is live on all pages right away.`,
      async () => {
        const res = await fetch(`/api/plugins/${encodeURIComponent(srcOwner)}/${encodeURIComponent(savedPlugin!.slug)}/versions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionId: v.id }),
        })
        if (!res.ok) return setSaveError('Restoring failed')
        setHtml(v.entryHtml)
        setSaved((s) => ({ ...s, html: v.entryHtml }))
        setVersions(null)
        setHistoryOpen(false)
      },
      { title: 'Restore version', confirmText: 'Restore' },
    )
  }

  // --- Split pane: preview | code ---
  const splitRef = useRef<HTMLDivElement>(null)
  const [split, setSplit] = useState(50) // preview width in %
  const [collapsed, setCollapsed] = useState<'none' | 'preview' | 'code'>('none')
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SPLIT_KEY) || 'null') as { split?: number; collapsed?: typeof collapsed } | null
      if (s?.split && s.split >= 15 && s.split <= 85) setSplit(s.split)
      if (s?.collapsed === 'preview' || s?.collapsed === 'code') setCollapsed(s.collapsed)
    } catch { /* private mode */ }
  }, [])
  const persistSplit = (next: { split: number; collapsed: typeof collapsed }) => {
    try { localStorage.setItem(SPLIT_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }
  const setCollapsedPersist = (c: typeof collapsed) => {
    setCollapsed(c)
    persistSplit({ split, collapsed: c })
  }
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const box = splitRef.current?.getBoundingClientRect()
    if (!box) return
    let latest = split
    setDragging(true)
    const onMove = (ev: PointerEvent) => {
      latest = Math.min(85, Math.max(15, ((ev.clientX - box.left) / box.width) * 100))
      setSplit(latest)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setDragging(false)
      persistSplit({ split: latest, collapsed })
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const embedTag = `<plugin src="${srcOwner}/${effectiveSlug || 'your-plugin'}" />`
  const [copied, setCopied] = useState(false)
  const copyEmbed = async () => {
    try {
      await navigator.clipboard.writeText(embedTag)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked */ }
  }

  const backHref = returnTo || '/dashboard/plugins'
  const saveLabel = saving ? 'Saving...' : returnTo ? 'Save & insert' : !hasChanges && savedPlugin ? 'Saved' : 'Save'
  const aiAllowed = canEdit && !isFreePlan

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Title row (like the page editor) */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Button asChild variant="ghost" size="sm" className="shrink-0 px-2" title={returnTo ? 'Back to the page' : 'Back to all plugins'}>
          <Link href={backHref}><ArrowLeft className="h-4 w-4" />{returnTo ? 'Page' : 'Plugins'}</Link>
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Untitled plugin"
          disabled={!canEdit}
          aria-label="Plugin name"
          className="h-9 min-w-[140px] flex-1 border-transparent text-lg font-semibold hover:border-border focus:border-border md:text-xl"
        />
        <div className="flex shrink-0 items-center gap-1 md:gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" title="Plugin details: description, URL, embed code" className="data-[state=open]:bg-blue-500/15 data-[state=open]:text-blue-700 dark:data-[state=open]:text-blue-300">
                <PageCog className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" style={{ width: 'min(420px, 92vw)' }} className="space-y-3 border-blue-400/70 p-4 shadow-lg dark:border-blue-500/60">
              <div className="space-y-1.5">
                <Label htmlFor="plugin-description" className="text-xs font-medium">Description</Label>
                <Input id="plugin-description" value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} placeholder="One sentence about this plugin" className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plugin-slug" className="text-xs font-medium">URL name</Label>
                <div className="flex h-8 items-center overflow-hidden rounded-md border bg-background text-sm">
                  <span className="shrink-0 border-r bg-muted px-2 py-1.5 text-xs text-muted-foreground">{srcOwner}/</span>
                  <input
                    id="plugin-slug"
                    value={effectiveSlug}
                    onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')) }}
                    disabled={!!savedPlugin}
                    className="min-w-0 flex-1 bg-transparent px-2 font-mono text-sm outline-none disabled:text-muted-foreground"
                  />
                  {savedPlugin && <Lock className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                </div>
                <p className="text-xs text-muted-foreground">
                  {savedPlugin ? 'Fixed after the first save, because pages embed the plugin by this name.' : 'Made from the name. You can change it until the first save.'}
                </p>
              </div>
              <div className="space-y-1.5 border-t pt-3">
                <Label className="text-xs font-medium">Embed in a page</Label>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{embedTag}</code>
                  <Button variant="outline" size="sm" className="h-7 shrink-0 gap-1 text-xs" onClick={copyEmbed}>
                    {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />} Copy
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Or in the page editor: Insert → Plugin.</p>
              </div>
            </PopoverContent>
          </Popover>
          {savedPlugin && canEdit && (
            <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" title="Version history" className={historyOpen ? 'bg-blue-500/15 text-blue-700 hover:bg-blue-500/20 dark:text-blue-300' : ''}>
                  <History className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" onOpenAutoFocus={(e) => e.preventDefault()} className="max-h-[70vh] w-[min(520px,90vw)] overflow-y-auto border-blue-400/70 p-2 shadow-lg dark:border-blue-500/60">
                <div className="px-2 pb-2 pt-1 text-sm font-semibold">Version history</div>
                {!versions ? (
                  <p className="px-2 py-4 text-sm text-muted-foreground">Loading…</p>
                ) : versions.length === 0 ? (
                  <p className="px-2 py-4 text-sm text-muted-foreground">No versions yet. Every save creates one.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {versions.map((v, i) => (
                      <div key={v.id} className="flex items-center gap-2 px-2 py-2 text-sm">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">v{v.version}</span>
                        {i === 0 && <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">Current</span>}
                        <span className="min-w-0 flex-1 truncate text-xs" title={v.changeLog || undefined}>
                          {v.changeLog || <span className="text-muted-foreground">Saved</span>}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground" title={new Date(v.createdAt).toLocaleString()}>
                          {formatDistanceToNow(new Date(v.createdAt), { addSuffix: true })}
                        </span>
                        {v.entryHtml !== html && (
                          <button onClick={() => restoreVersion(v)} className="inline-flex shrink-0 items-center rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent">
                            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          )}
          {canEdit ? (
            <Button
              onClick={handleSave}
              disabled={saving}
              size="sm"
              variant={hasChanges || !savedPlugin || returnTo ? 'default' : 'outline'}
              className={!hasChanges && savedPlugin && !returnTo ? (justSaved ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground') : ''}
              title={name.trim() ? 'Save (Ctrl+S). Saved changes are live on all pages right away.' : 'Give your plugin a name first'}
            >
              {!hasChanges && savedPlugin && !returnTo ? <Check className="mr-1 h-4 w-4" /> : <Save className="mr-1 h-4 w-4" />}
              {saveLabel}
            </Button>
          ) : (
            <Button size="sm" onClick={handleFork} title="Copy this plugin into your own library to change it">
              <GitFork className="mr-1 h-4 w-4" /> Copy to my plugins
            </Button>
          )}
        </div>
      </div>

      {saveError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive">{saveError}</div>
      )}

      {/* AI strip (AI Edit look) */}
      {aiAllowed ? (
        <div className="flex shrink-0 flex-col rounded-md border border-blue-400/60 bg-linear-to-b from-blue-500/15 to-blue-500/[0.02] px-3 pt-2 dark:border-blue-500/50" style={{ height: aiHeight }}>
          <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 gap-3">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
              {turns.length > 0 ? (
                <div ref={turnsRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 text-sm">
                  {turns.map((t) => t.role === 'template' ? (
                    <div key={t.id} className="max-w-[90%] rounded-lg border border-blue-400/60 bg-background px-2.5 py-2 text-sm">
                      <p className="mb-2">
                        <MapIcon className="mr-1 inline h-3.5 w-3.5 text-blue-500" />
                        For this I need a template with real outlines: <span className="font-medium">{t.text}</span>.
                        {!t.done && ' Add an SVG (e.g. from Wikimedia Commons) and I will continue.'}
                      </p>
                      {t.done ? (
                        <p className="text-xs text-muted-foreground"><Check className="mr-1 inline h-3.5 w-3.5 text-green-600" />Template «{t.done}» added.</p>
                      ) : (
                        <TemplateAddForm
                          compact
                          initialTitle={shortTitle(t.text)}
                          onAdded={(tpl) => {
                            setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, done: tpl.title } : x)))
                            void sendPrompt(`${t.request}\n\nUse the template "${tpl.slug}".`)
                          }}
                        />
                      )}
                    </div>
                  ) : (
                    <div key={t.id} className={t.role === 'user' ? 'text-right' : ''}>
                      <span className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-lg px-2.5 py-1 text-left ${
                        t.role === 'user' ? 'bg-primary text-primary-foreground'
                          : t.role === 'error' ? 'border border-destructive/40 bg-destructive/10 text-destructive'
                          : t.role === 'question' ? 'border border-blue-400/60 bg-background'
                          : 'border bg-background'
                      }`}>
                        {t.role === 'ai' && <Sparkles className="mr-1 inline h-3.5 w-3.5 text-blue-500" />}
                        {t.text}
                        {t.role === 'ai' && (
                          <button
                            onClick={() => undoTurn(t.id)}
                            className="ml-2 inline-flex items-center gap-0.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                            title={t.id === lastAiTurnId ? 'Undo this change' : 'Undo this change and all later ones'}
                          >
                            <Undo2 className="h-3 w-3" /> Undo
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-wrap content-start items-center gap-1.5 overflow-y-auto text-xs text-muted-foreground">
                  <span className="mr-1">{isNew ? 'Describe what your students should be able to do — the AI builds it. Ideas:' : 'Ask the AI to change this plugin, e.g.:'}</span>
                  {(isNew ? START_IDEAS : FOLLOW_UPS).map((p) => (
                    <button key={p} type="button" onClick={() => setPrompt(p)} className="rounded-full border bg-background px-2.5 py-0.5 text-foreground hover:bg-muted">{p}</button>
                  ))}
                </div>
              )}
              <div className="flex shrink-0 items-stretch gap-2">
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void sendPrompt(prompt)
                    }
                  }}
                  rows={2}
                  placeholder={isNew && turns.length === 0 ? 'e.g. "A memory game with 8 pairs: foreign words and their German meaning"  (Enter to send)' : 'What should change? (Enter to send, Shift+Enter for a new line)'}
                  className="min-h-[52px] resize-y bg-background text-sm"
                />
                {aiBusy ? (
                  <Button variant="destructive" size="icon" onClick={() => abortRef.current?.abort()} title="Stop" className="h-auto min-h-[52px] w-[44px] shrink-0">
                    <Square className="h-4 w-4 fill-current" />
                  </Button>
                ) : (
                  <Button size="icon" onClick={() => void sendPrompt(prompt)} disabled={!prompt.trim()} title="Send (Enter)" className="h-auto min-h-[52px] w-[44px] shrink-0">
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="hidden w-52 shrink-0 flex-col justify-center gap-1.5 border-l pl-3 text-xs md:flex">
              {aiBusy ? (
                <AiBusy phase={aiPhase!} chars={aiChars} since={aiStarted} />
              ) : turns.length > 0 ? (
                <>
                  <span className="text-muted-foreground">Next ideas:</span>
                  <div className="flex flex-wrap gap-1">
                    {FOLLOW_UPS.map((p) => (
                      <button key={p} type="button" onClick={() => setPrompt(p)} className="rounded-full border bg-background px-2 py-0.5 hover:bg-muted">{p}</button>
                    ))}
                  </div>
                </>
              ) : (
                <span className="text-muted-foreground">
                  <Wand2 className="mr-1 inline h-3.5 w-3.5 text-blue-500" />
                  No coding needed. Each answer changes the preview below; Undo goes back a step.
                </span>
              )}
              {!aiBusy && (
                <button type="button" onClick={() => setTemplatesOpen(true)} className="flex items-center gap-1 self-start text-muted-foreground hover:text-foreground" title="Real maps and diagrams the AI can use">
                  <MapIcon className="h-3.5 w-3.5" /> Maps & diagrams…
                </button>
              )}
            </div>
          </div>
          {aiBusy && (
            <div className="mt-1 md:hidden"><AiBusy phase={aiPhase!} chars={aiChars} since={aiStarted} /></div>
          )}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize AI panel"
            title="Drag to resize"
            onPointerDown={startAiDrag}
            className="group flex h-3 shrink-0 cursor-row-resize items-center justify-center rounded hover:bg-blue-500/10"
          >
            <div className="h-1.5 w-16 rounded-full bg-muted-foreground/40 transition-colors group-hover:bg-blue-500/70" />
          </div>
        </div>
      ) : canEdit ? (
        <div className="flex shrink-0 items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          {paywall.aiPlugins}{' '}
          <Link href="/dashboard/billing" className="underline hover:text-foreground">{paywall.upgrade}</Link>
        </div>
      ) : null}

      {/* Plugins generated before the prose-leak fix can still carry the AI's
          chat text and ``` fences in their saved HTML. */}
      {canEdit && strayText && (
        <div className="flex shrink-0 items-center gap-2 rounded-md border border-amber-400/70 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 dark:border-amber-600/60 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">This plugin still contains text from the AI that students see (e.g. &quot;Here&apos;s a …&quot; or ```html).</span>
          <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1 bg-background text-xs" onClick={() => setHtml(extractPluginHtml(html))}>
            <Wand2 className="h-3.5 w-3.5" /> Remove it
          </Button>
        </div>
      )}

      {/* Error banner from the preview */}
      {previewProblem && (
        <div className="flex shrink-0 items-center gap-2 rounded-md border border-amber-400/70 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 dark:border-amber-600/60 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={previewProblem}>This plugin has an error: {previewProblem}</span>
          {aiAllowed && (
            <Button
              size="sm"
              variant="outline"
              disabled={aiBusy}
              className="h-7 shrink-0 gap-1 bg-background text-xs"
              onClick={() => void sendPrompt(`Fix this error in the plugin: "${previewProblem}". Keep everything else as it is.`)}
            >
              <Wand2 className="h-3.5 w-3.5" /> Ask AI to fix
            </Button>
          )}
        </div>
      )}

      {/* Preview | code */}
      <div ref={splitRef} className="flex min-h-[320px] flex-1 flex-col gap-2 md:flex-row md:gap-0">
        {collapsed !== 'preview' ? (
          <section
            className="flex min-h-[240px] min-w-0 flex-col md:min-h-0"
            style={collapsed === 'none' ? { flexBasis: `${split}%`, flexGrow: 0, flexShrink: 0 } : { flex: 1 }}
          >
            <PaneHeader icon={<Eye className="h-3.5 w-3.5" />} label="Preview" />
            <div className="flex-1 overflow-hidden rounded-md border bg-background">
              {mounted && missingRefs.length === 0 && <iframe ref={iframeRef} sandbox="allow-scripts allow-same-origin" srcDoc={srcdoc} className="h-full w-full border-0" style={dragging ? { pointerEvents: 'none' } : undefined} title="Plugin preview" />}
            </div>
          </section>
        ) : (
          <CollapsedBar label="Preview" icon={<Eye className="h-3.5 w-3.5" />} side="left" onExpand={() => setCollapsedPersist('none')} />
        )}

        {collapsed === 'none' && (
          <div className="group relative hidden w-4 shrink-0 cursor-col-resize touch-none md:block" onPointerDown={startDrag} onDoubleClick={() => { setSplit(50); persistSplit({ split: 50, collapsed }) }} role="separator" aria-orientation="vertical" aria-label="Resize preview and code" title="Drag to resize, double-click for 50:50">
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover:w-1 group-hover:bg-blue-500/60" />
            <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-1">
              <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => setCollapsedPersist('preview')} title="Hide preview" className="rounded border bg-background p-0.5 text-muted-foreground shadow-sm hover:text-foreground">
                <ChevronLeft className="h-3 w-3" />
              </button>
              <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => setCollapsedPersist('code')} title="Hide code" className="rounded border bg-background p-0.5 text-muted-foreground shadow-sm hover:text-foreground">
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {collapsed !== 'code' ? (
          <section className="flex min-h-[240px] min-w-0 flex-1 flex-col md:min-h-0">
            <PaneHeader icon={<Code2 className="h-3.5 w-3.5" />} label="Code" hint={canEdit ? 'HTML, CSS and JavaScript — only if you want to edit by hand' : 'Read only'} />
            <textarea
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              disabled={!canEdit}
              spellCheck={false}
              aria-label="Plugin code"
              className="flex-1 resize-none rounded-md border bg-muted/30 p-3 font-mono text-xs focus:outline-hidden focus:ring-2 focus:ring-ring md:text-sm"
            />
          </section>
        ) : (
          <CollapsedBar label="Code" icon={<Code2 className="h-3.5 w-3.5" />} side="right" onExpand={() => setCollapsedPersist('none')} />
        )}
      </div>

      <PluginTemplatesDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onUse={(t) => setPrompt((p) => `${p ? `${p} ` : ''}Use the template "${t.slug}" (${t.title}).`)}
      />
      {unsavedGuard.dialog}
      <AlertDialogModal
        open={dialog.open} onOpenChange={dialog.setOpen}
        type={dialog.type} title={dialog.title} message={dialog.message}
        onConfirm={dialog.onConfirm} showCancel={dialog.showCancel}
        confirmText={dialog.confirmText} cancelText={dialog.cancelText}
        destructive={dialog.destructive}
      />
    </div>
  )
}

function PaneHeader({ icon, label, hint }: { icon: React.ReactNode; label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-1 pb-1 text-xs font-medium text-muted-foreground">
      {icon} {label}
      {hint && <span className="truncate font-normal">· {hint}</span>}
    </div>
  )
}

/** A collapsed pane: thin bar with a button to bring it back. */
function CollapsedBar({ label, icon, side, onExpand }: { label: string; icon: React.ReactNode; side: 'left' | 'right'; onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      title={`Show ${label.toLowerCase()}`}
      className={`flex shrink-0 items-center justify-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground md:w-8 md:flex-col md:py-3 ${side === 'left' ? 'md:mr-2' : 'md:ml-2'}`}
    >
      {side === 'left' ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      {icon}
      <span className="md:[writing-mode:vertical-rl]">Show {label.toLowerCase()}</span>
    </button>
  )
}

function AiBusy({ phase, chars, since }: { phase: 'thinking' | 'writing'; chars: number; since: number | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const seconds = since ? Math.max(0, Math.round((now - since) / 1000)) : 0
  return (
    <div className="flex flex-col gap-0.5 text-muted-foreground" role="status">
      <span className="flex items-center gap-1.5 text-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
        {phase === 'thinking' ? 'Planning your plugin…' : 'Building your plugin…'}
        <span className="tabular-nums text-muted-foreground">{seconds}s</span>
      </span>
      <span>
        {phase === 'writing' ? `${(chars / 1000).toFixed(1)} KB written · ` : ''}
        usually 30–90 s
      </span>
    </div>
  )
}

export const DEFAULT_PLUGIN_HTML = `<style>
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
  :root[data-theme="dark"] body { color: #e0e0e0; }
  :root[data-theme="dark"] button { background: #2a2a2a; border-color: #444; color: #e0e0e0; }
</style>

<div class="counter">
  <button id="dec">−</button>
  <span id="count">0</span>
  <button id="inc">+</button>
</div>

<script>
  var count = 0;
  var plugin = typeof window.eduskript !== 'undefined' ? eduskript.init() : null;

  if (plugin) {
    plugin.onReady(function(ctx) {
      if (ctx.data && ctx.data.state) count = ctx.data.state.count || 0;
      document.getElementById('count').textContent = count;
    });
  }

  function update(delta) {
    count += delta;
    document.getElementById('count').textContent = count;
    if (plugin) plugin.setData({ state: { count: count }, updatedAt: Date.now() });
  }

  document.getElementById('inc').addEventListener('click', function() { update(1); });
  document.getElementById('dec').addEventListener('click', function() { update(-1); });
<\/script>`
