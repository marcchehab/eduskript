/**
 * Run AI scoring (step 2) for one component or all components on an exam page,
 * across the teacher's students. For each (component, student) with a submission
 * and a saved rubric, the LLM awards points per criterion; the result is stored
 * as a ComponentScore(source="ai") — points + feedback only, never a grade.
 *
 * POST { componentId? , all? , studentIds? }   (teacher who authored the page)
 *   - componentId: score just this component;  all: score every component
 *   - studentIds: restrict to these (else every student the teacher teaches)
 * Returns per-student results + any errors. Synchronous (bounded concurrency);
 * the UI shows a spinner. A rubric must exist for each scored component.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'
import { getAuthoredExamPage, isTeacherOfStudentForPage } from '@/lib/scoring/auth'
import { parseGradableComponents, extractComponentContext } from '@/lib/scoring/components'
import { readComponentSubmissions } from '@/lib/scoring/submissions'
import { SCORE_PRIORITY } from '@/lib/scoring/score-component'
import { scoreSubmission, scoringModel, type RubricCriterion, type AiDebug } from '@/lib/ai/scoring'
import { loadAiGuidance } from '@/lib/ai/guidance'
import { mergedCriterionTotal, type OverrideCriterion } from '@/lib/scoring/merge-criteria'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CONCURRENCY = 4

/** Score one submission, retrying TRANSIENT failures (provider timeout / rate
 *  limit) with backoff. Deterministic PARSE failures are returned immediately.
 *  An EMPTY response (reasoning ate the token budget) IS retried, but with the
 *  attempt index passed through so scoreSubmission escalates the cap + perturbs
 *  the seed — an identical retry at temperature 0 would reproduce the stall. */
async function scoreWithRetry(
  input: Parameters<typeof scoreSubmission>[0],
  attempts = 3,
): Promise<Awaited<ReturnType<typeof scoreSubmission>>> {
  let res = await scoreSubmission(input, 0)
  for (let i = 1; i < attempts && 'error' in res; i++) {
    if (/parse|no usable criteria/i.test(res.error)) break // deterministic → don't retry
    await new Promise((r) => setTimeout(r, 500 * 2 ** (i - 1))) // 0.5s, 1s backoff
    res = await scoreSubmission(input, i)
  }
  return res
}

async function teacherStudentIds(userId: string, pageId: string): Promise<string[]> {
  const rows = await prisma.classMembership.findMany({
    where: { class: { teacherId: userId, pageUnlocks: { some: { pageId } } } },
    select: { studentId: true },
  })
  return [...new Set(rows.map((r) => r.studentId))]
}

