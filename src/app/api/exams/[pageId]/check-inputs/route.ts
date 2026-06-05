/**
 * Inputs for re-running a student's python checks at grading time (teacher's
 * device): per python component, the check asserts + points + the student's
 * SUBMITTED code. The client runner (`run-checks.client.ts`) consumes this and
 * POSTs results to `check-run`.
 *
 * GET /api/exams/[pageId]/check-inputs?studentId=X   (teacher-of-student only)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseGradableComponents } from '@/lib/scoring/components'
import { isTeacherOfStudentForPage } from '@/lib/scoring/auth'

interface CodeFile { name?: string; content?: string }
interface CodeEditorPayload { files?: CodeFile[]; activeFileIndex?: number }

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> },
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { pageId } = await params
    const studentId = new URL(request.url).searchParams.get('studentId')
    if (!studentId) {
      return NextResponse.json({ error: 'studentId required' }, { status: 400 })
    }
    if (!(await isTeacherOfStudentForPage(session.user.id, studentId, pageId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const page = await prisma.page.findUnique({ where: { id: pageId }, select: { content: true } })
    if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const pythonComponents = parseGradableComponents(page.content).filter((c) => c.kind === 'python')
    if (pythonComponents.length === 0) return NextResponse.json({ inputs: [] })

    // The submitted code lives under the EDITOR id (code-editor-<id>), while the
    // gradable component is the check (python-check-<id>). Prefer the handin
    // checkpoint; fall back to the latest live UserData for that editor.
    const editorIdFor = (componentId: string) =>
      'code-editor-' + componentId.replace(/^python-check-/, '')
    const editorIds = pythonComponents.map((c) => editorIdFor(c.componentId))

    const [checkpoints, liveRows] = await Promise.all([
      prisma.userDataCheckpoint.findMany({
        where: { userId: studentId, pageId, componentId: { in: editorIds }, kind: 'handin' },
        orderBy: { createdAt: 'desc' },
        distinct: ['componentId'],
        select: { componentId: true, payload: true },
      }),
      prisma.userData.findMany({
        where: { userId: studentId, itemId: pageId, adapter: { in: editorIds }, targetType: null },
        select: { adapter: true, data: true },
      }),
    ])
    const handinByEditor = new Map(checkpoints.map((c) => [c.componentId, c.payload]))
    const liveByEditor = new Map(liveRows.map((r) => [r.adapter, r.data]))

    const codeFromPayload = (raw: unknown): { studentCode: string; auxFiles: { name: string; content: string }[] } => {
      const p = (raw ?? {}) as CodeEditorPayload
      const files = Array.isArray(p.files) ? p.files : []
      const idx = typeof p.activeFileIndex === 'number' ? p.activeFileIndex : 0
      const main = files[idx]?.content ?? files[0]?.content ?? ''
      const aux = files.length > 1
        ? files.filter((_, i) => i !== idx).map((f) => ({ name: f.name ?? 'aux.py', content: f.content ?? '' }))
        : []
      return { studentCode: main, auxFiles: aux }
    }

    const inputs = pythonComponents.map((c) => {
      const editorId = editorIdFor(c.componentId)
      const payload = handinByEditor.get(editorId) ?? liveByEditor.get(editorId) ?? null
      const { studentCode, auxFiles } = codeFromPayload(payload)
      return {
        componentId: c.componentId,
        checkCode: c.checkCode ?? '',
        points: c.maxPoints ?? 1,
        studentCode,
        auxFiles,
      }
    })

    return NextResponse.json({ inputs })
  } catch (error) {
    console.error('[check-inputs] GET failed:', error)
    return NextResponse.json({ error: 'Failed to load check inputs' }, { status: 500 })
  }
}
