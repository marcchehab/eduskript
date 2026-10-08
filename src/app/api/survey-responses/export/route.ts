/**
 * Survey responses CSV export.
 *
 * GET /api/survey-responses/export?pageId=X&siteId=S — returns one CSV row per
 * respondent with one column per question (question IDs derived from the
 * page's current markdown so column order is stable and reproducible).
 *
 * Auth (site scoping, src/lib/site-access.ts): viewer must MANAGE the site
 * (personal owner / org owner+admin); only answers given on that site are
 * exported. Page authorship grants nothing; no superadmin bypass.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canManageSite } from '@/lib/site-access'
import { getStudentDisplayName } from '@/lib/privacy/pseudonym'

interface StoredQuizData {
  isSubmitted?: boolean
  selected?: number[]
  textAnswer?: string
  numberAnswer?: number
  rangeAnswer?: { min: number; max: number }
}

function csvEscape(value: string): string {
  // Wrap in quotes if it contains comma, quote, or newline; double internal quotes
  if (/[",\n\r]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

function answerToCell(d: StoredQuizData | null): string {
  if (!d) return ''
  if (d.textAnswer !== undefined) return d.textAnswer
  if (d.numberAnswer !== undefined) return String(d.numberAnswer)
  if (d.rangeAnswer !== undefined) return `${d.rangeAnswer.min}-${d.rangeAnswer.max}`
  if (d.selected !== undefined) return d.selected.join(';')
  return ''
}

// Extract `<Question id="...">` IDs from page markdown in document order.
// This is the canonical column order; markdown is authoritative even if
// some respondents skipped questions (those cells render as empty).
function extractQuestionIds(content: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const pattern = /<Question\s+[^>]*id=["']([^"']+)["']/gi
  let match
  while ((match = pattern.exec(content)) !== null) {
    const id = match[1]
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const pageId = searchParams.get('pageId')
    const siteId = searchParams.get('siteId')
    if (!pageId || !siteId) {
      return NextResponse.json({ error: 'Missing pageId or siteId' }, { status: 400 })
    }
    if (!(await canManageSite(session.user.id, siteId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const page = await prisma.page.findUnique({
      where: { id: pageId },
      include: {
        implicitSurveyClass: {
          include: {
            memberships: {
              include: {
                student: { select: { id: true, studentPseudonym: true } },
              },
            },
          },
        },
      },
    })

    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    // Question IDs from current markdown — these are the CSV columns.
    const questionIds = extractQuestionIds(page.content)

    // If the survey has never received a submission, the implicit class
    // doesn't exist yet. Return a header-only CSV so the teacher gets a
    // sensible empty export.
    const implicitClass = page.implicitSurveyClass
    const members = implicitClass?.memberships ?? []
    const memberIds = members.map((m) => m.student.id)

    const userData = memberIds.length > 0
      ? await prisma.userData.findMany({
          where: {
            userId: { in: memberIds },
            siteId,
            itemId: pageId,
            adapter: { startsWith: 'quiz-' },
          },
          select: {
            userId: true,
            adapter: true,
            data: true,
            updatedAt: true,
          },
        })
      : []

    // Index userData by (userId, questionId) for lookup while building rows.
    const cellMap = new Map<string, StoredQuizData>()
    let latestUpdateByUser = new Map<string, Date>()
    for (const row of userData) {
      const questionId = row.adapter.replace(/^quiz-/, '')
      cellMap.set(`${row.userId}|${questionId}`, row.data as unknown as StoredQuizData)
      const prev = latestUpdateByUser.get(row.userId)
      if (!prev || row.updatedAt > prev) {
        latestUpdateByUser.set(row.userId, row.updatedAt)
      }
    }

    // The implicit class is per page, shared by every site that shows it —
    // only respondents with answers on THIS site are listed.
    const respondents = members.filter((m) => latestUpdateByUser.has(m.student.id))

    // Build CSV rows
    const headerCols = ['submitted_at', 'pseudonym', 'display_name', ...questionIds]
    const lines: string[] = [headerCols.map(csvEscape).join(',')]

    // Sort respondents by their latest update so the CSV is chronological.
    const sortedRespondents = [...respondents].sort((a, b) => {
      const ta = latestUpdateByUser.get(a.student.id)?.getTime() ?? 0
      const tb = latestUpdateByUser.get(b.student.id)?.getTime() ?? 0
      return ta - tb
    })

    for (const m of sortedRespondents) {
      const pseudonym = m.student.studentPseudonym ?? ''
      const displayName = pseudonym ? getStudentDisplayName(pseudonym) : ''
      const submittedAt = latestUpdateByUser.get(m.student.id)?.toISOString() ?? ''
      const cells = [
        submittedAt,
        pseudonym.slice(0, 12), // truncate the full HMAC hash for legibility
        displayName,
        ...questionIds.map((qid) => answerToCell(cellMap.get(`${m.student.id}|${qid}`) ?? null)),
      ]
      lines.push(cells.map(csvEscape).join(','))
    }

    const csv = lines.join('\n') + '\n'
    const fileName = `survey-${pageId}.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[API] Survey CSV export failed:', err)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
