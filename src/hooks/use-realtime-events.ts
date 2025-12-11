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
    if (!enabled || status !== 'authenticated' || typeof window === 'undefined') {
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
  }, [enabled, status, eventTypesKey])

  return { isConnected }
}

/**
 * Hook to track SSE connection state
 */
export function useRealtimeConnection() {
  const { status } = useSession()

  const { isConnected } = useRealtimeEvents(
    [],
    () => {},
    { enabled: status === 'authenticated' }
  )

  return { isConnected, error: null }
}
