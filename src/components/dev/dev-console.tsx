'use client'

import { useEffect, useRef } from 'react'

// Generate a short unique ID for this browser tab
function getClientId(): string {
  // Check sessionStorage first (persists across page reloads within same tab)
  let clientId = sessionStorage.getItem('dev-console-client-id')
  if (!clientId) {
    // Generate a short 4-char ID for readability
    clientId = Math.random().toString(36).substring(2, 6).toUpperCase()
    sessionStorage.setItem('dev-console-client-id', clientId)
  }
  return clientId
}

interface LogEntry {
  level: string
  args: unknown[]
  timestamp: number
  clientId: string
}

// Intercept browser console and forward to server in development
// Uses batching to reduce network requests (flushes every 500ms or at 20 entries)
export function DevConsole() {
  const batchRef = useRef<LogEntry[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushingRef = useRef(false)

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return

    const clientId = getClientId()

    const originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console),
    }

    const flushBatch = async () => {
      if (flushingRef.current || batchRef.current.length === 0) return
      flushingRef.current = true

      const entries = batchRef.current
      batchRef.current = []

      try {
        await fetch('/api/dev/console', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch: entries }),
        })
      } catch {
        // Silently fail - don't create infinite loops
      } finally {
        flushingRef.current = false
      }
    }

    const scheduleFlush = () => {
      if (timerRef.current) return
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        flushBatch()
      }, 500)
    }

    const addToBatch = (level: string, args: unknown[]) => {
      // Serialize arguments safely
      const serializedArgs = args.map(arg => {
        if (arg instanceof Error) {
          return { __error: true, message: arg.message, stack: arg.stack }
        }
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.parse(JSON.stringify(arg))
          } catch {
            return String(arg)
          }
        }
        return arg
      })

      batchRef.current.push({
        level,
        args: serializedArgs,
        timestamp: Date.now(),
        clientId,
      })

      // Flush immediately if batch is large
      if (batchRef.current.length >= 20) {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        flushBatch()
      } else {
        scheduleFlush()
      }
    }

    // Override console methods
    console.log = (...args) => {
      originalConsole.log(...args)
      addToBatch('log', args)
    }

    console.warn = (...args) => {
      originalConsole.warn(...args)
      addToBatch('warn', args)
    }

    console.error = (...args) => {
      originalConsole.error(...args)
      addToBatch('error', args)
    }

    console.info = (...args) => {
      originalConsole.info(...args)
      addToBatch('info', args)
    }

    // Capture unhandled errors
    const handleError = (event: ErrorEvent) => {
      addToBatch('error', [`Unhandled error: ${event.message}`, event.filename, event.lineno])
    }

    const handleRejection = (event: PromiseRejectionEvent) => {
      addToBatch('error', ['Unhandled promise rejection:', event.reason])
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)

    // Cleanup
    return () => {
      console.log = originalConsole.log
      console.warn = originalConsole.warn
      console.error = originalConsole.error
      console.info = originalConsole.info
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      // Flush remaining entries on unmount
      if (batchRef.current.length > 0) {
        flushBatch()
      }
    }
  }, [])

  return null // This component doesn't render anything
}
