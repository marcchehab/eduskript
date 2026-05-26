'use client'

/**
 * Pyodide in a Web Worker.
 *
 * The main-thread Pyodide runtime froze the page on any tight Python loop
 * (a `while True:` from a student) — unrecoverable inside SEB. This module
 * runs Pyodide inside a Worker so:
 *
 *  - A runaway loop never touches the main thread; the UI stays responsive.
 *  - Stop (or a hard timeout) calls `worker.terminate()` — kills runaway code
 *    even when it's inside a C call (settrace couldn't reach those).
 *  - Next call respawns the worker lazily.
 *
 * Singleton: one shared worker across all editors + the grader, mirroring the
 * pre-Worker `window.__pyodidePromise` sharing. Concurrency is implicit-serial
 * (the editor's RunState gate + the grader's per-student loop both block on
 * the previous call).
 *
 * Trade-off: terminating throws away ~30 MB of loaded Pyodide; the next run
 * pays the cold-start cost (~3 s). That hits once per Stop press, which is
 * acceptable.
 */

import { parseAssertions, TURTLE_PRELUDE, type ParsedAssertion } from '@/components/public/code-editor/python-check-runner'
import type { PythonCheckResult, PythonFile } from '@/components/public/code-editor/types'

const PYODIDE_VERSION = 'v0.29.0'

// ─── Python source embedded into the worker ──────────────────────────────
// Kept verbatim from the previous main-thread implementation. JSON.stringify
// when interpolating into the worker source handles escaping cleanly.

const EDUSKRIPT_DISPLAY_HELPERS = `
import builtins as _b
import io as _io
_b._eduskript_shown = []  # list of PNG byte blobs, in call order

def _eduskript_png_from_pil(img):
    save_img = img if img.mode in ('RGB', 'RGBA', 'L', 'LA', 'P') else img.convert('RGBA')
    buf = _io.BytesIO()
    save_img.save(buf, format='PNG')
    return buf.getvalue()

def _eduskript_png_from_fig(fig):
    buf = _io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', dpi=100)
    return buf.getvalue()

def display(obj):
    """Show a PIL image in the editor canvas (in call order with matplotlib)."""
    try:
        from PIL.Image import Image as _PILImage
        if isinstance(obj, _PILImage):
            _b._eduskript_shown.append(_eduskript_png_from_pil(obj))
            return
    except ImportError:
        pass
    print(repr(obj))

_b.display = display

try:
    from PIL.Image import Image as _PILImage
    def _eduskript_pil_show(self, title=None, command=None):
        _b._eduskript_shown.append(_eduskript_png_from_pil(self))
    _PILImage.show = _eduskript_pil_show
except ImportError:
    pass

try:
    import matplotlib.pyplot as _plt
    def _eduskript_plt_show(*args, **kwargs):
        for _num in _plt.get_fignums():
            _fig = _plt.figure(_num)
            _b._eduskript_shown.append(_eduskript_png_from_fig(_fig))
            _plt.close(_fig)
    _plt.show = _eduskript_plt_show
except ImportError:
    pass
`

const MATPLOTLIB_BACKEND_CONFIG = `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.ioff()
plt.show = lambda: None
`

const PLOT_CAPTURE_SCRIPT = `
import sys
import io
import base64
import builtins as _b

plots = []

# 1) Anything the user explicitly displayed, in call order
shown = getattr(_b, '_eduskript_shown', [])
for png_bytes in shown:
    plots.append('data:image/png;base64,' + base64.b64encode(png_bytes).decode('UTF-8'))

# 2) Trailing matplotlib figures the user forgot to plt.show()
try:
    import matplotlib.pyplot as plt
    for _num in plt.get_fignums():
        _fig = plt.figure(_num)
        _buf = io.BytesIO()
        _fig.savefig(_buf, format='png', bbox_inches='tight', dpi=100)
        _buf.seek(0)
        plots.append('data:image/png;base64,' + base64.b64encode(_buf.read()).decode('UTF-8'))
        plt.close(_fig)
except ImportError:
    pass
except Exception as e:
    print(f"Error capturing trailing figures: {e}", file=sys.stderr)

# Reset for next run
_b._eduskript_shown = []

plots
`

