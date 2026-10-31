'use client'

/**
 * Real-Time Events Hook
 *
 * Provides a React hook for subscribing to Server-Sent Events.
 * Uses a SINGLETON EventSource connection shared across all hook instances.
 * This prevents multiple SSE connections and orphaned server handlers.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useSession } from 'next-auth/react'
import { useExamSession } from '@/contexts/exam-session-context'
import type { AppEvent } from '@/lib/events/types'

type EventType = AppEvent['type']
type EventHandler = (event: AppEvent) => void
type ConnectionListener = () => void

// Singleton EventSource manager
class SSEManager {
  private eventSource: EventSource | null = null
  private handlers = new Set<EventHandler>()
  private connectionListeners = new Set<ConnectionListener>()
  private isConnecting = false
  private connectionPromise: Promise<void> | null = null

  connect(): Promise<void> {
    if (this.eventSource?.readyState === EventSource.OPEN) {
      return Promise.resolve()
    }

    if (this.connectionPromise) {
      return this.connectionPromise
    }

    if (this.isConnecting) {
      return Promise.resolve()
    }

    this.isConnecting = true
    this.connectionPromise = new Promise((resolve) => {
      this.eventSource = new EventSource('/api/events/stream')

      this.eventSource.onopen = () => {
        this.isConnecting = false
        this.connectionPromise = null
        this.notifyConnectionListeners()
        resolve()
      }

      this.eventSource.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as AppEvent

          // Skip connection confirmation
          if ((event as { type: string }).type === 'connected') {
            return
          }

          // Notify all handlers
          this.handlers.forEach(handler => {
            try {
              handler(event)
            } catch (err) {
              console.error('[SSEManager] Handler error:', err)
            }
          })
        } catch (err) {
          console.error('[SSEManager] Parse error:', err)
        }
      }

      this.eventSource.onerror = () => {
        this.isConnecting = false
        this.connectionPromise = null
        this.notifyConnectionListeners()
        // EventSource auto-reconnects
      }
    })

    return this.connectionPromise
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler)

    // Ensure connected
    this.connect()

    return () => {
      this.handlers.delete(handler)

      // Close connection if no more handlers
      if (this.handlers.size === 0 && this.eventSource) {
        this.eventSource.close()
        this.eventSource = null
        // Closed before onopen: without this reset, the next connect() returns
        // the pending promise and never opens a new EventSource.
        this.isConnecting = false
        this.connectionPromise = null
        this.notifyConnectionListeners()
      }
    }
  }

  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN
  }

  // For useSyncExternalStore
  subscribeToConnection(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener)
    return () => {
      this.connectionListeners.delete(listener)
    }
  }

  private notifyConnectionListeners(): void {
    this.connectionListeners.forEach(listener => listener())
  }

  getSnapshot(): boolean {
    return this.isConnected()
  }
}

// Global singleton instance
let sseManager: SSEManager | null = null

function getSSEManager(): SSEManager {
  if (!sseManager) {
    sseManager = new SSEManager()
  }
  return sseManager
}

// For SSR
function getServerSnapshot(): boolean {
  return false
}

interface UseRealtimeEventsOptions {
  enabled?: boolean
  onConnect?: () => void
  onDisconnect?: () => void
  onError?: (error: Event) => void
}

/**
 * Check if we're running through ngrok tunnel
 *
 * WORKAROUND: ngrok's TLS certificate handling causes "PR_END_OF_FILE_ERROR"
 * in Safe Exam Browser (SEB) on iPad when the page is refreshed while an SSE
 * connection is active. The initial page load works, but refresh fails.
 *
 * This appears to be an incompatibility between:
 * - ngrok's TLS certificate (possibly certificate renegotiation)
 * - SEB's embedded WebKit browser on iOS
 * - Long-running SSE connections
 *
 * We detect ngrok by checking for "ngrok" in the hostname and disable SSE
 * for exam sessions in this case. This means live teacher broadcasts won't
 * work during local development with ngrok, but the exam will still function
 * (students just need to refresh to see teacher annotations).
 *
 * In production with a real SSL certificate, SSE works normally.
 */
function isNgrokEnvironment(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.hostname.includes('ngrok')
}

/**
 * Subscribe to real-time events from the server
 * Uses a singleton EventSource connection shared across all components
 */
export function useRealtimeEvents<T extends EventType>(
  eventTypes: T[],
  onEvent: (event: Extract<AppEvent, { type: T }>) => void,
  options: UseRealtimeEventsOptions = {}
) {
  const { enabled = true } = options
  const { status } = useSession()
  const examSession = useExamSession()

  // Consider authenticated if either NextAuth session OR exam session is active
  // However, disable SSE for exam sessions when running through ngrok
  // (ngrok's TLS handling causes errors in SEB's embedded browser on refresh)
  const isExamSessionAuth = examSession.isInExamSession && !isNgrokEnvironment()
  const isAuthenticated = status === 'authenticated' || isExamSessionAuth

  // Use ref to always have latest callback without re-subscribing
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  })

  // Stable event types key
  const eventTypesKey = eventTypes.join(',')

  // Track connection state using useSyncExternalStore (avoids setState in effect)
  const manager = typeof window !== 'undefined' ? getSSEManager() : null
  const isConnected = useSyncExternalStore(
    manager?.subscribeToConnection.bind(manager) ?? (() => () => {}),
    manager?.getSnapshot.bind(manager) ?? (() => false),
    getServerSnapshot
  )

  useEffect(() => {
    if (!enabled || !isAuthenticated || typeof window === 'undefined') {
      return
    }

    const mgr = getSSEManager()

    const handler: EventHandler = (event) => {
      const types = eventTypesKey.split(',')
      if (types.includes(event.type)) {
        onEventRef.current(event as Extract<AppEvent, { type: T }>)
      }
    }

    const unsubscribe = mgr.subscribe(handler)

    return () => {
      unsubscribe()
    }
  }, [enabled, isAuthenticated, eventTypesKey])

  return { isConnected }
}

/**
 * Hook to track SSE connection state
 */
export function useRealtimeConnection() {
  const { status } = useSession()
  const examSession = useExamSession()

  // Consider authenticated if either NextAuth session OR exam session is active
  const isAuthenticated = status === 'authenticated' || examSession.isInExamSession

  const { isConnected } = useRealtimeEvents(
    [],
    () => {},
    { enabled: isAuthenticated }
  )

  return { isConnected, error: null }
}
