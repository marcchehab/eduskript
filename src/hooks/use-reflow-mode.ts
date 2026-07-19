'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Reflow ("reading") mode: drop the annotation system + fixed 1280px paper and
 * let content reflow to viewport width with normal document scrolling.
 *
 * Resolution order (see resolveReflow):
 *  1. Explicit user choice in localStorage ('on' | 'off') — wins on every device.
 *  2. No stored choice → auto-on for phones, off for tablets/desktop.
 *
 * Phone detection uses the *short* edge (min of width/height) < 640px so it
 * holds in both portrait and landscape: a phone's short side is ≤ ~430px, a
 * tablet's is ≥ 768px. Plain viewport width fails — a phone in landscape is
 * ~900px and would read as a tablet.
 *
 * The effective state is mirrored onto <html class="reflow-mode"> (CSS in
 * globals.css neutralizes the paper geometry) and a pre-paint bootstrap script
 * in src/app/layout.tsx sets the same class before the first frame to avoid a
 * flash of the desktop paper on phones. Persistence + cross-component sync are
 * done via localStorage + a window CustomEvent, mirroring font-size-controls.
 */
const REFLOW_KEY = 'eduskript-reflow'
const REFLOW_EVENT = 'eduskript:reflow-change'
/** Short-edge (px) at/above which a device is treated as a tablet, not a phone. */
const PHONE_MAX_SHORT_EDGE = 640

function phoneByDefault(): boolean {
  if (typeof window === 'undefined') return false
  return Math.min(window.innerWidth, window.innerHeight) < PHONE_MAX_SHORT_EDGE
}

/** Effective reflow state: explicit stored pref wins, else phone-by-default. */
export function resolveReflow(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const stored = localStorage.getItem(REFLOW_KEY)
    if (stored === 'on') return true
    if (stored === 'off') return false
  } catch {
    // localStorage can throw in private mode / sandboxed frames — fall through.
  }
  return phoneByDefault()
}

function applyReflowClass(on: boolean) {
  document.documentElement.classList.toggle('reflow-mode', on)
}

export function useReflowMode() {
  const [mounted, setMounted] = useState(false)
  const [reflow, setReflow] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    const sync = () => {
      const on = resolveReflow()
      setReflow(on)
      applyReflowClass(on)
    }
    sync()
    window.addEventListener(REFLOW_EVENT, sync)
    // 'storage' fires in *other* tabs — keeps multiple open tabs consistent.
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(REFLOW_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [mounted])

  const toggle = useCallback(() => {
    const next = !resolveReflow()
    try {
      localStorage.setItem(REFLOW_KEY, next ? 'on' : 'off')
    } catch {
      // Ignore write failures; the class + in-tab state still update below.
    }
    applyReflowClass(next)
    window.dispatchEvent(new CustomEvent(REFLOW_EVENT))
  }, [])

  return { reflow, mounted, toggle }
}