const CHECK_HARNESS_TEMPLATE = `
import json
import re as __re

with open('__eduskript_labels.json') as f:
    __labels = json.load(f)

def __interp(s, ns):
    if not s or '{' not in s:
        return s
    try:
        return eval('f' + repr(s), ns)
    except Exception:
        return __re.sub(r'\\{[^{}]*\\}', '…', s)

__count = __COUNT__
__results = []
__ns = {}

import io as __io, contextlib as __cl
__stdout_buf = __io.StringIO()

with open('__eduskript_student.py') as f:
    __student_code = f.read()

with open('__eduskript_prelude.py') as f:
    __prelude_code = f.read()
if __prelude_code.strip():
    try:
        exec(compile(__prelude_code, '<turtle-prelude>', 'exec'), __ns)
    except Exception:
        pass

try:
    with __cl.redirect_stdout(__stdout_buf):
        exec(compile(__student_code, '<student>', 'exec'), __ns)
except Exception as __e:
    __err = str(__e)
    for __i in range(__count):
        __results.append({"index": __i, "passed": False, "label": __interp(__labels[__i]["fail"], __ns), "error": "Code error: " + __err})

__ns['output'] = __stdout_buf.getvalue()

if not __results:
    with open('__eduskript_setup.py') as f:
        __setup_code = f.read()
    if __setup_code.strip():
        try:
            exec(compile(__setup_code, '<setup>', 'exec'), __ns)
        except Exception:
            pass

    for __i in range(__count):
        with open(f'__eduskript_assert_{__i}.py') as f:
            __assert_code = f.read()
        try:
            exec(compile(__assert_code, '<check>', 'exec'), __ns)
            __results.append({"index": __i, "passed": True, "label": __interp(__labels[__i]["pass"], __ns), "error": None})
        except AssertionError:
            __err_msg = None
            __m = __re.match(r'assert\\s+(.+?)\\s*==\\s*(.+?)(?:\\s*,\\s*["\\']|$)', __assert_code.strip())
            if __m:
                try:
                    __actual = eval(__m.group(1), __ns)
                    __expected = eval(__m.group(2), __ns)
                    __err_msg = f"Expected {__expected!r}, got {__actual!r}"
                except Exception:
                    pass
            __results.append({"index": __i, "passed": False, "label": __interp(__labels[__i]["fail"], __ns), "error": __err_msg})
        except Exception as __e:
            __results.append({"index": __i, "passed": False, "label": __interp(__labels[__i]["fail"], __ns), "error": str(__e)})

json.dumps(__results)
`

// ─── Worker source ───────────────────────────────────────────────────────
// Built once at module init. JSON.stringify embeds Python strings safely.

