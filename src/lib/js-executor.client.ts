/**
 * JavaScript Executor — Client-side ONLY JS execution in a Web Worker.
 *
 * This file should NEVER be imported on the server side.
 * All imports must be dynamic and wrapped in client-only code.
 *
 * Why a Worker (vs. main-thread eval like our Python runtimes):
 * - A bad `while(true)` would freeze the page; the Worker can be terminated.
 * - Globals don't leak between runs because the Worker is one-shot.
 * Trade-off: no DOM/canvas access. Acceptable for an intro-JS editor.
 */

'use client'

export type JsLogLevel = 'output' | 'warn' | 'error'

export interface ExecuteJavaScriptOptions {
  onOutput?: (level: JsLogLevel, text: string) => void
  onError?: (message: string) => void
  signal?: AbortSignal
}

export interface JsExecutionResult {
  success: boolean
  error?: string
  executionTime?: number
  stopped?: boolean
}

// Worker bootstrap. Stringified verbatim and shipped via Blob URL so we don't
// need a separate worker entry file (keeps Next/Turbopack happy).
const WORKER_SOURCE = `
function format(value) {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  const t = typeof value
  if (t === 'string') return value
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value)
  if (t === 'function') return value.toString()
  if (t === 'symbol') return value.toString()
  // Fresh per call — sharing across calls would falsely flag re-logged values as circular.
  const seen = new WeakSet()
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]'
        seen.add(v)
      }
      if (typeof v === 'bigint') return v.toString() + 'n'
      if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']'
      return v
    }, 2)
  } catch {
    try { return String(value) } catch { return '[Unserializable]' }
  }
}

function emit(level, args) {
  const text = args.map(format).join(' ')
  self.postMessage({ type: 'log', level, text })
}

self.console = {
  log: (...a) => emit('output', a),
  info: (...a) => emit('output', a),
  debug: (...a) => emit('output', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a),
}

self.addEventListener('unhandledrejection', (e) => {
  const r = e.reason
  const msg = r && r.stack ? r.stack : (r && r.message ? r.message : String(r))
  self.postMessage({ type: 'error', message: msg })
})
self.addEventListener('error', (e) => {
  self.postMessage({ type: 'error', message: e.message + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : '') })
})

self.onmessage = async (e) => {
  const { code } = e.data
  try {
    // Wrap in an async IIFE so users can use top-level await.
    // eslint-disable-next-line no-new-func
    const runner = new Function('return (async () => {\\n' + code + '\\n})()')
    await runner()
    self.postMessage({ type: 'done' })
  } catch (err) {
    const msg = err && err.stack ? err.stack : (err && err.message ? err.message : String(err))
    self.postMessage({ type: 'error', message: msg })
    self.postMessage({ type: 'done' })
  }
}
`

let workerUrl: string | null = null

function getWorkerUrl(): string {
  if (workerUrl) return workerUrl
  const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' })
  workerUrl = URL.createObjectURL(blob)
  return workerUrl
}

/**
 * Run user JavaScript in a fresh Worker. Resolves once the Worker reports done
 * or the signal aborts. The Worker is always terminated before resolving.
 */
export function executeJavaScript(
  code: string,
  options: ExecuteJavaScriptOptions = {}
): Promise<JsExecutionResult> {
  const { onOutput, onError, signal } = options
  const startTime = performance.now()

  return new Promise<JsExecutionResult>((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(getWorkerUrl())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      resolve({ success: false, error: message, executionTime: performance.now() - startTime })
      return
    }

    let firstError: string | null = null
    let settled = false

    const cleanup = () => {
      worker.terminate()
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve({
        success: false,
        stopped: true,
        executionTime: performance.now() - startTime,
      })
    }

    if (signal) {
      if (signal.aborted) {
        worker.terminate()
        resolve({ success: false, stopped: true, executionTime: performance.now() - startTime })
        return
      }
      signal.addEventListener('abort', onAbort)
    }

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { type: 'log'; level: JsLogLevel; text: string }
        | { type: 'error'; message: string }
        | { type: 'done' }

      if (msg.type === 'log') {
        onOutput?.(msg.level, msg.text)
      } else if (msg.type === 'error') {
        if (!firstError) firstError = msg.message
        onError?.(msg.message)
      } else if (msg.type === 'done') {
        if (settled) return
        settled = true
        cleanup()
        resolve({
          success: !firstError,
          error: firstError ?? undefined,
          executionTime: performance.now() - startTime,
        })
      }
    }

    worker.onerror = (e) => {
      if (settled) return
      settled = true
      const message = e.message || 'Worker error'
      cleanup()
      resolve({
        success: false,
        error: message,
        executionTime: performance.now() - startTime,
      })
    }

    worker.postMessage({ code })
  })
}
