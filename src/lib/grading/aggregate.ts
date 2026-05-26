/**
 * Exam grade aggregation. Pure `aggregateStudent` (components + stored payloads
 * + overrides + config → total + grade) is unit-tested; `computeExamGrades`
 * is the batched DB wrapper the grading API uses (one UserData query + one
 * override query for the whole class).
 *
 * Raw answers are read from UserData (adapter=componentId, itemId=pageId) — NOT
 * from handin checkpoints, which only capture code editors. Per-question auto
 * scores are AUTHORITATIVE ExamCheckRun values, computed on the teacher's device
 * during grading (python asserts re-run; quiz choice/text re-derived from the
 * raw answer) — the client's persisted textScore/choiceScore/earnedPoints is
 * live-preview only and not trusted here. A teacher ExamQuestionGrade override
 * wins over the auto score.
 *
 * Related: [[components]], [[score-component]], [[grade-formula]].
 */

import { prisma } from '@/lib/prisma'
import type { ExamGradeConfig } from '@prisma/client'
import type { QuizData, PythonCheckData } from '@/lib/userdata/types'
import { parseGradableComponents, type GradableComponent } from './components'
import { scoreComponent } from './score-component'
import {
  gradeFromPoints,
  DEFAULT_GRADE_CONFIG,
  type GradeConfigParams,
} from './grade-formula'

export interface ComponentResult {
  componentId: string
  kind: GradableComponent['kind']
  questionType?: GradableComponent['questionType']
  label?: string
  earned: number
  max: number
  answered: boolean
  overridden: boolean
  autoEarned: number
}

export interface StudentGrade {
  components: ComponentResult[]
  totalEarned: number
  totalMax: number
  grade: number
}

export interface QuestionOverride {
  awardedPoints: number
  maxPoints?: number | null
}

/** Map a stored ExamGradeConfig row (or null) to formula params + max override. */
export function resolveConfig(row: ExamGradeConfig | null | undefined): {
  params: GradeConfigParams
  maxPointsOverride: number | null
} {
  if (!row) return { params: { ...DEFAULT_GRADE_CONFIG }, maxPointsOverride: null }
  return {
    params: {
      formula: row.formula === 'linear' ? 'linear' : 'twoSegment',
      passPercent: row.passPercent,
      passGrade: row.passGrade,
      topGrade: row.topGrade,
      bottomGrade: row.bottomGrade,
      roundingStep: row.roundingStep,
    },
    maxPointsOverride: row.maxPoints ?? null,
  }
}

/** Pure: aggregate one student's grade from already-loaded inputs. */
export function aggregateStudent(
  components: GradableComponent[],
  payloads: Map<string, unknown>,
  overrides: Map<string, QuestionOverride>,
  params: GradeConfigParams,
  maxPointsOverride: number | null,
  checkRuns: Map<string, { earned: number; max: number }> = new Map(),
): StudentGrade {
  const results: ComponentResult[] = components.map((c) => {
    const s = scoreComponent({
      kind: c.kind,
      questionType: c.questionType,
      declaredMax: c.maxPoints ?? null,
      payload: (payloads.get(c.componentId) as Partial<QuizData & PythonCheckData> | undefined) ?? null,
      checkRun: checkRuns.get(c.componentId) ?? null,
      override: overrides.get(c.componentId) ?? null,
    })
    return {
      componentId: c.componentId,
      kind: c.kind,
      questionType: c.questionType,
      label: c.label,
      earned: s.earned,
      max: s.max,
      answered: s.answered,
      overridden: s.overridden,
      autoEarned: s.autoEarned,
    }
  })

  const totalEarned = round1(results.reduce((sum, r) => sum + r.earned, 0))
  const summedMax = results.reduce((sum, r) => sum + r.max, 0)
  const totalMax = maxPointsOverride ?? round1(summedMax)
  const grade = gradeFromPoints(totalEarned, totalMax, params)

  return { components: results, totalEarned, totalMax, grade }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export interface ExamGrading {
  components: GradableComponent[]
  params: GradeConfigParams
  maxPointsOverride: number | null
  /** Auto-summed max of all components (before any override) — for the UI. */
  autoMaxPoints: number
  byStudent: Map<string, StudentGrade>
}

/**
 * Batched: compute grades for many students of one exam page. One content
 * parse, one config read, one UserData query, one overrides query.
 */
export async function computeExamGrades(
  pageId: string,
  studentIds: string[],
): Promise<ExamGrading> {
  const [page, configRow] = await Promise.all([
    prisma.page.findUnique({ where: { id: pageId }, select: { content: true } }),
    prisma.examGradeConfig.findUnique({ where: { pageId } }),
  ])
  const components = page ? parseGradableComponents(page.content) : []
  const { params, maxPointsOverride } = resolveConfig(configRow)
  const componentIds = components.map((c) => c.componentId)
  const autoMaxPoints = round1(components.reduce((s, c) => s + (c.maxPoints ?? 1), 0))

  const byStudent = new Map<string, StudentGrade>()
  if (studentIds.length === 0 || componentIds.length === 0) {
    for (const sid of studentIds) {
      byStudent.set(sid, aggregateStudent(components, new Map(), new Map(), params, maxPointsOverride))
    }
    return { components, params, maxPointsOverride, autoMaxPoints, byStudent }
  }

  const [rows, overrideRows, checkRunRows] = await Promise.all([
    prisma.userData.findMany({
      where: {
        userId: { in: studentIds },
        itemId: pageId,
        adapter: { in: componentIds },
        targetType: null,
      },
      select: { userId: true, adapter: true, data: true },
    }),
    prisma.examQuestionGrade.findMany({
      where: { pageId, studentId: { in: studentIds } },
      select: { studentId: true, componentId: true, awardedPoints: true, maxPoints: true },
    }),
    prisma.examCheckRun.findMany({
      where: { pageId, studentId: { in: studentIds } },
      select: { studentId: true, componentId: true, earned: true, max: true },
    }),
  ])

  const payloadsByStudent = new Map<string, Map<string, unknown>>()
  for (const r of rows) {
    let m = payloadsByStudent.get(r.userId)
    if (!m) payloadsByStudent.set(r.userId, (m = new Map()))
    m.set(r.adapter, r.data)
  }
  const overridesByStudent = new Map<string, Map<string, QuestionOverride>>()
  for (const o of overrideRows) {
    let m = overridesByStudent.get(o.studentId)
    if (!m) overridesByStudent.set(o.studentId, (m = new Map()))
    m.set(o.componentId, { awardedPoints: o.awardedPoints, maxPoints: o.maxPoints })
  }
  const checkRunsByStudent = new Map<string, Map<string, { earned: number; max: number }>>()
  for (const cr of checkRunRows) {
    let m = checkRunsByStudent.get(cr.studentId)
    if (!m) checkRunsByStudent.set(cr.studentId, (m = new Map()))
    m.set(cr.componentId, { earned: cr.earned, max: cr.max })
  }

  for (const sid of studentIds) {
    byStudent.set(
      sid,
      aggregateStudent(
        components,
        payloadsByStudent.get(sid) ?? new Map(),
        overridesByStudent.get(sid) ?? new Map(),
        params,
        maxPointsOverride,
        checkRunsByStudent.get(sid) ?? new Map(),
      ),
    )
  }

  return { components, params, maxPointsOverride, autoMaxPoints, byStudent }
}

/** Single-student convenience (used by the student my-grade endpoint). */
export async function computeExamGrade(pageId: string, studentId: string): Promise<StudentGrade> {
  const { byStudent } = await computeExamGrades(pageId, [studentId])
  return byStudent.get(studentId)!
}
