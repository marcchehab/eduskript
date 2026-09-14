'use client'

/**
 * <banner> — a slim announcement bar at the top edge of the page.
 *
 *   <banner>New: [Atlas](https://atlas.eduskript.org) maps every public skript.</banner>
 *   <banner id="atlas" dismissible="false">…</banner>
 *   <banner color="#2563eb" text="white">…</banner>
 *   <banner color="orange" text="text">…</banner>  (palette names → theme vars;
 *                                                   text = normal text color)
 *
 * Per-page, not site-wide: it lives in the page's markdown like any other
 * component. Layout is CSS (`.es-banner` in globals.css): a static block that
 * scrolls with the page; as the first element it sits in the paper's top
 * margin. Children are re-parsed as markdown (rehypeMarkdownChildren), so
 * inline links, bold etc. work.
 *
 * Dismissal is remembered per browser in localStorage, keyed by `id` or, when
 * absent, by the text content — so changing the wording re-shows the banner.
 * The bar is in the server HTML. To keep a dismissed banner from flashing
 * before hydration, a pre-paint script in root-shell.tsx reads the
 * `es-banner-dismissed:*` keys and injects `display:none` rules matching
 * `data-banner-key`; after hydration useSyncExternalStore unmounts it.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { X } from 'lucide-react'
import { resolveHighlightColor, resolveTextColor } from '@/lib/color-palette'

interface PageBannerProps {
  id?: string
  /** Any value except "false" shows the close button (default: shown). */
  dismissible?: string | boolean
  /**
   * Background: a highlight palette name (paper/muted = theme surfaces;
   * yellow/green/blue/pink/orange/red/purple = the same tints as text
   * highlights; all → --es-bg-*) or any CSS color. Default: orange, see
   * .es-banner in globals.css.
   */
  color?: string
  /**
   * Text + link color: a text palette name (text/red/blue/green/… →
   * --es-color-*; `text` is the page's normal text color) or any CSS color.
   * Default: white.
   */
  text?: string
  children?: React.ReactNode
  className?: string
  // Editor preview cursor-sync + section attrs survive component substitution.
  'data-source-line-start'?: string
  'data-source-line-end'?: string
  'data-section-id'?: string
}

// Keep in sync with the banner bootstrap script in root-shell.tsx.
const STORAGE_PREFIX = 'es-banner-dismissed:'

function extractText(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as { props?: { children?: unknown } }).props?.children)
  }
  return ''
}

// Same hash as markdown-components.tsx hashCode: cheap, collision-tolerant
// (a collision only means two banners share a dismiss state).
function hashText(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

// In-tab change notification: `storage` events only fire in OTHER tabs.
const listeners = new Set<() => void>()
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}
function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false // Storage blocked (private mode, etc.): banner stays visible.
  }
}
function writeDismissed(key: string): void {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // Not remembered across reloads; the in-memory fallback below still hides it now.
    sessionDismissed.add(key)
  }
  listeners.forEach((l) => l())
}
const sessionDismissed = new Set<string>()

export function PageBanner({ id, dismissible, color, text, children, className, ...dataAttrs }: PageBannerProps) {
  const canDismiss = dismissible !== 'false' && dismissible !== false
  const bannerKey = id || hashText(extractText(children))
  const storageKey = STORAGE_PREFIX + bannerKey
  const getSnapshot = useCallback(
    () => canDismiss && (sessionDismissed.has(storageKey) || readDismissed(storageKey)),
    [canDismiss, storageKey],
  )
  const hidden = useSyncExternalStore(subscribe, getSnapshot, () => false)

  if (hidden) return null

  const dismiss = () => writeDismissed(storageKey)

  // Inline styles beat the .es-banner defaults; links inherit via currentColor.
  // Palette names resolve to the same theme vars rehypeColorClasses uses —
  // that plugin runs before React and never sees these props, so map here.
  const style: React.CSSProperties = {}
  if (color) {
    const name = resolveHighlightColor(color)
    if (name) {
      // Highlight tints are translucent (rgba, alpha ≈ 0.3): as a sticky bar
      // the page would show through. Composite the tint over the paper color.
      style.backgroundColor = 'var(--es-bg-paper)'
      style.backgroundImage = `linear-gradient(var(--es-bg-${name}), var(--es-bg-${name}))`
    } else {
      style.backgroundColor = color
    }
  }
  if (text) {
    const name = resolveTextColor(text)
    style.color = name ? `var(--es-color-${name})` : text
  }

  return (
    <div
      className={className ? `es-banner ${className}` : 'es-banner'}
      role="note"
      style={style}
      data-banner-key={canDismiss ? bannerKey : undefined}
      {...dataAttrs}
    >
      <div className="es-banner-content">{children}</div>
      {canDismiss && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="es-banner-close"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
