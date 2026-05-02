/**
 * Student Teacher Broadcast API
 *
 * GET /api/student/teacher-annotations?pageId={pageId}
 * Fetch teacher broadcasts visible to the current student:
 * - Class broadcasts (where student is enrolled)
 * - Individual feedback (targeted at this student)
 *
 * Returns annotations, snaps, and code highlights for each broadcast type.
 *
 * QUERY PATTERN:
 * We run separate queries (could be optimized to fewer with UNION or subqueries):
 * 1. classMembership - get student's enrolled classes
 * 2-5. class broadcasts: annotations, snaps, spacers, sticky-notes
 * 6. class code-highlights-*
 * 7-10. individual: annotations, snaps, spacers, sticky-notes
 * 11. individual code-highlights-*
 *
 * CODE HIGHLIGHTS ADAPTER PATTERN:
 * Unlike annotations/snaps which use fixed adapter names, code highlights use
 * `code-highlights-{editorId}` pattern. We query with `startsWith: 'code-highlights-'`
 * and extract the editorId from the adapter name. This allows multiple code editors
 * per page to have independent highlights.
 *
 * PERFORMANCE: For a student in many classes viewing a page with many broadcasts,
 * this could return significant data. Consider pagination or lazy loading per-editor
 * if this becomes a bottleneck.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { validateExamSession } from '@/lib/exam-tokens'

export async function GET(request: NextRequest) {
  try {
    let userId: string | null = null

    // Try NextAuth session first
    const session = await getServerSession(authOptions)
    if (session?.user?.id) {
      userId = session.user.id
    }

    // If no NextAuth session, try exam session cookie (for SEB mode)
    if (!userId) {
      const cookieStore = await cookies()
      const examSessionCookie = cookieStore.get('exam_session')?.value
      if (examSessionCookie) {
        // For exam session, we need to validate against the skript
        // Get pageId from query params to look up the skript
        const { searchParams } = new URL(request.url)
        const pageId = searchParams.get('pageId')
        if (pageId) {
          const page = await prisma.page.findUnique({
            where: { id: pageId },
            select: { skriptId: true }
          })
          if (page?.skriptId) {
            userId = await validateExamSession(examSessionCookie, page.skriptId)
          }
        }
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get pageId from search params (may have been parsed above for exam session validation)
    const searchParamsForQuery = new URL(request.url).searchParams
    const pageId = searchParamsForQuery.get('pageId')

    if (!pageId) {
      return NextResponse.json(
        { error: 'pageId query parameter is required' },
        { status: 400 }
      )
    }

    // Free-teacher early-return: if the page belongs to a free teacher, no
    // broadcasts can exist (the teacher's sync endpoint returns 402). Skip the
    // 10+ downstream queries and return an empty payload.
    const pageOwner = await prisma.page.findUnique({
      where: { id: pageId },
      select: {
        skript: {
          select: {
            authors: {
              where: { permission: 'author' },
              select: { user: { select: { billingPlan: true } } },
              take: 1,
            },
          },
        },
      },
    })
    const ownerPlan = pageOwner?.skript?.authors[0]?.user?.billingPlan
    if (ownerPlan === 'free') {
      return NextResponse.json({
        classAnnotations: [],
        classSnaps: [],
        classSpacers: [],
        classCodeHighlights: [],
        classStickyNotes: [],
        individualFeedback: null,
        individualSnapFeedback: null,
        individualSpacerFeedback: null,
        individualCodeHighlights: [],
        individualStickyNotes: null,
      })
    }

    // Get all classes the student is enrolled in
    const memberships = await prisma.classMembership.findMany({
      where: { studentId: userId },
      select: {
        classId: true,
        class: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    const classIds = memberships.map(m => m.classId)

    // Fetch class broadcasts for this page from teachers of enrolled classes
    const classAnnotations = await prisma.userData.findMany({
      where: {
        targetType: 'class',
        targetId: { in: classIds },
        adapter: 'annotations',
        itemId: pageId,
      },
      select: {
        targetId: true,
        data: true,
        updatedAt: true,
      },
    })

    // Fetch class snap broadcasts
    const classSnaps = await prisma.userData.findMany({
      where: {
        targetType: 'class',
        targetId: { in: classIds },
        adapter: 'snaps',
        itemId: pageId,
      },
      select: {
        targetId: true,
        data: true,
        updatedAt: true,
      },
    })

    // Fetch class spacer broadcasts
    const classSpacers = await prisma.userData.findMany({
      where: {
        targetType: 'class',
        targetId: { in: classIds },
        adapter: 'spacers',
        itemId: pageId,
      },
      select: {
        targetId: true,
        data: true,
        updatedAt: true,
      },
    })

    // Fetch class sticky notes broadcasts
    const classStickyNotes = await prisma.userData.findMany({
      where: {
        targetType: 'class',
        targetId: { in: classIds },
        adapter: 'sticky-notes',
        itemId: pageId,
      },
      select: {
        targetId: true,
        data: true,
        updatedAt: true,
      },
    })

    // Fetch class code highlights broadcasts (adapter pattern: code-highlights-{id})
    const classCodeHighlights = await prisma.userData.findMany({
      where: {
        targetType: 'class',
        targetId: { in: classIds },
        adapter: { startsWith: 'code-highlights-' },
        itemId: pageId,
      },
      select: {
        targetId: true,
        adapter: true,
        data: true,
        updatedAt: true,
      },
    })

    // Map class annotations with class info, filtering out empty/cleared annotations
    const classAnnotationsWithInfo = classAnnotations
      .filter(annotation => {
        // Skip annotations with empty canvasData (cleared by teacher)
        // Check for both empty string AND empty JSON array
        const data = annotation.data as { canvasData?: string } | null
        return data?.canvasData && data.canvasData.length > 0 && data.canvasData !== '[]'
      })
      .map(annotation => {
        const membership = memberships.find(m => m.classId === annotation.targetId)
        return {
          classId: annotation.targetId,
          className: membership?.class.name ?? 'Unknown Class',
          data: annotation.data,
          updatedAt: annotation.updatedAt.getTime(),
        }
      })

    // Map class snaps with class info, filtering out empty snap arrays
    const classSnapsWithInfo = classSnaps
      .filter(snap => {
        const data = snap.data as { snaps?: unknown[] } | null
        return data?.snaps && data.snaps.length > 0
      })
      .map(snap => {
        const membership = memberships.find(m => m.classId === snap.targetId)
        return {
          classId: snap.targetId,
          className: membership?.class.name ?? 'Unknown Class',
          data: snap.data,
          updatedAt: snap.updatedAt.getTime(),
        }
      })

    // Map class spacers with class info, filtering out empty spacer arrays
    const classSpacersWithInfo = classSpacers
      .filter(spacer => {
        const data = spacer.data as { spacers?: unknown[] } | null
        return data?.spacers && data.spacers.length > 0
      })
      .map(spacer => {
        const membership = memberships.find(m => m.classId === spacer.targetId)
        return {
          classId: spacer.targetId,
          className: membership?.class.name ?? 'Unknown Class',
          data: spacer.data,
          updatedAt: spacer.updatedAt.getTime(),
        }
      })

    // Map class sticky notes with class info, filtering out empty note arrays
    const classStickyNotesWithInfo = classStickyNotes
      .filter(record => {
        const data = record.data as { notes?: unknown[] } | null
        return data?.notes && data.notes.length > 0
      })
      .map(record => {
        const membership = memberships.find(m => m.classId === record.targetId)
        return {
          classId: record.targetId,
          className: membership?.class.name ?? 'Unknown Class',
          data: record.data,
          updatedAt: record.updatedAt.getTime(),
        }
      })

    // Map class code highlights with class info, filtering out empty highlight arrays
    const classCodeHighlightsWithInfo = classCodeHighlights
      .filter(record => {
        const data = record.data as { highlights?: unknown[] } | null
        return data?.highlights && data.highlights.length > 0
      })
      .map(record => {
        const membership = memberships.find(m => m.classId === record.targetId)
        // Extract editor ID from adapter name (e.g., "code-highlights-code-editor" -> "code-editor")
        const editorId = record.adapter.replace('code-highlights-', '')
        return {
          classId: record.targetId,
          className: membership?.class.name ?? 'Unknown Class',
          editorId,
          data: record.data,
          updatedAt: record.updatedAt.getTime(),
        }
      })

    // Fetch individual feedback targeted at this student
    const individualFeedback = await prisma.userData.findFirst({
      where: {
        targetType: 'student',
        targetId: userId,
        adapter: 'annotations',
        itemId: pageId,
      },
      select: {
        data: true,
        updatedAt: true,
        user: {
          select: {
            name: true,
            pageSlug: true,
          },
        },
      },
    })

    // Fetch individual snap feedback targeted at this student
    const individualSnapFeedback = await prisma.userData.findFirst({
      where: {
        targetType: 'student',
        targetId: userId,
        adapter: 'snaps',
        itemId: pageId,
      },
      select: {
        data: true,
        updatedAt: true,
        user: {
          select: {
            name: true,
            pageSlug: true,
          },
        },
      },
    })

    // Fetch individual spacer feedback targeted at this student
    const individualSpacerFeedback = await prisma.userData.findFirst({
      where: {
        targetType: 'student',
        targetId: userId,
        adapter: 'spacers',
        itemId: pageId,
      },
      select: {
        data: true,
        updatedAt: true,
      },
    })

    // Fetch individual sticky notes targeted at this student
    const individualStickyNotes = await prisma.userData.findFirst({
      where: {
        targetType: 'student',
        targetId: userId,
        adapter: 'sticky-notes',
        itemId: pageId,
      },
      select: {
        data: true,
        updatedAt: true,
        user: {
          select: {
            name: true,
            pageSlug: true,
          },
        },
      },
    })

    // Fetch individual code highlight feedback targeted at this student
    const individualCodeHighlights = await prisma.userData.findMany({
      where: {
        targetType: 'student',
        targetId: userId,
        adapter: { startsWith: 'code-highlights-' },
        itemId: pageId,
      },
      select: {
        adapter: true,
        data: true,
        updatedAt: true,
      },
    })

    // Filter out empty individual feedback (cleared by teacher)
    // Check for both empty string AND empty JSON array
    const feedbackData = individualFeedback?.data as { canvasData?: string } | null
    const hasValidFeedback = feedbackData?.canvasData && feedbackData.canvasData.length > 0 && feedbackData.canvasData !== '[]'

    // Filter out empty individual snap feedback
    const snapFeedbackData = individualSnapFeedback?.data as { snaps?: unknown[] } | null
    const hasValidSnapFeedback = snapFeedbackData?.snaps && snapFeedbackData.snaps.length > 0

    // Filter out empty individual spacer feedback
    const spacerFeedbackData = individualSpacerFeedback?.data as { spacers?: unknown[] } | null
    const hasValidSpacerFeedback = spacerFeedbackData?.spacers && spacerFeedbackData.spacers.length > 0

    // Filter out empty individual sticky notes
    const stickyNotesData = individualStickyNotes?.data as { notes?: unknown[] } | null
    const hasValidStickyNotes = stickyNotesData?.notes && stickyNotesData.notes.length > 0

    // Filter and map individual code highlights feedback
    const individualCodeHighlightsWithInfo = individualCodeHighlights
      .filter(record => {
        const data = record.data as { highlights?: unknown[] } | null
        return data?.highlights && data.highlights.length > 0
      })
      .map(record => {
        const editorId = record.adapter.replace('code-highlights-', '')
        return {
          editorId,
          data: record.data,
          updatedAt: record.updatedAt.getTime(),
        }
      })

    // Return with aggressive no-cache headers to ensure students always get fresh data
    // Teacher broadcasts should NEVER be cached on the client - server is always the source of truth
    return NextResponse.json({
      classAnnotations: classAnnotationsWithInfo,
      classSnaps: classSnapsWithInfo,
      classSpacers: classSpacersWithInfo,
      classCodeHighlights: classCodeHighlightsWithInfo,
      classStickyNotes: classStickyNotesWithInfo,
      individualFeedback: individualFeedback && hasValidFeedback
        ? {
            data: individualFeedback.data,
            updatedAt: individualFeedback.updatedAt.getTime(),
            teacherName: individualFeedback.user?.name || individualFeedback.user?.pageSlug || 'Teacher',
          }
        : null,
      individualSnapFeedback: hasValidSnapFeedback && individualSnapFeedback
        ? {
            data: individualSnapFeedback.data,
            updatedAt: individualSnapFeedback.updatedAt.getTime(),
            teacherName: individualSnapFeedback.user?.name || individualSnapFeedback.user?.pageSlug || 'Teacher',
          }
        : null,
      individualSpacerFeedback: hasValidSpacerFeedback && individualSpacerFeedback
        ? {
            data: individualSpacerFeedback.data,
            updatedAt: individualSpacerFeedback.updatedAt.getTime(),
          }
        : null,
      individualCodeHighlights: individualCodeHighlightsWithInfo,
      individualStickyNotes: hasValidStickyNotes && individualStickyNotes
        ? {
            data: individualStickyNotes.data,
            updatedAt: individualStickyNotes.updatedAt.getTime(),
            teacherName: individualStickyNotes.user?.name || individualStickyNotes.user?.pageSlug || 'Teacher',
          }
        : null,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    })
  } catch (error) {
    console.error('[student/teacher-annotations] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
