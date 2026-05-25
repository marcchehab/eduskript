'use client'

import { useSyncExternalStore } from 'react'

// UA sniff for Safe Exam Browser (SEB 2.x/3.x add "SEB/" or "SafeExamBrowser").
// Mirrors the server-side check in lib/seb.ts (isSEBRequest). Client-only:
// getServerSnapshot returns false so SSR/first paint assumes "not in SEB".
const subscribe = () => () => {}
const getSnapshot = () =>
  typeof navigator !== 'undefined' &&
  (navigator.userAgent.includes('SEB/') || navigator.userAgent.includes('SafeExamBrowser'))
const getServerSnapshot = () => false

/** True when the page is running inside Safe Exam Browser. */
export function useIsInSEB(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
