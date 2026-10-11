'use client'

import { useEffect, useState } from 'react'
import { parseThemePreset, parseBodyFont, type ThemePreset, type BodyFont } from '@/lib/settings'

/**
 * Live preview channel between the dashboard theme editor
 * (src/components/dashboard/theme-editor.tsx) and a public page rendered in
 * its <iframe>.
 *
 * The editor loads a real public page of the site (same origin) and posts the
 * UNSAVED settings; PublicSiteLayout swaps them in for the server-rendered
 * ones. Nothing is persisted and the server render is untouched, so ISR
 * caching is unaffected.
 *
 * Trust: messages are only accepted from the parent window on the same
 * origin. A same-origin parent can already script the iframe's DOM directly,
 * so this grants it nothing new. The editor sanitizes the CSS before sending
 * (same sanitizer as the server).
 *
 * Known limitation: on routes whose server render omits the full sidebar data
 * in contextual mode (the eduskript.org org-path routes), previewing "full"
 * navigation only shows what that page already has (the current skript).
 */

export const THEME_PREVIEW_MESSAGE = 'eduskript:theme-preview'
export const THEME_PREVIEW_READY = 'eduskript:theme-preview-ready'

export interface ThemePreviewState {
  preset: ThemePreset
  bodyFont: BodyFont | null
  showReadingProgress: boolean
  customCss: string
  sidebarBehavior: 'full' | 'contextual'
}

function parseState(value: unknown): ThemePreviewState | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  return {
    preset: parseThemePreset(v.preset),
    bodyFont: parseBodyFont(v.bodyFont),
    showReadingProgress: v.showReadingProgress !== false,
    customCss: typeof v.customCss === 'string' ? v.customCss : '',
    sidebarBehavior: v.sidebarBehavior === 'contextual' ? 'contextual' : 'full',
  }
}

/** Unsaved theme posted by the editor, or null outside the preview iframe. */
export function useThemePreviewOverride(): ThemePreviewState | null {
  const [state, setState] = useState<ThemePreviewState | null>(null)

  useEffect(() => {
    if (window.parent === window) return
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return
      if (e.data?.type !== THEME_PREVIEW_MESSAGE) return
      const next = parseState(e.data.theme)
      if (next) setState(next)
    }
    window.addEventListener('message', onMessage)
    // Ask for the current state: covers the first load and full-page
    // navigations inside the iframe (a fresh document starts empty).
    window.parent.postMessage({ type: THEME_PREVIEW_READY }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return state
}
