'use client'

/**
 * Grading-time python re-runner (teacher's device). Re-runs a student's
 * SUBMITTED code against the page's python-check asserts and returns the
 * authoritative `{earned, max, passed, total}` — this, not the student's
 * client-computed score, is what gets persisted (ExamCheckRun) and graded.
 *
 * Reuses `runPythonChecks` + the same Pyodide CDN build as the editors.
 *
 * TIMEOUT — best-effort only (Phase 1): a `sys.settrace` wall-clock deadline
 * raises inside Python, so it interrupts ordinary Python-level infinite loops
 * (the common `while True:` bug). It does NOT interrupt a hang inside a single
 * C call, because Pyodide runs on the main thread here. The robust fix is to
 * run this in a terminable Web Worker — deliberately deferred to Phase 2. For
 * now, one pathological submission can still freeze the grader's tab.
 */

import { runPythonChecks } from '@/components/public/code-editor/python-check-runner'
import type { PythonFile } from '@/components/public/code-editor/types'

const PYODIDE_VERSION = 'v0.29.0'
const TIMEOUT_S = 6

export interface CheckInput {
  componentId: string
  checkCode: string
  points: number
  studentCode: string
  auxFiles: PythonFile[]
}

export interface CheckRunResult {
  componentId: string
  earned: number
  max: number
  passed: number
  total: number
  /** true when nothing was run (no submitted code) — distinct from a real 0. */
  notRun?: boolean
}

/** Load (or reuse) the shared Pyodide instance — mirrors the editor's loader. */
export function loadGradingPyodide(): Promise<any> {
  const w = window as any
  if (w.__pyodidePromise) return w.__pyodidePromise

  if (!document.querySelector('script[src*="pyodide.js"]')) {
    const script = document.createElement('script')
    script.src = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/pyodide.js`
    document.body.appendChild(script)
    return new Promise((resolve, reject) => {
      script.onload = () => {
        w.__pyodidePromise = w.loadPyodide({
          indexURL: `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`,
        })
        w.__pyodidePromise.then(resolve).catch(reject)
      }
      script.onerror = () => reject(new Error('Failed to load Pyodide'))
    })
  }
  if (!w.__pyodidePromise && w.loadPyodide) {
    w.__pyodidePromise = w.loadPyodide({
      indexURL: `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`,
    })
  }
  return w.__pyodidePromise || Promise.resolve(null)
}

const INSTALL_GUARD = (deadlineS: number) => `
import sys, time
__eduskript_deadline = time.time() + ${deadlineS}
def __eduskript_guard(frame, event, arg):
    if time.time() > __eduskript_deadline:
        raise TimeoutError("Execution timed out")
    return __eduskript_guard
sys.settrace(__eduskript_guard)
`

/** Re-run one python component for one student. Never throws. */
export async function runCheck(pyodide: any, input: CheckInput): Promise<CheckRunResult> {
  const max = input.points
  if (!input.studentCode || !input.studentCode.trim()) {
    return { componentId: input.componentId, earned: 0, max, passed: 0, total: 0, notRun: true }
  }
  try {
    await pyodide.runPythonAsync(INSTALL_GUARD(TIMEOUT_S))
    try {
      const results = await runPythonChecks(pyodide, input.studentCode, input.checkCode, input.auxFiles)
      const total = results.length
      const passed = results.filter((r) => r.passed).length
      const earned = total > 0 ? Math.round((passed / total) * max) : 0
      return { componentId: input.componentId, earned, max, passed, total }
    } finally {
      await pyodide.runPythonAsync('import sys\nsys.settrace(None)').catch(() => {})
    }
  } catch {
    // Timeout / runtime error in the harness → score 0, teacher can override.
    return { componentId: input.componentId, earned: 0, max, passed: 0, total: 0 }
  }
}

/**
 * The full grading-time driver, used by BOTH the individual (one student) and
 * "Run all" (whole class) flows: for each student, fetch their check inputs,
 * re-run on the teacher's Pyodide, and persist each result (ExamCheckRun).
 * `onProgress(done, total)` ticks per student. Loads Pyodide once.
 */
export async function runChecksForStudents(
  pageId: string,
  studentIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (studentIds.length === 0) return
  const pyodide = await loadGradingPyodide()
  let done = 0
  for (const studentId of studentIds) {
    try {
      const res = await fetch(`/api/exams/${pageId}/check-inputs?studentId=${encodeURIComponent(studentId)}`)
      const { inputs } = (await res.json()) as { inputs: CheckInput[] }
      for (const input of inputs ?? []) {
        const result = await runCheck(pyodide, input)
        if (result.notRun) continue // no submitted code → leave unscored
        await fetch(`/api/exams/${pageId}/check-run`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId, ...result }),
        }).catch(() => {})
      }
    } catch {
      // skip this student on error; others still run
    }
    onProgress?.(++done, studentIds.length)
  }
}
