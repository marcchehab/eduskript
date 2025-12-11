'use client'

import { useEffect, useCallback, useSyncExternalStore } from 'react'
import { useSession } from 'next-auth/react'
import { useRealtimeEvents } from './use-realtime-events'

const CACHE_KEY = 'hasPendingInvitations'

// Module-level state to deduplicate requests across all hook instances
let globalHasPending = false
let globalListeners: Set<() => void> = new Set()
let pendingFetch: Promise<void> | null = null
let lastFetchTime = 0
const DEBOUNCE_MS = 2000 // Don't fetch more than once every 2 seconds

function subscribe(listener: () => void) {
  globalListeners.add(listener)
  return () => globalListeners.delete(listener)
}

function getSnapshot() {
  return globalHasPending
}

function notifyListeners() {
  globalListeners.forEach(listener => listener())
}

function setGlobalHasPending(value: boolean) {
  if (globalHasPending !== value) {
    globalHasPending = value
    sessionStorage.setItem(CACHE_KEY, String(value))
    notifyListeners()
  }
}

/**
 * Hook to check for pending class invitations (students only).
 *
 * Uses multiple strategies for updates:
 * - Initial fetch on mount (deduplicated across all hook instances)
 * - Real-time updates via SSE (Server-Sent Events)
 * - Re-fetch on tab visibility change (SSE may have dropped)
 * - SessionStorage caching during navigation
 */
export function usePendingInvitations() {
  const { data: session, status } = useSession()

  // Use useSyncExternalStore for shared state across all hook instances
  const hasPendingInvitations = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const isStudent = status === 'authenticated' && session?.user?.accountType === 'student'

  const checkPendingInvitations = useCallback(() => {
    if (!isStudent) return

    // Debounce: skip if we fetched recently
    const now = Date.now()
    if (now - lastFetchTime < DEBOUNCE_MS) return

    // Deduplicate: if a fetch is already in progress, don't start another
    if (pendingFetch) return

    lastFetchTime = now
    pendingFetch = fetch('/api/classes/my-classes?checkOnly=true')
      .then(res => res.json())
      .then(data => {
        setGlobalHasPending(!!data.hasPendingInvitations)
      })
      .catch(() => {
        setGlobalHasPending(false)
      })
      .finally(() => {
        pendingFetch = null
      })
  }, [isStudent])

  // Subscribe to real-time class invitation events via SSE
  useRealtimeEvents(
    ['class-invitation'],
    () => {
      // When we receive a class-invitation event, set to true immediately
      setGlobalHasPending(true)
    },
    { enabled: isStudent }
  )

  useEffect(() => {
    if (!isStudent) return

    // Detect page reload and clear cache
    const navEntries = performance.getEntriesByType('navigation')
    const isReload = navEntries.length > 0 &&
      (navEntries[0] as PerformanceNavigationTiming).type === 'reload'

    if (isReload) {
      sessionStorage.removeItem(CACHE_KEY)
      lastFetchTime = 0 // Reset debounce on reload
    }

    // Check sessionStorage cache first (unless cleared by reload)
    const cached = sessionStorage.getItem(CACHE_KEY)
    if (cached !== null) {
      setGlobalHasPending(cached === 'true')
    } else {
      checkPendingInvitations()
    }

    // Re-fetch when tab becomes visible (SSE connection may have dropped)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkPendingInvitations()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Listen for invitation status changes from other components (local events)
    const handleInvitationStatusChanged = (e: CustomEvent<{ hasPending: boolean }>) => {
      setGlobalHasPending(e.detail.hasPending)
    }
    window.addEventListener('invitationStatusChanged', handleInvitationStatusChanged as EventListener)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('invitationStatusChanged', handleInvitationStatusChanged as EventListener)
    }
  }, [isStudent, checkPendingInvitations])

  return hasPendingInvitations
}
