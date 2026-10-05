/**
 * Debug-style Namespaced Logging System
 *
 * Inspired by the `debug` npm package pattern used by Express, Socket.io, etc.
 * Provides zero-overhead logging that can be enabled per-subsystem at runtime.
 *
 * Usage:
 *   import { createLogger } from '@/lib/logger'
 *   const log = createLogger('annotations:layer')
 *   log('Canvas update', { viewMode, dataLength: 123 })
 *
 * Enable logging:
 *   Browser: localStorage.setItem('debug', 'annotations:*')
 *   Server:  DEBUG=annotations:* (env var in config/deploy.yml)
 *
 * Patterns:
 *   'annotations:*'           - All annotation logs
 *   '*'                       - Everything (verbose!)
 *   'annotations:layer,userdata:sync' - Specific namespaces
 */

export interface Logger {
  (message: string, ...args: unknown[]): void
  debug: (message: string, ...args: unknown[]) => void
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
  enabled: boolean
}

// Pattern cache for performance - avoid re-parsing on every log call
let enabledPatterns: RegExp[] = []
let lastPatternString = ''

/**
 * Parse the debug pattern string and update the cached regex patterns.
 * Called on each log to support runtime changes (especially useful for localStorage).
 */
function updatePatterns(): void {
  const patternString = typeof window !== 'undefined' && typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function'
    ? localStorage.getItem('debug') ?? ''
    : process.env.DEBUG ?? ''

  // Skip re-parsing if pattern hasn't changed
  if (patternString === lastPatternString) return
  lastPatternString = patternString

  enabledPatterns = patternString
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      // Convert glob-style wildcards to regex
      // 'annotations:*' -> /^annotations:.*$/
      const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      const regex = escaped.replace(/\*/g, '.*')
      return new RegExp('^' + regex + '$')
    })
}

/**
 * Check if a namespace is enabled for logging.
 */
function isEnabled(namespace: string): boolean {
  updatePatterns()
  return enabledPatterns.some(re => re.test(namespace))
}

// Color palette for different subsystems
const colors = [
  '#e6194b', // red
  '#3cb44b', // green
  '#4363d8', // blue
  '#f58231', // orange
  '#911eb4', // purple
  '#46f0f0', // cyan
  '#f032e6', // magenta
  '#bcf60c', // lime
  '#fabebe', // pink
  '#008080', // teal
]
const colorMap = new Map<string, string>()

/**
 * Get a consistent color for a namespace.
 * Same base namespace (e.g., 'annotations' in 'annotations:layer') gets same color.
 */
function getColor(namespace: string): string {
  const base = namespace.split(':')[0]
  if (!colorMap.has(base)) {
    colorMap.set(base, colors[colorMap.size % colors.length])
  }
  return colorMap.get(base)!
}

/**
 * Create a namespaced logger.
 *
 * @param namespace - The namespace for this logger (e.g., 'annotations:layer')
 * @returns A logger function with .debug, .info, .warn, .error methods
 */
export function createLogger(namespace: string): Logger {
  const color = getColor(namespace)

  // Main log function (same as debug level)
  const log = (message: string, ...args: unknown[]) => {
    if (!isEnabled(namespace)) return

    if (typeof window !== 'undefined') {
      // Browser: use colored output
      console.log(`%c[${namespace}]`, `color: ${color}; font-weight: bold`, message, ...args)
    } else {
      // Server: plain text (container logs: bin/kamal app logs)
      console.log(`[${namespace}]`, message, ...args)
    }
  }

  // Alias for debug level
  log.debug = log

  // Info level - same behavior as debug
  log.info = (message: string, ...args: unknown[]) => {
    if (!isEnabled(namespace)) return

    if (typeof window !== 'undefined') {
      console.info(`%c[${namespace}]`, `color: ${color}; font-weight: bold`, message, ...args)
    } else {
      console.info(`[${namespace}]`, message, ...args)
    }
  }

  // Warn level - shows if namespace is enabled
  log.warn = (message: string, ...args: unknown[]) => {
    if (!isEnabled(namespace)) return
    console.warn(`[${namespace}]`, message, ...args)
  }

  // Error level - ALWAYS shows regardless of debug setting
  // Errors are too important to hide
  log.error = (message: string, ...args: unknown[]) => {
    console.error(`[${namespace}]`, message, ...args)
  }

  // Dynamic property to check if logging is enabled
  Object.defineProperty(log, 'enabled', {
    get: () => isEnabled(namespace),
    enumerable: true,
  })

  return log as unknown as Logger
}

/**
 * Helper to enable debug logging from browser console.
 * Usage: enableDebug('annotations:*')
 */
export function enableDebug(pattern: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('debug', pattern)
    console.log(`Debug logging enabled for: ${pattern}`)
    console.log('Refresh the page to see logs.')
  }
}

/**
 * Helper to disable all debug logging.
 */
export function disableDebug(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('debug')
    console.log('Debug logging disabled.')
  }
}

// Export helpers to window for easy console access
if (typeof window !== 'undefined') {
  // @ts-expect-error - Adding to window for debugging
  window.enableDebug = enableDebug
  // @ts-expect-error - Adding to window for debugging
  window.disableDebug = disableDebug
}
