'use client'

/**
 * Grading-time python re-runner (teacher's device). Re-runs a student's
 * SUBMITTED code against the page's python-check asserts and returns the
 * authoritative `{earned, max, passed, total}` — this, not the student's
 * client-computed score, is what gets persisted (ExamCheckRun) and graded.
 *
 * Uses the shared Pyodide Worker (`src/lib/pyodide-worker.client.ts`). On
 * timeout / abort the worker terminates and respawns on the next call; the
 * worker module returns all-failed results so a pathological submission
 * scores 0 (which a teacher can override) without freezing the grader's tab.
 */

import type { PythonFile } from '@/components/public/code-editor/types'
import { runChecks, warmPyodideWorker } from '@/lib/pyodide-worker.client'

const TIMEOUT_MS = 6_000

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

/**
 * Spawn the Pyodide worker early. Kept as a separate function because the
 * grading flow calls it once before iterating students so the cold-start
 * cost is amortized over the batch instead of charged to student #1.
 */
export function loadGradingPyodide(): void {
  warmPyodideWorker()
}

/** Re-run one python component for one student. Never throws. */
export async function runCheck(input: CheckInput): Promise<CheckRunResult> {
  const max = input.points
  if (!input.studentCode || !input.studentCode.trim()) {
    return { componentId: input.componentId, earned: 0, max, passed: 0, total: 0, notRun: true }
  }
  try {
    const results = await runChecks({
      studentCode: input.studentCode,
      checkCode: input.checkCode,
      auxFiles: input.auxFiles,
      timeoutMs: TIMEOUT_MS,
    })
    const total = results.length
    const passed = results.filter((r) => r.passed).length
    const earned = total > 0 ? Math.round((passed / total) * max) : 0
    return { componentId: input.componentId, earned, max, passed, total }
  } catch {
    // Worker module already converts timeout / abort / crash into all-failed
    // results; reaching here means something unexpected. Score 0; teacher can
    // override.
    return { componentId: input.componentId, earned: 0, max, passed: 0, total: 0 }
  }
}

/**
 * The full grading-time driver, used by BOTH the individual (one student) and
 * "Run all" (whole class) flows: for each student, fetch their check inputs,
 * re-run on the teacher's Pyodide worker, and persist each result
 * (ExamCheckRun). `onProgress(done, total)` ticks per student.
 */
export async function runChecksForStudents(
  pageId: string,
  studentIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (studentIds.length === 0) return
  loadGradingPyodide()
  let done = 0
  for (const studentId of studentIds) {
    try {
      const res = await fetch(`/api/exams/${pageId}/check-inputs?studentId=${encodeURIComponent(studentId)}`)
      const { inputs } = (await res.json()) as { inputs: CheckInput[] }
      for (const input of inputs ?? []) {
        const result = await runCheck(input)
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
