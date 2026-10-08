/**
 * The calling student's exam submissions, newest first. Powers the My Exams
 * dashboard list. Status derived: submitted (handed in, not yet returned) or
 * returned (teacher gave it back). Returned rows carry grade + points from the
 * frozen return snapshot; legacy returns without a snapshot are recomputed live
 * (one computeExamGrades call per such page, same fallback as .../my-grade).
 *
 * GET /api/student/my-exams
 *
 * Site scoping: one row per (page, site) submission — the same exam taken on
 * two sites is two rows, each linking to its own site's /exam route.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computeExamGrades } from '@/lib/scoring/aggregate'
import { getCurrentReturnsForStudent, pageSiteKey } from '@/lib/scoring/return-state'
import { getExamUrl } from '@/lib/scoring/auth'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Return status comes from the exam log (single source of truth), per page.
    const [submissions, returns] = await Promise.all([
      prisma.examSubmission.findMany({
        where: { studentId: session.user.id },
        orderBy: { submittedAt: 'desc' },
        select: {
          pageId: true,
          siteId: true,
          submittedAt: true,
          page: { select: { title: true } },
        },
      }),
      getCurrentReturnsForStudent(session.user.id),
    ])

    const studentId = session.user.id
    const exams = await Promise.all(submissions.map(async (s) => {
      // The returned exam opens read-only in review mode at the exam route of
      // the site it was taken on (null for legacy '' rows / org sites → the
      // dashboard feedback view).
      const url = await getExamUrl(s.pageId, s.siteId)
      const examUrl = url?.startsWith('/exam/') ? url : null
      const ret = returns.get(pageSiteKey(s.pageId, s.siteId))
      let grade = ret?.grade ?? null
      let totalEarned = ret?.totalEarned ?? null
      let totalMax = ret?.totalMax ?? null
      if (ret?.returned && grade === null) {
        const g = (await computeExamGrades(s.pageId, [studentId], new Map([[studentId, s.siteId]]))).byStudent.get(studentId)
        if (g) ({ grade, totalEarned, totalMax } = g)
      }
      return {
        pageId: s.pageId,
        siteId: s.siteId,
        title: s.page.title,
        submittedAt: s.submittedAt,
        returnedAt: ret?.returned ? ret.at : null,
        status: ret?.returned ? 'returned' : 'submitted',
        examUrl,
        grade,
        totalEarned,
        totalMax,
      }
    }))

    return NextResponse.json({ exams })
  } catch (error) {
    console.error('[student/my-exams] GET failed:', error)
    return NextResponse.json({ error: 'Failed to load exams' }, { status: 500 })
  }
}
