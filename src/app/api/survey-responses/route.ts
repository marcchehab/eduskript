/**
 * Survey response submission.
 *
 * POST /api/survey-responses (anonymous-allowed) — accepts a batch of answers
 * from a single anonymous visitor for a page that contains a <survey> region.
 *
 * Storage strategy (per the plan in `~/.claude/plans/frolicking-nibbling-key.md`):
 * - Auto-create an implicit Class bound to pageId (isImplicit=true, teacherId=null).
 * - Auto-create a shell student User per sessionId (oauthProvider="survey",
 *   oauthProviderId=sessionId, accountType="student") so the existing student-
 *   pseudonym display chain and the existing /api/classes/[id]/quiz-responses
 *   teacher view work unchanged.
 * - Write one `userData` row per question answer, keyed exactly like the
 *   classroom quiz path (adapter=`quiz-${questionId}`, itemId=pageId).
 *
 * Logged-in users are silently dropped (return 200 skipped). Defence-in-depth
 * with the client-side gate in SurveyProvider.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generatePseudonym } from '@/lib/privacy/pseudonym'
import { RateLimiter, getClientIdentifier } from '@/lib/rate-limit'

const SURVEY_PROVIDER = 'survey'

// Per-IP soft rate limit: 5 distinct survey-response POSTs per hour. Designed
// to deter drive-by abuse, not to act as anti-fraud — determined respondents
// can still rotate IPs/sessions.
const surveyRateLimiter = new RateLimiter('survey-response', {
  interval: 60 * 60 * 1000,
  maxRequests: 5,
})

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SURVEY_REGION_PATTERN = /<survey[\s>]/i
const MAX_ANSWERS_PER_SUBMISSION = 50

interface SurveyAnswerInput {
  questionId: string
  type: 'single' | 'multiple' | 'text' | 'number' | 'range'
  value: unknown
}

interface SurveyResponseBody {
  pageId: string
  sessionId: string
  answers: SurveyAnswerInput[]
}

function isValidBody(body: unknown): body is SurveyResponseBody {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  if (typeof b.pageId !== 'string' || !b.pageId) return false
  if (typeof b.sessionId !== 'string' || !UUID_PATTERN.test(b.sessionId)) return false
  if (!Array.isArray(b.answers)) return false
  if (b.answers.length === 0 || b.answers.length > MAX_ANSWERS_PER_SUBMISSION) return false
  for (const a of b.answers) {
    if (!a || typeof a !== 'object') return false
    const ans = a as Record<string, unknown>
    if (typeof ans.questionId !== 'string' || !ans.questionId) return false
    if (typeof ans.type !== 'string') return false
    if (!['single', 'multiple', 'text', 'number', 'range'].includes(ans.type)) return false
  }
  return true
}

function answerValueToQuizData(a: SurveyAnswerInput): Prisma.InputJsonValue {
  // Mirror the QuizData shape used by the classroom quiz path so the existing
  // /api/classes/[id]/quiz-responses view renders these identically.
  switch (a.type) {
    case 'single':
    case 'multiple':
      return {
        isSubmitted: true,
        selected: Array.isArray(a.value)
          ? (a.value as unknown[]).filter((n): n is number => typeof n === 'number')
          : [],
      }
    case 'text':
      return {
        isSubmitted: true,
        textAnswer: typeof a.value === 'string' ? a.value : '',
      }
    case 'number':
      return {
        isSubmitted: true,
        numberAnswer: typeof a.value === 'number' ? a.value : 0,
      }
    case 'range': {
      const v = (a.value && typeof a.value === 'object') ? a.value as { min?: unknown; max?: unknown } : null
      return {
        isSubmitted: true,
        rangeAnswer: {
          min: typeof v?.min === 'number' ? v.min : 0,
          max: typeof v?.max === 'number' ? v.max : 0,
        },
      }
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as unknown
    if (!isValidBody(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { pageId, sessionId, answers } = body

    // Page must exist and must actually contain a <survey> region. This is
    // the auth gate for anonymous submissions — without it, anyone could
    // POST arbitrary pageIds.
    const page = await prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true, title: true, content: true },
    })
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }
    if (!SURVEY_REGION_PATTERN.test(page.content)) {
      return NextResponse.json({ error: 'Page is not a survey' }, { status: 400 })
    }

    // Logged-in users: silently drop. The client-side provider also gates
    // this, but defence-in-depth — never let an authenticated visitor's
    // answers leak into the anonymous-respondent dataset.
    const session = await getServerSession(authOptions)
    if (session?.user?.id) {
      return NextResponse.json({ skipped: 'authenticated' }, { status: 200 })
    }

    // Soft rate limit per IP. Idempotent retries by same session don't count
    // here (handled by the unique-constraint catch below).
    const ipKey = getClientIdentifier(request)
    const rate = surveyRateLimiter.check(`${ipKey}:${pageId}`)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many submissions; please try again later.', retryAfter: rate.retryAfter },
        { status: 429 }
      )
    }

    // Pseudonym is deterministic from sessionId — same session always
    // produces the same display name. Reuses the student-pseudonym hashing
    // so getStudentDisplayName ("Wise Seneca") works identically.
    const pseudonym = generatePseudonym(sessionId)

    // Single transaction for the whole submission. If anything fails, no
    // partial respondent appears in the dataset.
    await prisma.$transaction(async (tx) => {
      // Implicit class — one per survey-page. Auto-created lazily so pages
      // that never receive responses don't accumulate empty classes.
      const implicitClass = await tx.class.upsert({
        where: { implicitPageId: pageId },
        update: {},
        create: {
          name: `Survey: ${page.title}`,
          description: 'Auto-generated for survey responses. Hidden from teacher class list.',
          // Unique inviteCode required by schema even for implicit classes.
          // Use a deterministic non-shareable value tied to pageId.
          inviteCode: `__survey:${pageId}`,
          allowAnonymous: true,
          isImplicit: true,
          implicitPageId: pageId,
        },
      })

      // Shell user keyed on (oauthProvider="survey", oauthProviderId=sessionId).
      // The User model's @@unique([oauthProvider, oauthProviderId]) at
      // schema.prisma:197 makes this safe across concurrent submissions.
      const shellUser = await tx.user.upsert({
        where: {
          oauthProvider_oauthProviderId: {
            oauthProvider: SURVEY_PROVIDER,
            oauthProviderId: sessionId,
          },
        },
        update: {},
        create: {
          accountType: 'student',
          oauthProvider: SURVEY_PROVIDER,
          oauthProviderId: sessionId,
          studentPseudonym: pseudonym,
        },
      })

      // Class membership for this shell user in the implicit class. The
      // student-roster query in /api/classes/[id]/quiz-responses uses
      // ClassMembership to enumerate respondents.
      await tx.classMembership.upsert({
        where: {
          classId_studentId: {
            classId: implicitClass.id,
            studentId: shellUser.id,
          },
        },
        update: {},
        create: {
          classId: implicitClass.id,
          studentId: shellUser.id,
        },
      })

      // One userData row per answer — keyed the exact same way as the
      // classroom quiz path so the existing teacher view reads them
      // without modification.
      //
      // We use findFirst + update/create rather than upsert because the
      // composite-unique on userData includes nullable targetType/targetId;
      // Postgres treats null != null in unique constraints, so upsert can
      // miss existing rows. Same pattern as /api/user-data/sync line ~280.
      for (const a of answers) {
        const adapter = `quiz-${a.questionId}`
        const existing = await tx.userData.findFirst({
          where: {
            userId: shellUser.id,
            adapter,
            itemId: pageId,
            targetType: null,
            targetId: null,
          },
          select: { id: true },
        })

        if (existing) {
          await tx.userData.update({
            where: { id: existing.id },
            data: { data: answerValueToQuizData(a) },
          })
        } else {
          await tx.userData.create({
            data: {
              userId: shellUser.id,
              adapter,
              itemId: pageId,
              data: answerValueToQuizData(a),
            },
          })
        }
      }
    })

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    // P2002 = unique-constraint violation. Idempotent re-submit of the same
    // session is fine — treat as success so the client shows "already
    // submitted" state without an error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ ok: true, deduplicated: true }, { status: 200 })
    }
    console.error('[API] Survey response submission failed:', err)
    return NextResponse.json({ error: 'Failed to record response' }, { status: 500 })
  }
}
