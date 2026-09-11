'use client'

/**
 * <banner> — a slim announcement bar at the top edge of the page.
 *
 *   <banner>New: [Atlas](https://atlas.eduskript.org) maps every public skript.</banner>
 *   <banner id="atlas" dismissible="false">…</banner>
 *
 * Per-page, not site-wide: it lives in the page's markdown like any other
 * component. Layout is CSS (`.es-banner` in globals.css): position sticky so
 * it stays at the top of the scroll container while the page scrolls under
 * it, and negative margins that pull it flush with the paper's edges when it
 * is the first element on the page. Placed further down it still sticks from
 * that point on. Children are re-parsed as markdown (rehypeMarkdownChildren),
 * so inline links, bold etc. work.
 *
 * Dismissal is remembered per browser in localStorage, keyed by `id` or, when
 * absent, by the text content — so changing the wording re-shows the banner.
 * Read via useSyncExternalStore with a server snapshot of "not dismissed":
 * the bar is in the server HTML and hidden right after hydration, so on
 * cached pages a dismissed banner is briefly visible before React loads.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { X } from 'lucide-react'

interface PageBannerProps {
  id?: string
  /** Any value except "false" shows the close button (default: shown). */
  dismissible?: string | boolean
  children?: React.ReactNode
  className?: string
  // Editor preview cursor-sync + section attrs survive component substitution.
  'data-source-line-start'?: string
  'data-source-line-end'?: string
  'data-section-id'?: string
}

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

export function PageBanner({ id, dismissible, children, className, ...dataAttrs }: PageBannerProps) {
  const canDismiss = dismissible !== 'false' && dismissible !== false
  const storageKey = STORAGE_PREFIX + (id || hashText(extractText(children)))
  const getSnapshot = useCallback(
    () => canDismiss && (sessionDismissed.has(storageKey) || readDismissed(storageKey)),
    [canDismiss, storageKey],
  )
  const hidden = useSyncExternalStore(subscribe, getSnapshot, () => false)

  if (hidden) return null

  const dismiss = () => writeDismissed(storageKey)

  return (
    <div
      className={className ? `es-banner ${className}` : 'es-banner'}
      role="note"
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
