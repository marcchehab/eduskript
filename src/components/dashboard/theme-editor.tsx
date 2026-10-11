'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Save, Loader2, ExternalLink, RotateCw, Copy, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { useUnsavedChangesGuard } from '@/components/dashboard/unsaved-changes-guard'
import { cn } from '@/lib/utils'
import { CUSTOM_CSS_MAX_LENGTH, type ThemePreset } from '@/lib/settings'
import { sanitizeCustomCss, type RemovedCssItem } from '@/lib/custom-css'
import {
  THEME_PREVIEW_MESSAGE,
  THEME_PREVIEW_READY,
  type ThemePreviewState,
} from '@/components/public/theme-preview'
import type { ThemeEditorData } from '@/lib/theme-editor-data'
import type { ThemeSettingsInput } from '@/lib/site-theme-save'

/**
 * Per-site theme editor (dashboard → <site> → Theme).
 *
 * Left: preset, navigation, reading progress, custom CSS, sharing between
 * the user's sites. Right: a real public page of the site in an iframe. The
 * iframe is same-origin; unsaved settings are posted to it and swapped in by
 * PublicSiteLayout (src/components/public/theme-preview.ts), so the preview
 * shows the actual page CSS without saving anything.
 *
 * Saves go to PUT /api/sites/[siteId]/theme, sharing to
 * POST /api/sites/[siteId]/theme/apply.
 */

const PRESETS: Array<{ value: ThemePreset; label: string; description: string }> = [
  { value: 'modern', label: 'Fancy', description: 'Large titles with rainbow accents. The original look.' },
  { value: 'classic', label: 'Fancy (Garamond)', description: 'Fancy with a Garamond body font.' },
  { value: 'sober', label: 'Sober', description: 'Sans-serif, modest headings, no decoration.' },
  { value: 'latex', label: 'LaTeX', description: 'Libertinus serif, justified text, like a LaTeX article.' },
]

/** Logical width of the preview page: wide enough for the desktop sidebar (≥1344px). */
const PREVIEW_WIDTH = 1400

function sameSettings(a: ThemeSettingsInput, b: ThemeSettingsInput) {
  return a.preset === b.preset &&
    a.sidebarBehavior === b.sidebarBehavior &&
    a.showReadingProgress === b.showReadingProgress &&
    a.customCss === b.customCss
}

/** Real .prose-theme markup, scaled down, so the card uses the live CSS. */
function PresetSample({ preset }: { preset: ThemePreset }) {
  return (
    <div className="pointer-events-none h-28 overflow-hidden rounded-md border border-border bg-card" aria-hidden>
      <div data-typography={preset} style={{ width: 640, transform: 'scale(0.36)', transformOrigin: 'top left' }}>
        <div className="prose-theme px-10 pt-2">
          <h1>Photosynthesis</h1>
          <h2>Light reactions</h2>
          <p>
            Plants convert light into chemical energy. The light-dependent reactions take place in
            the thylakoid membranes of the chloroplasts.
          </p>
        </div>
      </div>
    </div>
  )
}

