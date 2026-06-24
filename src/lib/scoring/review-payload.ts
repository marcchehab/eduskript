/**
 * Build the per-component SCORE payload for one student's exam review — the grade
 * breakdown + each component's per-source rows (check/ai/override) + its rubric,
 * but NOT the answer payload (answers are immutable and stay live).
 *
 * Shared by the review endpoint (live) and the return endpoint (frozen into an
 * ExamAuditLog 'return' event's payload so a returned exam is an immutable record).
 * Keeping both on this one builder guarantees the snapshot is byte-identical to a
 * live review. See [[return-state]].
 *
 * Related: [[aggregate]], [[score-component]]. The review route re-attaches answers.
 */
import { prisma } from '@/lib/prisma'
import { computeExamGrades } from './aggregate'

export interface ReviewScoreSource {
  source: string
  earned: number | null
  max: number | null
  feedback: string | null
  meta: unknown
}
export interface ReviewScoreComponent {
  componentId: string
  kind: string
  questionType: string | null
  label: string | null
  earned: number
  max: number
  autoEarned: number
  aiEarned: number | null
  effectiveSource: string | null
  answered: boolean
  overridden: boolean
  feedback: string | null
  sources: ReviewScoreSource[]
  rubric: unknown
}
export interface ReviewScores {
  grade: number
  totalEarned: number
  totalMax: number
  components: ReviewScoreComponent[]
}

export async function buildReviewScores(pageId: string, studentId: string): Promise<ReviewScores> {
  const grading = await computeExamGrades(pageId, [studentId])
  const g = grading.byStudent.get(studentId)!
  const componentIds = grading.components.map((c) => c.componentId)

  const [scoreRows, rubricRows] = await Promise.all([
    prisma.componentScore.findMany({
      where: { pageId, studentId, componentId: { in: componentIds } },
      select: { componentId: true, source: true, earned: true, max: true, feedback: true, meta: true },
    }),
    componentIds.length
      ? prisma.scoringRubric.findMany({
          where: { pageId, componentId: { in: componentIds } },
          select: { componentId: true, criteria: true, maxPoints: true, source: true, model: true, updatedAt: true },
        })
      : Promise.resolve([]),
  ])
  const rubricByComponent = new Map(rubricRows.map((r) => [r.componentId, r]))
  const sourcesByComponent = new Map<string, ReviewScoreSource[]>()
  for (const r of scoreRows) {
    const list = sourcesByComponent.get(r.componentId) ?? []
    list.push({ source: r.source, earned: r.earned, max: r.max, feedback: r.feedback, meta: r.meta })
    sourcesByComponent.set(r.componentId, list)
  }

  return {
    grade: g.grade,
    totalEarned: g.totalEarned,
    totalMax: g.totalMax,
    components: g.components.map((c) => ({
      componentId: c.componentId,
      kind: c.kind,
      questionType: c.questionType ?? null,
      label: c.label ?? null,
      earned: c.earned,
      max: c.max,
      autoEarned: c.autoEarned,
      aiEarned: c.aiEarned,
      effectiveSource: c.effectiveSource,
      answered: c.answered,
      overridden: c.overridden,
      feedback: c.feedback ?? null,
      sources: sourcesByComponent.get(c.componentId) ?? [],
      rubric: rubricByComponent.get(c.componentId) ?? null,
    })),
  }
}
