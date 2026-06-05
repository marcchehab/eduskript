/**
 * Read students' submitted answers for one gradable component, as plain text for
 * AI scoring (and rubric generation). Server-side; teacher-of-student auth is the
 * caller's responsibility.
 *
 * - python: the SUBMITTED code — the handin checkpoint of the linked editor
 *   (`code-editor-<id>`), falling back to the latest live UserData. Mirrors the
 *   read in api/exams/[pageId]/check-inputs.
 * - quiz text: the free-text answer (QuizData.textAnswer).
 * - quiz single/multiple/number/range: a compact textual rendering of the stored
 *   answer (these are auto-scored by the check source; AI scoring is mainly for
 *   code + free text, but we surface something rather than nothing).
 *
 * Related: [[components]], [[aggregate]].
 */

import { prisma } from '@/lib/prisma'
import type { GradableComponent } from './components'
import type { QuizData } from '@/lib/userdata/types'

export interface ComponentSubmission {
  studentId: string
  /** The answer as text for the LLM. Empty string when nothing was submitted. */
  text: string
  empty: boolean
}

interface CodeFile { name?: string; content?: string }
interface CodeEditorPayload { files?: CodeFile[]; activeFileIndex?: number }

function codeText(raw: unknown): string {
  const p = (raw ?? {}) as CodeEditorPayload
  const files = Array.isArray(p.files) ? p.files : []
  if (files.length === 0) return ''
  // Concatenate all files (main first), labelled, so multi-file solutions are
  // legible to the model.
  const idx = typeof p.activeFileIndex === 'number' ? p.activeFileIndex : 0
  const ordered = [files[idx], ...files.filter((_, i) => i !== idx)].filter(Boolean) as CodeFile[]
  if (ordered.length === 1) return ordered[0].content ?? ''
  return ordered.map((f) => `# ${f.name ?? 'file.py'}\n${f.content ?? ''}`).join('\n\n')
}

function quizText(raw: unknown): string {
  const d = (raw ?? {}) as QuizData
  if (typeof d.textAnswer === 'string' && d.textAnswer.trim()) return d.textAnswer
  if (Array.isArray(d.selected) && d.selected.length) return `Selected options: ${d.selected.join(', ')}`
  if (typeof d.numberAnswer === 'number') return `Answer: ${d.numberAnswer}`
  if (d.rangeAnswer) return `Range: ${d.rangeAnswer.min}–${d.rangeAnswer.max}`
  return ''
}

export async function readComponentSubmissions(
  pageId: string,
  component: GradableComponent,
  studentIds: string[],
): Promise<Map<string, ComponentSubmission>> {
  const result = new Map<string, ComponentSubmission>()
  if (studentIds.length === 0) return result
  const put = (studentId: string, text: string) =>
    result.set(studentId, { studentId, text, empty: text.trim() === '' })

  if (component.kind === 'python') {
    const editorId = 'code-editor-' + component.componentId.replace(/^python-check-/, '')
    const [checkpoints, liveRows] = await Promise.all([
      prisma.userDataCheckpoint.findMany({
        where: { userId: { in: studentIds }, pageId, componentId: editorId, kind: 'handin' },
        orderBy: { createdAt: 'desc' },
        distinct: ['userId'],
        select: { userId: true, payload: true },
      }),
      prisma.userData.findMany({
        where: { userId: { in: studentIds }, itemId: pageId, adapter: editorId, targetType: null },
        select: { userId: true, data: true },
      }),
    ])
    const handin = new Map(checkpoints.map((c) => [c.userId, c.payload]))
    const live = new Map(liveRows.map((r) => [r.userId, r.data]))
    for (const sid of studentIds) put(sid, codeText(handin.get(sid) ?? live.get(sid) ?? null))
    return result
  }

  // quiz: answers live under adapter === componentId
  const rows = await prisma.userData.findMany({
    where: { userId: { in: studentIds }, itemId: pageId, adapter: component.componentId, targetType: null },
    select: { userId: true, data: true },
  })
  const byStudent = new Map(rows.map((r) => [r.userId, r.data]))
  for (const sid of studentIds) put(sid, quizText(byStudent.get(sid) ?? null))
  return result
}
