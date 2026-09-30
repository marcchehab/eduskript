'use client'

/**
 * Page-wide sound switch. Components that make sound (Kara voices, effects,
 * music) register while mounted, so the toolbar only shows the mute button on
 * pages that actually play something. Mute is a per-browser preference.
 */

import { useSyncExternalStore } from 'react'

const KEY = 'eduskript-muted'
let muted = false
let sources = 0
const listeners = new Set<() => void>()
try { muted = localStorage.getItem(KEY) === '1' } catch { /* SSR or storage blocked */ }

const emit = () => listeners.forEach(l => l())
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function isMuted(): boolean { return muted }

export function setMuted(value: boolean) {
  muted = value
  try { localStorage.setItem(KEY, value ? '1' : '0') } catch { /* storage blocked */ }
  emit()
}

/** Call while mounted; returns the unregister function. */
export function registerSoundSource(): () => void {
  sources++; emit()
  return () => { sources--; emit() }
}

export function useMuted(): boolean {
  return useSyncExternalStore(subscribe, () => muted, () => false)
}

export function useHasSound(): boolean {
  return useSyncExternalStore(subscribe, () => sources > 0, () => false)
}

/** Subscribe outside React (e.g. to stop audio when muted). */
export function onMuteChange(l: () => void): () => void { return subscribe(l) }