const WORKER_SOURCE = `
importScripts('https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/pyodide.js')
const PYODIDE_INDEX = 'https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/'

const EDUSKRIPT_DISPLAY_HELPERS = ${JSON.stringify(EDUSKRIPT_DISPLAY_HELPERS)}
const MATPLOTLIB_BACKEND_CONFIG = ${JSON.stringify(MATPLOTLIB_BACKEND_CONFIG)}
const PLOT_CAPTURE_SCRIPT = ${JSON.stringify(PLOT_CAPTURE_SCRIPT)}
const TURTLE_PRELUDE = ${JSON.stringify(TURTLE_PRELUDE)}
const CHECK_HARNESS_TEMPLATE = ${JSON.stringify(CHECK_HARNESS_TEMPLATE)}

let pyodidePromise = null
function getPyodide() {
  if (pyodidePromise) return pyodidePromise
  pyodidePromise = (async () => {
    const py = await self.loadPyodide({ indexURL: PYODIDE_INDEX })
    return py
  })()
  return pyodidePromise
}

// Start loading at worker boot so creating the worker = preload of Pyodide.
// The first run message awaits the same promise.
getPyodide()

function safeResult(val) {
  if (val === undefined || val === null) return null
  const t = typeof val
  if (t === 'string' || t === 'number' || t === 'boolean') return val
  try { return String(val) } catch { return null }
}

self.onmessage = async (e) => {
  const msg = e.data
  const { type, id } = msg
  try {
    const py = await getPyodide()

    if (type === 'run') {
      // Per-call stdout/stderr → postMessage as the user code emits.
      py.setStdout({ batched: (text) => self.postMessage({ type: 'stdout', id, text }) })
      py.setStderr({ batched: (text) => self.postMessage({ type: 'stderr', id, text }) })

      // Packages
      if (msg.packages && msg.packages.length > 0) {
        try {
          await py.loadPackage(msg.packages, {
            messageCallback: () => {},
            errorCallback: (m) => self.postMessage({ type: 'stderr', id, text: m + '\\n' }),
          })
        } catch (err) {
          self.postMessage({ type: 'stderr', id, text: 'Warning: Failed to load some packages: ' + (err && err.message ? err.message : String(err)) + '\\n' })
        }
      }

      // Matplotlib backend (only if matplotlib was requested)
      if (msg.configMatplotlib) {
        await py.runPythonAsync(MATPLOTLIB_BACKEND_CONFIG)
      }

      // Eduskript display helpers (idempotent — must run AFTER matplotlib loads
      // so the plt.show monkey-patch takes effect).
      await py.runPythonAsync(EDUSKRIPT_DISPLAY_HELPERS)

      // Text aux files: write + bust the module cache so re-imports pick up edits.
      for (const f of msg.textFiles || []) {
        py.FS.writeFile(f.name, f.content)
        const moduleName = String(f.name).replace(/\\.py$/i, '')
        try {
          await py.runPythonAsync('import sys\\nif ' + JSON.stringify(moduleName) + ' in sys.modules: del sys.modules[' + JSON.stringify(moduleName) + ']')
        } catch {}
      }

      // Binary aux files (csv/db/png/etc.)
      for (const f of msg.binaryFiles || []) {
        py.FS.writeFile(f.name, f.bytes)
      }

      // Student code
      let result
      try {
        result = await py.runPythonAsync(msg.code)
      } catch (err) {
        self.postMessage({ type: 'error', id, message: err && err.message ? err.message : String(err) })
        return
      }

      // Plot capture — non-fatal if it fails.
      let plots = []
      try {
        const proxy = await py.runPythonAsync(PLOT_CAPTURE_SCRIPT)
        if (proxy && typeof proxy.toJs === 'function') {
          plots = proxy.toJs()
          try { proxy.destroy() } catch {}
        } else if (Array.isArray(proxy)) {
          plots = proxy
        }
      } catch {}

      self.postMessage({ type: 'result', id, result: safeResult(result), plots })
      return
    }

    if (type === 'check') {
      // Suppress output during checks — students don't see check stdout/stderr.
      py.setStdout({ batched: () => {} })
      py.setStderr({ batched: () => {} })

      const { studentCode, setupLines, assertions, auxFiles, usesTurtle } = msg

      // Aux files first + cache-bust.
      for (const f of auxFiles || []) {
        py.FS.writeFile(f.name, f.content)
        const moduleName = String(f.name).replace(/\\.py$/i, '')
        try {
          await py.runPythonAsync('import sys\\nif ' + JSON.stringify(moduleName) + ' in sys.modules: del sys.modules[' + JSON.stringify(moduleName) + ']')
        } catch {}
      }

      py.FS.writeFile('__eduskript_student.py', studentCode)
      py.FS.writeFile('__eduskript_setup.py', (setupLines || []).join('\\n'))
      py.FS.writeFile('__eduskript_prelude.py', usesTurtle ? TURTLE_PRELUDE : '')
      for (let i = 0; i < assertions.length; i++) {
        py.FS.writeFile('__eduskript_assert_' + i + '.py', assertions[i].line)
      }
      py.FS.writeFile(
        '__eduskript_labels.json',
        JSON.stringify(assertions.map((a) => ({ fail: a.failLabel, pass: a.passLabel }))),
      )

      const harness = CHECK_HARNESS_TEMPLATE.replace('__COUNT__', String(assertions.length))

      try {
        const resultJson = await py.runPythonAsync(harness)
        const results = JSON.parse(resultJson)
        self.postMessage({ type: 'check-result', id, results })
      } catch (err) {
        self.postMessage({
          type: 'check-result',
          id,
          results: assertions.map((a, i) => ({
            index: i, passed: false, label: a.failLabel,
            error: 'Check runner error: ' + (err && err.message ? err.message : String(err)),
          })),
        })
      } finally {
        const filesToRemove = [
          '__eduskript_student.py',
          '__eduskript_setup.py',
          '__eduskript_prelude.py',
          '__eduskript_labels.json',
          ...assertions.map((_, i) => '__eduskript_assert_' + i + '.py'),
        ]
        for (const f of filesToRemove) {
          try { py.FS.unlink(f) } catch {}
        }
      }
      return
    }

    self.postMessage({ type: 'error', id, message: 'Unknown message type: ' + type })
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err && err.message ? err.message : String(err) })
  }
}
`

