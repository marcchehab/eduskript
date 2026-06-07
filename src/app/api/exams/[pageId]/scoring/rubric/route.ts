/**
 * Scoring rubrics for an exam page (step 1 of AI scoring).
 *
 * GET    ?componentId=X | (none)  → the rubric for one component, or all on the page
 * POST   { componentId? , all? }  → AI-generate rubric(s) and save (source="ai")
 * PUT    { componentId, criteria, maxPoints? } → save a teacher-edited rubric (source="teacher")
 * DELETE ?componentId=X           → discard a rubric
 *
 * Page-level: gated on the teacher having authored the exam page. Generation
 * samples a few of the teacher's students' submissions to calibrate criteria.
 * The rubric only ever describes POINTS (Punkte) — never a grade.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'
import { getAuthoredExamPage } from '@/lib/scoring/auth'
import { parseGradableComponents } from '@/lib/scoring/components'
import { readComponentSubmissions } from '@/lib/scoring/submissions'
import { generateRubric, scoringModel, type RubricCriterion, type AiDebug } from '@/lib/ai/scoring'
import { loadAiGuidance } from '@/lib/ai/guidance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SAMPLE_SIZE = 5

/** Student ids the teacher teaches for this page (one query). */
async function teacherStudentIds(userId: string, pageId: string): Promise<string[]> {
  const rows = await prisma.classMembership.findMany({
    where: { class: { teacherId: userId, pageUnlocks: { some: { pageId } } } },
    select: { studentId: true },
  })
  return [...new Set(rows.map((r) => r.studentId))]
}

function sumPoints(criteria: RubricCriterion[]): number {
  return Math.round(criteria.reduce((s, c) => s + c.points, 0) * 10) / 10
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId } = await params
  if (!(await getAuthoredExamPage(session.user.id, pageId))) {
    return NextResponse.json({ error: 'Page not found or access denied' }, { status: 404 })
  }
  const componentId = new URL(request.url).searchParams.get('componentId')
  const rubrics = await prisma.scoringRubric.findMany({
    where: { pageId, ...(componentId ? { componentId } : {}) },
  })
  return NextResponse.json({ rubrics })
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
  const { componentId, componentIds, all } = body as {
    componentId?: string
    componentIds?: string[]
    all?: boolean
  }

  const content = (page as { content?: string }).content ?? ''
  const allComponents = parseGradableComponents(content)
  const wanted = componentIds && componentIds.length ? new Set(componentIds) : null
  const targets = all
    ? allComponents
    : wanted
      ? allComponents.filter((c) => wanted.has(c.componentId))
      : allComponents.filter((c) => c.componentId === componentId)
  if (targets.length === 0) {
    return NextResponse.json({ error: 'No matching gradable component' }, { status: 400 })
  }

  const studentIds = await teacherStudentIds(session.user.id, pageId)
  const guidance = await loadAiGuidance(session.user.id)
  const model = scoringModel()
  const saved: unknown[] = []
  // `debug` carries raw model output / finishReason on a parse failure → browser
  // console when the teacher enables the `scoring:*` debug namespace (see panel).
  const errors: { componentId: string; error: string; debug?: AiDebug }[] = []

  for (const c of targets) {
    const subs = await readComponentSubmissions(pageId, c, studentIds)
    const samples = [...subs.values()].filter((s) => !s.empty).slice(0, SAMPLE_SIZE).map((s) => s.text)
    const maxPoints = c.maxPoints ?? 1
    const res = await generateRubric({
      pageContext: content,
      label: c.label,
      maxPoints,
      reference: c.kind === 'python' ? c.checkCode ?? null : null,
      starterCode: c.kind === 'python' ? c.starterCode ?? null : null,
      samples,
      guidance,
    })
    if ('error' in res) {
      errors.push({ componentId: c.componentId, error: res.error, debug: 'debug' in res ? res.debug : undefined })
      continue
    }
    const row = await prisma.scoringRubric.upsert({
      where: { pageId_componentId: { pageId, componentId: c.componentId } },
      create: {
        pageId,
        componentId: c.componentId,
        criteria: res.criteria,
        maxPoints: sumPoints(res.criteria),
        source: 'ai',
        model,
        createdBy: session.user.id,
      },
      update: {
        criteria: res.criteria,
        maxPoints: sumPoints(res.criteria),
        source: 'ai',
        model,
        createdBy: session.user.id,
      },
    })
    saved.push(row)
  }

  return NextResponse.json({ rubrics: saved, errors })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId } = await params
  if (!(await getAuthoredExamPage(session.user.id, pageId))) {
    return NextResponse.json({ error: 'Page not found or access denied' }, { status: 404 })
  }
  const body = await request.json().catch(() => ({}))
  const { componentId, criteria } = body as {
    componentId?: string
    criteria?: Array<{ id?: string; description?: string; points?: number }>
  }
  if (!componentId || !Array.isArray(criteria)) {
    return NextResponse.json({ error: 'componentId and criteria are required' }, { status: 400 })
  }
  // The inline regex (if any) lives in `description`, so it's preserved verbatim.
  const clean: RubricCriterion[] = criteria
    .map((c, i) => ({
      id: c.id || `c${i + 1}`,
      description: typeof c.description === 'string' ? c.description : '',
      points: Number(c.points),
    }))
    .filter((c) => c.description && Number.isFinite(c.points))

  const row = await prisma.scoringRubric.upsert({
    where: { pageId_componentId: { pageId, componentId } },
    create: {
      pageId,
      componentId,
      criteria: clean,
      maxPoints: sumPoints(clean),
      source: 'teacher',
      createdBy: session.user.id,
    },
    update: { criteria: clean, maxPoints: sumPoints(clean), source: 'teacher', createdBy: session.user.id },
  })
  return NextResponse.json({ rubric: row })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId } = await params
  if (!(await getAuthoredExamPage(session.user.id, pageId))) {
    return NextResponse.json({ error: 'Page not found or access denied' }, { status: 404 })
  }
  const componentId = new URL(request.url).searchParams.get('componentId')
  if (!componentId) return NextResponse.json({ error: 'componentId required' }, { status: 400 })
  await prisma.scoringRubric.deleteMany({ where: { pageId, componentId } })
  return NextResponse.json({ cleared: true })
}
