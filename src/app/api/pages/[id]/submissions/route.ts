/**
 * Page submissions API — one row per user who has any userData on the page.
 *
 * GET /api/pages/[id]/submissions
 *
 * Returns the list of distinct users (including anonymous survey shell users)
 * that have at least one userData row scoped to this page, with an aggregate
 * answer count, last-activity timestamp, exam status, and identity fields for
 * display. Powers the unified teacher page-submissions toolbar.
 *
 * answerCount excludes adapters that aren't "answers" — annotations, snaps,
 * telemetry, and the survey-meta bookkeeping record. Users that only have
 * those rows still appear (count = 0) so a teacher can wipe their state too.
 *
 * Auth: page authors only (resolved via checkPagePermissions, inherits from
 * skript/collection). Anyone else → 403.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPagePermissions } from '@/lib/permissions'

// Adapters that don't count toward "answers given". annotations/snaps/
// telemetry are markup or instrumentation; survey-meta is a per-page
// bookkeeping record written by SurveyProvider. Drafts/state from code
// editors and quiz/sql answers DO count.
const NON_ANSWER_ADAPTERS = new Set(['annotations', 'snaps', 'telemetry', 'survey-meta'])

export interface PageSubmissionRow {
  userId: string
  displayName: string
  email: string | null
  studentPseudonym: string | null
  isAnonymous: boolean
  answerCount: number
  lastActivityAt: string
  examStatus: 'not_started' | 'taking' | 'submitted' | null
  examSubmittedAt: string | null
}

export interface PageSubmissionsResponse {
  /** True when the caller is a page author. The toolbar self-gates on this. */
  isAuthor: boolean
  /** Empty for non-authors (auth gate doubles as data gate). */
  submissions: PageSubmissionRow[]
}

/**
 * Non-authors get `{ isAuthor: false, submissions: [] }` rather than a 403
 * so the client toolbar can mount unconditionally on ISR-cached public pages
 * and self-hide based on the response. Same shape as `/author-check`.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: pageId } = await params

    const empty: PageSubmissionsResponse = { isAuthor: false, submissions: [] }

    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(empty)
    }

    const page = await prisma.page.findUnique({
      where: { id: pageId },
      include: {
        authors: { include: { user: { select: { id: true } } } },
        skript: {
          include: {
            authors: { include: { user: { select: { id: true } } } },
          },
        },
      },
    })

    if (!page) {
      return NextResponse.json(empty)
    }

    const perms = checkPagePermissions(
      session.user.id,
      page.authors,
      page.skript.authors,
      session.user.isAdmin
    )

    if (!perms.canEdit) {
      return NextResponse.json(empty)
    }

    // Pull every userData row for this page. Volume is bounded by page reach;
    // we group in JS rather than via groupBy to keep one round-trip and have
    // adapter strings available for the answer-vs-markup classification.
    const rows = await prisma.userData.findMany({
      where: { itemId: pageId },
      select: {
        userId: true,
        adapter: true,
        updatedAt: true,
      },
    })

    const userIds = Array.from(new Set(rows.map(r => r.userId)))
    if (userIds.length === 0) {
      return NextResponse.json({ isAuthor: true, submissions: [] } satisfies PageSubmissionsResponse)
    }

    const [users, examSubmissions] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          name: true,
          email: true,
          studentPseudonym: true,
          oauthProvider: true,
        },
      }),
      prisma.examSubmission.findMany({
        where: { pageId, studentId: { in: userIds } },
        select: { studentId: true, submittedAt: true },
      }),
    ])

    const submissionByUser = new Map(examSubmissions.map(s => [s.studentId, s]))
    const userById = new Map(users.map(u => [u.id, u]))

    // Aggregate per user: counted answer rows + max(updatedAt) across all rows.
    type Agg = { answerCount: number; lastActivityAt: Date }
    const aggByUser = new Map<string, Agg>()
    for (const row of rows) {
      let agg = aggByUser.get(row.userId)
      if (!agg) {
        agg = { answerCount: 0, lastActivityAt: row.updatedAt }
        aggByUser.set(row.userId, agg)
      }
      if (!NON_ANSWER_ADAPTERS.has(row.adapter)) {
        agg.answerCount += 1
      }
      if (row.updatedAt > agg.lastActivityAt) {
        agg.lastActivityAt = row.updatedAt
      }
    }

    const isExamPage = page.pageType === 'exam'

    const submissions: PageSubmissionRow[] = userIds
      .map(userId => {
        const user = userById.get(userId)
        if (!user) return null // user was deleted but userData survived; skip
        const agg = aggByUser.get(userId)!
        const sub = submissionByUser.get(userId)
        const isAnonymous = user.oauthProvider === 'survey'

        return {
          userId,
          displayName: pickDisplayName(user, isAnonymous),
          email: user.email,
          studentPseudonym: user.studentPseudonym,
          isAnonymous,
          answerCount: agg.answerCount,
          lastActivityAt: agg.lastActivityAt.toISOString(),
          examStatus: isExamPage
            ? (sub ? 'submitted' : 'not_started')
            : null,
          examSubmittedAt: sub?.submittedAt.toISOString() ?? null,
        }
      })
      .filter((r): r is PageSubmissionRow => r !== null)

    return NextResponse.json({ isAuthor: true, submissions } satisfies PageSubmissionsResponse)
  } catch (err) {
    console.error('[API] page submissions failed:', err)
    return NextResponse.json({ error: 'Failed to fetch submissions' }, { status: 500 })
  }
}

function pickDisplayName(
  user: { name: string | null; email: string | null; studentPseudonym: string | null },
  isAnonymous: boolean
): string {
  // DB is the source of truth — don't synthesise a name when the column is
  // null. The signup paths now write a stable nickname at account creation,
  // so a null `name` here means an old/manually-cleared row that should
  // visibly read as missing.
  if (user.name) return user.name
  if (user.email && !isAnonymous) return user.email
  return '—'
}