// ─── Main-thread API ─────────────────────────────────────────────────────

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  onStdout?: (text: string) => void
  onStderr?: (text: string) => void
}

let worker: Worker | null = null
let workerUrl: string | null = null
let nextId = 0
const pending = new Map<number, Pending>()

/**
 * `loadStarted` flips true on the first run / check call. The editor uses
 * this as its `activeKernel === 'pyodide'` signal (previously derived from
 * `window.__pyodidePromise`).
 */
let pyodideLoadStarted = false

export function hasPyodideStarted(): boolean {
  return pyodideLoadStarted
}

/**
 * Spawn the worker (and start loading Pyodide) without running anything.
 * Idempotent; safe to call from IntersectionObserver scroll-into-view hooks.
 */
export function warmPyodideWorker(): void {
  pyodideLoadStarted = true
  getWorker()
}

function getWorker(): Worker {
  if (worker) return worker
  if (!workerUrl) {
    const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' })
    workerUrl = URL.createObjectURL(blob)
  }
  worker = new Worker(workerUrl)
  worker.onmessage = (e: MessageEvent) => {
    const data = e.data as {
      type: 'stdout' | 'stderr' | 'result' | 'check-result' | 'error'
      id: number
      text?: string
      result?: unknown
      plots?: string[]
      results?: PythonCheckResult[]
      message?: string
    }
    const slot = pending.get(data.id)
    if (!slot) return
    switch (data.type) {
      case 'stdout':
        slot.onStdout?.(data.text || '')
        break
      case 'stderr':
        slot.onStderr?.(data.text || '')
        break
      case 'result':
        pending.delete(data.id)
        slot.resolve({ result: data.result, plots: data.plots ?? [] })
        break
      case 'check-result':
        pending.delete(data.id)
        slot.resolve(data.results ?? [])
        break
      case 'error':
        pending.delete(data.id)
        slot.reject(new Error(data.message || 'Worker error'))
        break
    }
  }
  worker.onerror = (e) => {
    const err = new Error('Pyodide worker crashed: ' + (e.message || 'unknown'))
    for (const slot of pending.values()) slot.reject(err)
    pending.clear()
    terminatePyodideWorker()
  }
  return worker
}

/**
 * Kill the worker. Any in-flight run/check Promises are rejected so callers
 * can treat termination as a clean stop. Next call to runPython / runChecks
 * lazily respawns and reloads Pyodide.
 */
export function terminatePyodideWorker(): void {
  if (worker) {
    worker.terminate()
    worker = null
  }
  pyodideLoadStarted = false
  if (pending.size > 0) {
    const err = new Error('Pyodide worker terminated')
    for (const slot of pending.values()) slot.reject(err)
    pending.clear()
  }
}

export interface RunPythonOpts {
  code: string
  packages?: string[]
  textFiles?: PythonFile[]
  binaryFiles?: { name: string; bytes: Uint8Array }[]
  configMatplotlib?: boolean
  signal?: AbortSignal
  /** Hard timeout. On timeout the worker is terminated. */
  timeoutMs?: number
  onStdout?: (text: string) => void
  onStderr?: (text: string) => void
}

export interface RunPythonResult {
  result: unknown
  plots: string[]
  stopped?: boolean
  timedOut?: boolean
}