export function ThemeEditor({ site, otherSites, previewTargets, allowedUrlPrefixes }: ThemeEditorData) {
  const router = useRouter()
  const dialog = useAlertDialog()
  const [saved, setSaved] = useState<ThemeSettingsInput>(site.settings)
  const [settings, setSettings] = useState<ThemeSettingsInput>(site.settings)
  const [saving, setSaving] = useState(false)
  const [removed, setRemoved] = useState<RemovedCssItem[]>([])
  const [applyTargets, setApplyTargets] = useState<string[]>([])
  const [copyFrom, setCopyFrom] = useState('')
  const isDirty = !sameSettings(settings, saved)

  const update = (patch: Partial<ThemeSettingsInput>) => setSettings(prev => ({ ...prev, ...patch }))

  const handleSave = useCallback(async (): Promise<boolean> => {
    setSaving(true)
    try {
      const response = await fetch(`/api/sites/${site.id}/theme`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        dialog.showError(data.error || 'Failed to save the theme.')
        return false
      }
      // The stored CSS is the sanitized one; show exactly that.
      setSaved(data.settings)
      setSettings(data.settings)
      setRemoved(data.removed ?? [])
      router.refresh()
      return true
    } catch {
      dialog.showError('Failed to save the theme. Please try again.')
      return false
    } finally {
      setSaving(false)
    }
  }, [settings, site.id, dialog, router])

  const unsavedGuard = useUnsavedChangesGuard({ isDirty, onSave: handleSave })

  const handleApply = async () => {
    const response = await fetch(`/api/sites/${site.id}/theme/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetSiteIds: applyTargets }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      dialog.showError(data.error || 'Failed to apply the theme.')
      return
    }
    const names = otherSites.filter(s => applyTargets.includes(s.id)).map(s => s.name).join(', ')
    setApplyTargets([])
    dialog.showSuccess(`Theme applied to ${names}.`)
    router.refresh()
  }

  const handleCopyFrom = (id: string) => {
    setCopyFrom(id)
    const source = otherSites.find(s => s.id === id)
    if (source) setSettings({ ...source.settings })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Theme</h1>
        <p className="text-muted-foreground mt-2">
          How the public pages of <span className="font-medium">{site.name}</span> look to students.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
        {/* ---------------- Controls ---------------- */}
        <div className="space-y-6">
          <section className="space-y-3">
            <Label className="text-sm font-medium">Preset</Label>
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Theme preset">
              {PRESETS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={settings.preset === p.value}
                  onClick={() => update({ preset: p.value })}
                  className={cn(
                    'rounded-lg border p-2 text-left transition-colors',
                    settings.preset === p.value
                      ? 'border-primary ring-2 ring-primary/30'
                      : 'border-border hover:border-muted-foreground/50'
                  )}
                >
                  <PresetSample preset={p.value} />
                  <div className="mt-2 text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-muted-foreground">{p.description}</div>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Changing the theme reflows text. Pen annotations on existing pages may shift relative to the text.
            </p>
          </section>

          <section className="space-y-3 border-t pt-6">
            <Label className="text-sm font-medium">Sidebar navigation</Label>
            {([
              { value: 'full', label: 'Full', help: 'Always show all collections in the sidebar.' },
              { value: 'contextual', label: 'Contextual', help: 'Inside a skript, show only that skript in the sidebar.' },
            ] as const).map(opt => (
              <label key={opt.value} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="sidebarBehavior"
                  value={opt.value}
                  checked={settings.sidebarBehavior === opt.value}
                  onChange={() => update({ sidebarBehavior: opt.value })}
                  className="mt-1"
                />
                <div>
                  <div className="text-sm">{opt.label}</div>
                  <p className="text-xs text-muted-foreground">{opt.help}</p>
                </div>
              </label>
            ))}
          </section>

          <section className="flex items-start justify-between gap-4 border-t pt-6">
            <div>
              <Label htmlFor="showReadingProgress" className="text-sm font-medium">Show reading progress bar</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Thin bar at the top showing chapter progress. Students can still use the scrollbar.
              </p>
            </div>
            <Switch
              id="showReadingProgress"
              checked={settings.showReadingProgress}
              onCheckedChange={(checked) => update({ showReadingProgress: checked })}
            />
          </section>

          <section className="space-y-2 border-t pt-6">
            <Label htmlFor="customCss" className="text-sm font-medium">Custom CSS</Label>
            <p className="text-xs text-muted-foreground">
              Added to every public page of this site. For student privacy nothing may load from
              outside Eduskript: <code>@import</code> is removed, and <code>url()</code> only works for
              files from skripts on this site (by file name, e.g. <code>url(background.png)</code>, resolved
              when you save), Eduskript file URLs and <code>data:</code> images/fonts.
            </p>
            <Textarea
              id="customCss"
              value={settings.customCss}
              onChange={(e) => update({ customCss: e.target.value })}
              placeholder={'.prose-theme h1 {\n  color: #1d4ed8;\n}'}
              rows={12}
              maxLength={CUSTOM_CSS_MAX_LENGTH}
              spellCheck={false}
              className="font-mono text-xs"
            />
            {removed.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <div className="font-medium mb-1">Removed when saving:</div>
                <ul className="list-disc pl-4 space-y-0.5 break-all">
                  {removed.map((r, i) => (
                    <li key={i}>
                      {r.kind === 'import' ? '@import rule' : 'url'}: <code>{r.value}</code>
                      {r.relative && ' (no file with this name in the skripts on this site)'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <div className="flex items-center gap-3 border-t pt-6">
            <Button onClick={handleSave} disabled={!isDirty || saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </Button>
            {isDirty && (
              <Button variant="ghost" onClick={() => { setSettings(saved); setCopyFrom('') }} disabled={saving}>
                Discard changes
              </Button>
            )}
          </div>

          {otherSites.length > 0 && (
            <section className="space-y-4 border-t pt-6">
              <div className="space-y-2">
                <Label htmlFor="copyFrom" className="text-sm font-medium flex items-center gap-2">
                  <Copy className="w-4 h-4" /> Copy theme from another site
                </Label>
                <select
                  id="copyFrom"
                  value={copyFrom}
                  onChange={(e) => handleCopyFrom(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Choose a site…</option>
                  {otherSites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">Loads its settings here. Nothing is saved until you click Save.</p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Share2 className="w-4 h-4" /> Apply to my other sites
                </Label>
                <div className="space-y-1">
                  {otherSites.map(s => (
                    <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={applyTargets.includes(s.id)}
                        onChange={(e) => setApplyTargets(prev =>
                          e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id))}
                      />
                      {s.name}
                      {s.kind === 'org' && <span className="text-xs text-muted-foreground">(organization)</span>}
                    </label>
                  ))}
                </div>
                <ConfirmationDialog
                  title="Apply theme to other sites?"
                  description={`This replaces the preset, navigation, reading progress bar and custom CSS of ${applyTargets.length} site${applyTargets.length === 1 ? '' : 's'} with the saved theme of ${site.name}.`}
                  confirmText="Apply"
                  onConfirm={handleApply}
                  trigger={
                    <Button variant="outline" disabled={applyTargets.length === 0 || isDirty}>
                      Apply saved theme
                    </Button>
                  }
                />
                {isDirty && applyTargets.length > 0 && (
                  <p className="text-xs text-muted-foreground">Save your changes first; the saved theme is what gets copied.</p>
                )}
              </div>
            </section>
          )}
        </div>

        {/* ---------------- Live preview ---------------- */}
        <ThemePreview settings={settings} targets={previewTargets} allowedUrlPrefixes={allowedUrlPrefixes} />
      </div>

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

function ThemePreview({
  settings,
  targets,
  allowedUrlPrefixes,
}: {
  settings: ThemeSettingsInput
  targets: ThemeEditorData['previewTargets']
  allowedUrlPrefixes: string[]
}) {
  const [path, setPath] = useState(targets[0]?.path ?? '')
  const [reloadKey, setReloadKey] = useState(0)
  const [scale, setScale] = useState(0.5)
  const containerRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Same sanitizer as the server; relative file names can't be resolved
  // client-side, so they show only after saving.
  const previewState = useMemo<ThemePreviewState>(() => ({
    preset: settings.preset,
    sidebarBehavior: settings.sidebarBehavior,
    showReadingProgress: settings.showReadingProgress,
    customCss: sanitizeCustomCss(settings.customCss, { allowedUrlPrefixes }).css,
  }), [settings, allowedUrlPrefixes])

  const stateRef = useRef(previewState)
  const post = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: THEME_PREVIEW_MESSAGE, theme: stateRef.current },
      window.location.origin,
    )
  }, [])

  useEffect(() => {
    stateRef.current = previewState
    post()
  }, [previewState, post])

  // The page asks for the state whenever a document loads in the iframe.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      if (e.source !== iframeRef.current?.contentWindow) return
      if (e.data?.type === THEME_PREVIEW_READY) post()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [post])

  // Render the page at desktop width and scale it to the column.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / PREVIEW_WIDTH)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="space-y-2 xl:sticky xl:top-4 self-start min-w-0">
      <div className="flex items-center gap-2">
        <Label htmlFor="previewPage" className="text-sm font-medium shrink-0">Preview</Label>
        <select
          id="previewPage"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          {targets.map(t => <option key={t.path} value={t.path}>{t.label}</option>)}
        </select>
        <Button variant="outline" size="sm" onClick={() => setReloadKey(k => k + 1)} title="Reload preview">
          <RotateCw className="w-4 h-4" />
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={path} target="_blank" rel="noreferrer" title="Open the published page in a new tab (saved theme)">
            <ExternalLink className="w-4 h-4" />
          </a>
        </Button>
      </div>
      <div
        ref={containerRef}
        className="relative h-[calc(100vh-9rem)] min-h-[420px] overflow-hidden rounded-lg border border-border bg-muted"
      >
        {path && (
          <iframe
            key={`${path}-${reloadKey}`}
            ref={iframeRef}
            src={path}
            title="Theme preview"
            className="absolute left-0 top-0 border-0 bg-background"
            style={{
              width: PREVIEW_WIDTH,
              height: `${100 / scale}%`,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Shows unsaved changes. Students see them after you save.
      </p>
    </div>
  )
}
