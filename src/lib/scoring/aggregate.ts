/**
 * Exam scoring + grade aggregation. Pure `aggregateStudent` (components + score
 * sources + config → total score + grade) is unit-tested; `computeExamGrades`
 * is the batched DB wrapper the grading API uses (one ComponentScore query for
 * the whole class).
 *
 * All per-question points come from ComponentScore rows (check / ai / override
 * sources) — the trusted, server-side scores. The client's persisted
 * textScore/choiceScore/earnedPoints is live-preview only and not read here. The
 * effective points per component are resolved by `scoreComponent` (highest
 * priority wins; feedback resolved independently). The 1-6 grade is then computed
 * by the grade key from the total score.
 *
 * Related: [[components]], [[score-component]], [[grade-formula]].
 */

import { prisma } from '@/lib/prisma'
import type { ExamGradeConfig } from '@prisma/client'
import { parseGradableComponents, type GradableComponent } from './components'
import { scoreComponent, type ScoreSource } from './score-component'
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
  /** The ai-source points, if any (for an "AI: 1.5" display). */
  aiEarned: number | null
  /** Which source won the points (null = nothing scored yet). */
  effectiveSource: string | null
  feedback?: string | null
}

export interface StudentGrade {
  components: ComponentResult[]
  totalEarned: number
  totalMax: number
  grade: number
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

/** Pure: aggregate one student's grade from already-loaded score sources. */
export function aggregateStudent(
  components: GradableComponent[],
  sourcesByComponent: Map<string, ScoreSource[]>,
  params: GradeConfigParams,
  maxPointsOverride: number | null,
): StudentGrade {
  const results: ComponentResult[] = components.map((c) => {
    const s = scoreComponent({
      declaredMax: c.maxPoints ?? null,
      sources: sourcesByComponent.get(c.componentId) ?? [],
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
      aiEarned: s.aiEarned,
      effectiveSource: s.effectiveSource,
      feedback: s.feedback,
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
 * Batched: compute grades for many students of one exam page. One content parse,
 * one config read, one ComponentScore query for the whole class.
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
      byStudent.set(sid, aggregateStudent(components, new Map(), params, maxPointsOverride))
    }
    return { components, params, maxPointsOverride, autoMaxPoints, byStudent }
  }

  const scoreRows = await prisma.componentScore.findMany({
    where: { pageId, studentId: { in: studentIds }, componentId: { in: componentIds } },
    select: {
      studentId: true,
      componentId: true,
      source: true,
      priority: true,
      earned: true,
      max: true,
      feedback: true,
      updatedAt: true,
    },
  })

  // student -> componentId -> ScoreSource[]
  const byStudentComponent = new Map<string, Map<string, ScoreSource[]>>()
  for (const r of scoreRows) {
    let perComponent = byStudentComponent.get(r.studentId)
    if (!perComponent) byStudentComponent.set(r.studentId, (perComponent = new Map()))
    let list = perComponent.get(r.componentId)
    if (!list) perComponent.set(r.componentId, (list = []))
    list.push({
      source: r.source,
      priority: r.priority,
      earned: r.earned,
      max: r.max,
      feedback: r.feedback,
      updatedAt: r.updatedAt,
    })
  }

  for (const sid of studentIds) {
    byStudent.set(
      sid,
      aggregateStudent(
        components,
        byStudentComponent.get(sid) ?? new Map(),
        params,
        maxPointsOverride,
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
