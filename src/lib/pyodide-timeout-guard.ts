'use client'

/**
 * Pyodide wall-clock timeout guard.
 *
 * Pyodide runs on the main thread, so a tight Python loop (`while True: pass`)
 * freezes the page entirely — the Stop button can't even register a click,
 * and inside Safe Exam Browser there's no tab-close escape.
 *
 * Mitigation: install a `sys.settrace` callback that checks a wall-clock
 * deadline on every Python frame event. When the deadline passes, the next
 * Python line raises `TimeoutError("Execution timed out")` from inside the
 * interpreter — which awaits cleanly out of `runPythonAsync`.
 *
 * Limits — settrace fires on Python frame events only. A hang inside a
 * single C call (e.g. a pathological numpy op) still freezes the page until
 * the C call returns. The robust fix is to run Pyodide in a terminable Web
 * Worker (Phase B). For student-typed code, infinite loops are almost always
 * pure-Python, so this catches the dominant exam-disaster case.
 *
 * Lifecycle — install BEFORE the code you want to bound, clear in `finally`.
 * The guard persists across `runPythonAsync` calls because `sys.settrace` is
 * thread-global; leaving it installed means the next run inherits a deadline
 * already in the past and times out instantly. Always clear.
 */

const INSTALL_SNIPPET = (deadlineS: number) => `
import sys, time
__eduskript_deadline = time.time() + ${deadlineS}
def __eduskript_guard(frame, event, arg):
    if time.time() > __eduskript_deadline:
        raise TimeoutError("Execution timed out")
    return __eduskript_guard
sys.settrace(__eduskript_guard)
`

/** Arm the wall-clock guard. Subsequent `runPythonAsync` calls are bounded. */
export async function installPyodideTimeout(pyodide: any, seconds: number): Promise<void> {
  await pyodide.runPythonAsync(INSTALL_SNIPPET(seconds))
}

/** Disarm the guard. Safe to call even if install failed; errors are swallowed. */
export async function clearPyodideTimeout(pyodide: any): Promise<void> {
  await pyodide.runPythonAsync('import sys\nsys.settrace(None)').catch(() => {})
}
