/**
 * Upsert (or clear) a teacher's per-question override for one student.
 * Teacher-only (teaches a class containing the student with the page unlocked).
 *
 * PUT /api/exams/[pageId]/grading/question
 * body: { studentId, componentId, awardedPoints?, maxPoints?, feedback?,
 *         criterion?, resetCriterion? }
 *
 * Two override styles share one row (source="override"):
 *   - WHOLE-COMPONENT (no rubric): `awardedPoints` (number|null) + `feedback`.
 *   - PER-CRITERION (rubric-based): `criterion` = {id, points?, comment?} merges
 *     one criterion into meta.criteria; `resetCriterion` = id removes it. Each
 *     field is set only when its key is present (so points / comment save
 *     independently). The override total (earned) is recomputed as the merge of
 *     the teacher's per-criterion edits over the AI's per-criterion points — see
 *     [[merge-criteria]] — so the priority resolver stays unchanged.
 * `feedback` (the general feedback) is always independent. The row is deleted
 * once it carries no points, no per-criterion edits, and no feedback.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getAuthoredExamPage, isTeacherOfStudentForPage } from '@/lib/scoring/auth'
import { isStudentReturned, returnedLockResponse } from '@/lib/scoring/return-state'
import { SCORE_PRIORITY } from '@/lib/scoring/score-component'
import { mergedCriterionTotal, type OverrideCriterion, type AiCriterion } from '@/lib/scoring/merge-criteria'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> },
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { pageId } = await params
    const body = await request.json().catch(() => ({}))
    const { studentId, componentId } = body as { studentId?: string; componentId?: string }
    if (!studentId || !componentId) {
      return NextResponse.json({ error: 'studentId and componentId are required' }, { status: 400 })
    }

    if (!(await getAuthoredExamPage(session.user.id, pageId))) {
      return NextResponse.json({ error: 'Page not found or access denied' }, { status: 404 })
    }
    if (!(await isTeacherOfStudentForPage(session.user.id, studentId, pageId))) {
      return NextResponse.json({ error: 'Not the teacher of this student' }, { status: 403 })
    }
    // A returned exam's scores are an immutable record — take it back to edit.
    if (await isStudentReturned(pageId, studentId)) return returnedLockResponse('student')

    const existing = await prisma.componentScore.findUnique({
      where: {
        pageId_studentId_componentId_source: { pageId, studentId, componentId, source: 'override' },
      },
      select: { earned: true, max: true, feedback: true, meta: true },
    })

    // Partial merge: only fields whose key is present in the body change.
    const hasPoints = 'awardedPoints' in body
    const hasFeedback = 'feedback' in body
    const hasMax = 'maxPoints' in body
    const hasCriterion = 'criterion' in body && body.criterion && typeof body.criterion === 'object'
    const hasResetCriterion = 'resetCriterion' in body

    // General feedback (always independent of the points / criteria).
    let feedback: string | null = existing?.feedback ?? null
    if (hasFeedback) {
      const f = typeof body.feedback === 'string' ? body.feedback.trim() : ''
      feedback = f === '' ? null : f
    }

    let earned: number | null = existing?.earned ?? null
    const existingMeta = (existing?.meta ?? null) as { criteria?: OverrideCriterion[] } | null
    let criteria: OverrideCriterion[] = Array.isArray(existingMeta?.criteria) ? [...existingMeta!.criteria] : []
    let maxPoints: number | null = existing?.max ?? null
    if (hasMax) {
      maxPoints = body.maxPoints === null ? null : Number(body.maxPoints)
      if (maxPoints !== null && !Number.isFinite(maxPoints)) maxPoints = null
    }

    if (hasCriterion || hasResetCriterion) {
      // PER-CRITERION edit: merge into meta.criteria, then recompute the total by
      // merging the teacher's per-criterion points over the AI's (the rubric is
      // the authoritative criterion set).
      const byId = new Map(criteria.map((c) => [c.id, { ...c }]))
      if (hasResetCriterion) byId.delete(String(body.resetCriterion))
      if (hasCriterion) {
        const inc = body.criterion as { id?: unknown; points?: unknown; comment?: unknown }
        const id = String(inc.id ?? '')
        if (!id) return NextResponse.json({ error: 'criterion.id is required' }, { status: 400 })
        const cur: OverrideCriterion = byId.get(id) ?? { id }
        if ('points' in inc) {
          const n = inc.points === null ? null : Number(inc.points)
          if (n !== null && !Number.isFinite(n)) {
            return NextResponse.json({ error: 'criterion.points must be a number or null' }, { status: 400 })
          }
          if (n === null) delete cur.points
          else cur.points = n
        }
        if ('comment' in inc) {
          const c = typeof inc.comment === 'string' ? inc.comment.trim() : ''
          if (c === '') delete cur.comment
          else cur.comment = c
        }
        if (cur.points == null && cur.comment == null) byId.delete(id)
        else byId.set(id, cur)
      }
      criteria = [...byId.values()]

      const [rubric, aiRow] = await Promise.all([
        prisma.scoringRubric.findUnique({
          where: { pageId_componentId: { pageId, componentId } },
          select: { criteria: true },
        }),
        prisma.componentScore.findUnique({
          where: { pageId_studentId_componentId_source: { pageId, studentId, componentId, source: 'ai' } },
          select: { meta: true },
        }),
      ])
      const rubricIds = (((rubric?.criteria as { id: string }[] | null) ?? []).map((c) => c.id))
      const aiCriteria = (((aiRow?.meta as { criteria?: AiCriterion[] } | null)?.criteria) ?? [])
      earned = criteria.length ? mergedCriterionTotal(rubricIds, aiCriteria, criteria) : null
    } else if (hasPoints) {
      // WHOLE-COMPONENT absolute override (no rubric path); clears per-criterion.
      criteria = []
      if (body.awardedPoints === null) {
        earned = null
      } else {
        const n = Number(body.awardedPoints)
        if (!Number.isFinite(n)) {
          return NextResponse.json({ error: 'awardedPoints must be a number or null' }, { status: 400 })
        }
        earned = n
      }
    }

    // Nothing left to store → drop the override row (reverts to the next source).
    if (earned === null && feedback === null && criteria.length === 0) {
      await prisma.componentScore.deleteMany({ where: { pageId, studentId, componentId, source: 'override' } })
      return NextResponse.json({ cleared: true })
    }

    const data = {
      priority: SCORE_PRIORITY.override,
      earned,
      max: maxPoints,
      feedback,
      meta: criteria.length ? { criteria } : Prisma.DbNull,
      createdBy: session.user.id,
    }
    const grade = await prisma.componentScore.upsert({
      where: {
        pageId_studentId_componentId_source: { pageId, studentId, componentId, source: 'override' },
      },
      create: { pageId, studentId, componentId, source: 'override', ...data },
      update: data,
    })

    return NextResponse.json({ grade })
  } catch (error) {
    console.error('[grading/question] PUT failed:', error)
    return NextResponse.json({ error: 'Failed to save question grade' }, { status: 500 })
  }
}