/**
 * Run user Python code in the worker. Streams stdout/stderr to the callbacks
 * as they arrive. On `signal.abort()` or timeout the worker is terminated and
 * the promise resolves with `stopped` / `timedOut` set.
 *
 * Rejects only on Python-level errors (the traceback comes back as
 * `error.message`); abort / timeout / worker-crash all resolve so callers can
 * treat them uniformly.
 */
export function runPython(opts: RunPythonOpts): Promise<RunPythonResult> {
  pyodideLoadStarted = true
  const id = ++nextId
  const w = getWorker()

  return new Promise<RunPythonResult>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null }
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort)
      pending.delete(id)
    }

    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      terminatePyodideWorker()
      // Pre-warm a successor: the student is likely to re-run in seconds, and
      // Pyodide takes ~2 s to re-init the interpreter on a fresh worker (the
      // download + WASM compile are already in browser cache). Spawning now
      // overlaps that init with the student's typing time.
      warmPyodideWorker()
      resolve({ result: null, plots: [], stopped: true })
    }

    const onTimeout = () => {
      if (settled) return
      settled = true
      cleanup()
      terminatePyodideWorker()
      warmPyodideWorker()
      resolve({ result: null, plots: [], timedOut: true })
    }

    if (opts.signal) {
      if (opts.signal.aborted) { onAbort(); return }
      opts.signal.addEventListener('abort', onAbort)
    }
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(onTimeout, opts.timeoutMs)
    }

    pending.set(id, {
      resolve: (v) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(v as RunPythonResult)
      },
      reject: (e) => {
        if (settled) return
        settled = true
        cleanup()
        reject(e)
      },
      onStdout: opts.onStdout,
      onStderr: opts.onStderr,
    })

    w.postMessage({
      type: 'run',
      id,
      code: opts.code,
      packages: opts.packages ?? [],
      textFiles: opts.textFiles ?? [],
      binaryFiles: opts.binaryFiles ?? [],
      configMatplotlib: !!opts.configMatplotlib,
    })
  })
}

export interface RunChecksOpts {
  studentCode: string
  checkCode: string
  auxFiles: PythonFile[]
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Run python checks against student code in the worker.
 *
 * On abort / timeout / worker-crash the worker is terminated and the function
 * resolves with all-failed results — matching the grader's prior behavior
 * where a timeout yields a 0 the teacher can override.
 */
export function runChecks(opts: RunChecksOpts): Promise<PythonCheckResult[]> {
  const { setupLines, assertions } = parseAssertions(opts.checkCode)
  if (assertions.length === 0) return Promise.resolve([])

  const usesTurtle = /import\s+turtle|from\s+turtle/.test(opts.studentCode)

  pyodideLoadStarted = true
  const id = ++nextId
  const w = getWorker()

  const allFailed = (errMsg: string): PythonCheckResult[] =>
    assertions.map((a: ParsedAssertion, i) => ({
      index: i,
      passed: false,
      label: a.failLabel,
      error: errMsg,
    }))

  return new Promise<PythonCheckResult[]>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null }
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort)
      pending.delete(id)
    }

    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      terminatePyodideWorker()
      warmPyodideWorker()
      resolve(allFailed('Stopped'))
    }

    const onTimeout = () => {
      if (settled) return
      settled = true
      cleanup()
      terminatePyodideWorker()
      warmPyodideWorker()
      resolve(allFailed('Execution timed out'))
    }

    if (opts.signal) {
      if (opts.signal.aborted) { onAbort(); return }
      opts.signal.addEventListener('abort', onAbort)
    }
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(onTimeout, opts.timeoutMs)
    }

    pending.set(id, {
      resolve: (v) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(v as PythonCheckResult[])
      },
      reject: (e) => {
        if (settled) return
        settled = true
        cleanup()
        // Treat worker crashes the same as timeout — grader-friendly default.
        resolve(allFailed('Check runner error: ' + e.message))
      },
    })

    w.postMessage({
      type: 'check',
      id,
      studentCode: opts.studentCode,
      setupLines,
      assertions,
      auxFiles: opts.auxFiles,
      usesTurtle,
    })
  })
}