/** Run `worker` over items with bounded concurrency, preserving order. */
async function pool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function run() {
    while (next < items.length) {
      const i = next++
      out[i] = await worker(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return out
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPaidUser(session.user)) return paidOnlyResponse('AI scoring is a paid feature.')
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })
  }
  const { pageId } = await params
  const page = await getAuthoredExamPage(session.user.id, pageId)
  if (!page) return NextResponse.json({ error: 'Page not found or access denied' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const { componentId, componentIds, all, studentIds: requested } = body as {
    componentId?: string
    componentIds?: string[]
    all?: boolean
    studentIds?: string[]
  }

  const content = (page as { content?: string }).content ?? ''
  const components = parseGradableComponents(content)
  const wanted = componentIds && componentIds.length ? new Set(componentIds) : null
  const targets = all
    ? components
    : wanted
      ? components.filter((c) => wanted.has(c.componentId))
      : components.filter((c) => c.componentId === componentId)
  if (targets.length === 0) {
    return NextResponse.json({ error: 'No matching gradable component' }, { status: 400 })
  }

  const allowed = await teacherStudentIds(session.user.id, pageId)
  const allowedSet = new Set(allowed)
  const studentIds = (requested && requested.length ? requested.filter((s) => allowedSet.has(s)) : allowed)
  if (studentIds.length === 0) return NextResponse.json({ scored: 0, results: [], errors: [] })

  const rubrics = await prisma.scoringRubric.findMany({
    where: { pageId, componentId: { in: targets.map((t) => t.componentId) } },
  })
  const rubricByComponent = new Map(rubrics.map((r) => [r.componentId, r]))
  const guidance = await loadAiGuidance(session.user.id)
  const model = scoringModel()

  const results: { componentId: string; studentId: string; earned: number }[] = []
  // `debug` carries the raw model output / finishReason on a parse failure so the
  // teacher can see WHY in the browser console (gated behind the `scoring:*` debug
  // namespace client-side). It's their own page's data, so always returning it is fine.
  const errors: { componentId: string; studentId?: string; error: string; debug?: AiDebug }[] = []

  for (const c of targets) {
    const rubric = rubricByComponent.get(c.componentId)
    if (!rubric) {
      errors.push({ componentId: c.componentId, error: 'No rubric — generate or save one first.' })
      continue
    }
    const criteria = rubric.criteria as unknown as RubricCriterion[]
    const max = rubric.maxPoints ?? c.maxPoints ?? null
    const subs = await readComponentSubmissions(pageId, c, studentIds)
    // Scope the context to this exercise's h1/h2 SECTION, not the whole page: a
    // reasoning model can spiral on a single submission when handed the entire
    // exam (e.g. Part 1's "predict the output" programs derail it) → empty
    // content → request timeout. Falls back to the full page if the section
    // can't be located. See extractComponentContext.
    const componentContext = extractComponentContext(content, c.componentId) ?? content

    await pool(studentIds, CONCURRENCY, async (sid) => {
      const sub = subs.get(sid)
      if (!sub || sub.empty) return // nothing submitted → leave to the check source
      const res = await scoreWithRetry({
        pageContext: componentContext,
        label: c.label,
        criteria,
        submission: sub.text,
        guidance,
      })
      if ('error' in res) {
        errors.push({ componentId: c.componentId, studentId: sid, error: res.error, debug: 'debug' in res ? res.debug : undefined })
        return
      }
      await prisma.componentScore.upsert({
        where: {
          pageId_studentId_componentId_source: {
            pageId,
            studentId: sid,
            componentId: c.componentId,
            source: 'ai',
          },
        },
        create: {
          pageId,
          studentId: sid,
          componentId: c.componentId,
          source: 'ai',
          priority: SCORE_PRIORITY.ai,
          earned: res.earned,
          max,
          feedback: res.feedback,
          meta: { model, rubricId: rubric.id, rubricUpdatedAt: rubric.updatedAt, criteria: res.criteria },
          createdBy: session.user.id,
        },
        update: {
          priority: SCORE_PRIORITY.ai,
          earned: res.earned,
          max,
          feedback: res.feedback,
          meta: { model, rubricId: rubric.id, rubricUpdatedAt: rubric.updatedAt, criteria: res.criteria },
          createdBy: session.user.id,
        },
      })
      results.push({ componentId: c.componentId, studentId: sid, earned: res.earned })

      // If the teacher has per-criterion overrides on this student, re-materialise
      // the override total against the NEW AI score: their edited criteria stay,
      // the rest follow the fresh AI points. (Resolver still reads override.earned.)
      const ov = await prisma.componentScore.findUnique({
        where: { pageId_studentId_componentId_source: { pageId, studentId: sid, componentId: c.componentId, source: 'override' } },
        select: { meta: true },
      })
      const ovCriteria = (ov?.meta as { criteria?: OverrideCriterion[] } | null)?.criteria
      if (Array.isArray(ovCriteria) && ovCriteria.length) {
        await prisma.componentScore.update({
          where: { pageId_studentId_componentId_source: { pageId, studentId: sid, componentId: c.componentId, source: 'override' } },
          data: { earned: mergedCriterionTotal(criteria.map((rc) => rc.id), res.criteria, ovCriteria) },
        })
      }
    })
  }

  return NextResponse.json({ scored: results.length, results, errors })
}

/**
 * Clear one student's AI score for a component (reverts the effective score to
 * the check/override below it). DELETE ?studentId=X&componentId=Y
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId } = await params
  const url = new URL(request.url)
  const studentId = url.searchParams.get('studentId')
  const componentId = url.searchParams.get('componentId')
  if (!studentId || !componentId) {
    return NextResponse.json({ error: 'studentId and componentId required' }, { status: 400 })
  }
  if (!(await isTeacherOfStudentForPage(session.user.id, studentId, pageId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  await prisma.componentScore.deleteMany({ where: { pageId, studentId, componentId, source: 'ai' } })
  return NextResponse.json({ cleared: true })
}
