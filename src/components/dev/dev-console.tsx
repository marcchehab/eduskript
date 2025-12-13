'use client'

import { useEffect } from 'react'

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

// Intercept browser console and forward to server in development
export function DevConsole() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return

    const clientId = getClientId()

    const originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console),
    }

    const sendToServer = async (level: string, args: unknown[]) => {
      try {
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

        await fetch('/api/dev/console', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            level,
            args: serializedArgs,
            timestamp: Date.now(),
            clientId,
          }),
        })
      } catch {
        // Silently fail - don't create infinite loops
      }
    }

    // Override console methods
    console.log = (...args) => {
      originalConsole.log(...args)
      sendToServer('log', args)
    }

    console.warn = (...args) => {
      originalConsole.warn(...args)
      sendToServer('warn', args)
    }

    console.error = (...args) => {
      originalConsole.error(...args)
      sendToServer('error', args)
    }

    console.info = (...args) => {
      originalConsole.info(...args)
      sendToServer('info', args)
    }

    // Capture unhandled errors
    const handleError = (event: ErrorEvent) => {
      sendToServer('error', [`Unhandled error: ${event.message}`, event.filename, event.lineno])
    }

    const handleRejection = (event: PromiseRejectionEvent) => {
      sendToServer('error', ['Unhandled promise rejection:', event.reason])
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
    }
  }, [])

  return null // This component doesn't render anything
}
