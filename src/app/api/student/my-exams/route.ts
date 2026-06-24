/**
 * The calling student's exam submissions, newest first. Powers the My Exams
 * dashboard list. Status derived: submitted (handed in, not yet returned) or
 * returned (teacher gave it back — grade visible via .../my-grade).
 *
 * GET /api/student/my-exams
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCurrentReturnsForStudent } from '@/lib/scoring/return-state'

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
          submittedAt: true,
          page: {
            select: {
              title: true,
              slug: true,
              skript: {
                select: {
                  slug: true,
                  collectionSkripts: {
                    take: 1,
                    select: { collection: { select: { site: { select: { slug: true } } } } },
                  },
                },
              },
            },
          },
        },
      }),
      getCurrentReturnsForStudent(session.user.id),
    ])

    const exams = submissions.map((s) => {
      const siteSlug = s.page.skript?.collectionSkripts?.[0]?.collection?.site?.slug
      const skriptSlug = s.page.skript?.slug
      // The returned exam opens read-only in review mode at the exam route.
      const examUrl =
        siteSlug && skriptSlug ? `/exam/${siteSlug}/${skriptSlug}/${s.page.slug}` : null
      const ret = returns.get(s.pageId)
      return {
        pageId: s.pageId,
        title: s.page.title,
        submittedAt: s.submittedAt,
        returnedAt: ret?.returned ? ret.at : null,
        status: ret?.returned ? 'returned' : 'submitted',
        examUrl,
      }
    })

    return NextResponse.json({ exams })
  } catch (error) {
    console.error('[student/my-exams] GET failed:', error)
    return NextResponse.json({ error: 'Failed to load exams' }, { status: 500 })
  }
}
