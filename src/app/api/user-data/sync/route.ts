/**
 * User Data Sync API
 *
 * POST /api/user-data/sync
 * Batch upsert user data items to the server.
 *
 * For snaps: automatically uploads base64 images to S3 and replaces with URLs
 * For teacher broadcasts: saves with targetType/targetId and publishes SSE events
 *
 * Site scoping (src/lib/site-access.ts): every item names the site it belongs
 * to. An item is accepted only when its page/front page/skript is PLACED on
 * that site; otherwise it is returned in `rejected` (the client keeps it
 * unsynced, nothing is lost). Writes are keyed (user, site, adapter, item,
 * target). Targeted writes:
 *   - targetType 'page' (public layer): caller must MANAGE the site
 *     (personal owner / org owner+admin). No superadmin bypass, no
 *     authorship grant.
 *   - targetType 'class' | 'student': caller must OWN the (personal) site and
 *     the class / have the student in a class. Org sites have no classes.
 * SEB exam-session writes must target the session's site.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { getSiteAccess, isItemPlacedOnSite, type SiteAccess } from '@/lib/site-access'
import { revalidateItemOnSite } from '@/lib/site-revalidate'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'
import { uploadSnapImage, deleteSnapImage, isS3Configured } from '@/lib/s3'
import { eventBus } from '@/lib/events'

interface SyncItem {
  siteId: string
  adapter: string
  itemId: string
  data: string
  version: number
  updatedAt: number
  // Optional targeting for teacher broadcasts/feedback/public
  targetType?: 'class' | 'student' | 'page' | null
  targetId?: string | null
}

interface TeacherBroadcast {
  targetType: 'class' | 'student'
  targetId: string
  pageId: string
  siteId: string
  adapter: string
}

interface ConflictItem {
  siteId: string
  adapter: string
  itemId: string
  serverData: unknown
  serverVersion: number
  targetType?: string | null
  targetId?: string | null
}

interface SnapData {
  id: string
  name: string
  imageUrl: string
  top: number
  left: number  // Pixels from left edge of paper
  width: number
  height: number
  sectionId?: string  // Section heading ID for vertical repositioning
  sectionOffsetY?: number  // Y offset of section when snap was created
  color?: string     // Header/border tint color (default: 'blue')
  minimized?: boolean // Collapse to titlebar only
}

interface SnapsData {
  snaps: SnapData[]
}

interface UploadedSnap {
  snapId: string
  imageUrl: string
}

interface QuizSubmission {
  pageId: string
  siteId: string
  questionId: string
}

interface RejectedItem {
  siteId: string
  adapter: string
  itemId: string
  targetType?: string | null
  targetId?: string | null
  reason: string
}

export async function POST(request: NextRequest) {
  try {
    let userId: string | null = null
    let isTeacher = false
    // SEB exam session: writes are pinned to the session's site ('' = legacy
    // session from before site scoping → any placed site is accepted).
    let examSessionSiteId: string | null = null

    // Try NextAuth session first
    const session = await getServerSession(authOptions)
    if (session?.user?.id) {
      userId = session.user.id
      isTeacher = session.user.accountType === 'teacher'

      // Free teachers stay IndexedDB-only — no cloud sync, no S3 snaps,
      // no broadcasts. Students inherit their teacher's plan via class
      // membership, so isPaidUser() returns true for them.
      if (isTeacher && !isPaidUser(session.user)) {
        return paidOnlyResponse(
          'Cloud sync is a paid feature. Your data is saved locally on this device.'
        )
      }
    }

    // If no NextAuth session, try exam session cookie (for SEB mode)
    if (!userId) {
      const cookieStore = await cookies()
      const examSessionCookie = cookieStore.get('exam_session')?.value
      if (examSessionCookie) {
        try {
          const examSession = await prisma.examSession.findUnique({
            // The cookie holds the random `sessionId`, NOT the row's primary
            // key `id`. Looking up by `id` always missed → SEB students 401'd
            // and live sync silently failed. Matches validateExamSession().
            where: { sessionId: examSessionCookie },
            select: { userId: true, expiresAt: true, siteId: true }
          })
          if (examSession && new Date(examSession.expiresAt) > new Date()) {
            userId = examSession.userId
            // Exam sessions are for students - they can save personal data but not broadcast
            isTeacher = false
            examSessionSiteId = examSession.siteId
          }
        } catch (error) {
          console.error('[sync] Failed to validate exam session:', error)
        }
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const rawItems: SyncItem[] = body.items

    if (!Array.isArray(rawItems)) {
      return NextResponse.json({ error: 'Invalid request: items must be an array' }, { status: 400 })
    }

    // ---- Site scoping: validate every item's site before anything else ----
    // Per-request memo: a batch usually carries many adapters of one page.
    const rejected: RejectedItem[] = []
    const placementMemo = new Map<string, Promise<boolean>>()
    const accessMemo = new Map<string, Promise<SiteAccess | null>>()
    const placed = (itemId: string, siteId: string) => {
      const k = `${siteId}\u0000${itemId}`
      if (!placementMemo.has(k)) placementMemo.set(k, isItemPlacedOnSite(itemId, siteId))
      return placementMemo.get(k)!
    }
    const access = (siteId: string) => {
      if (!accessMemo.has(siteId)) accessMemo.set(siteId, getSiteAccess(userId, siteId))
      return accessMemo.get(siteId)!
    }
    const reject = (item: SyncItem, reason: string) => rejected.push({
      siteId: item.siteId, adapter: item.adapter, itemId: item.itemId,
      targetType: item.targetType ?? null, targetId: item.targetId ?? null, reason,
    })

    const items: SyncItem[] = []
    for (const item of rawItems) {
      if (!item || typeof item.siteId !== 'string' || !item.siteId) {
        reject(item, 'missing siteId')
        continue
      }
      if (examSessionSiteId && item.siteId !== examSessionSiteId) {
        reject(item, 'exam session is bound to another site')
        continue
      }
      if (!(await placed(item.itemId, item.siteId))) {
        reject(item, 'item is not placed on this site')
        continue
      }
      if (item.targetType === 'page') {
        // Public layer: site managers only. No admin bypass, authorship grants nothing.
        if (!(await access(item.siteId))?.canManage) {
          reject(item, 'only the site owner / org admins can write the public layer')
          continue
        }
      } else if (item.targetType && item.targetId) {
        // Class / student broadcasts: only on the viewer's own personal site
        // (org sites have no classes). Class/student ownership is checked below.
        if (!isTeacher || !(await access(item.siteId))?.isOwner) {
          reject(item, 'class broadcasts are only allowed on your own site')
          continue
        }
      }
      items.push(item)
    }

    const conflicts: ConflictItem[] = []
    const synced: string[] = []
    const uploadedSnaps: UploadedSnap[] = []
    const s3Errors: string[] = []
    const quizSubmissions: QuizSubmission[] = []
    const teacherBroadcasts: TeacherBroadcast[] = []

    // For targeted items, validate authorization upfront
    const classStudentTargetedItems = items.filter(item => item.targetType && item.targetType !== 'page' && item.targetId)

    // Validate teacher owns the classes/students for all class/student targeted items
    if (classStudentTargetedItems.length > 0) {
      const classTargets = classStudentTargetedItems
        .filter(item => item.targetType === 'class')
        .map(item => item.targetId!)
      const studentTargets = classStudentTargetedItems
        .filter(item => item.targetType === 'student')
        .map(item => item.targetId!)

      // Verify teacher owns all targeted classes
      if (classTargets.length > 0) {
        const ownedClasses = await prisma.class.findMany({
          where: {
            id: { in: classTargets },
            teacherId: userId,
          },
          select: { id: true },
        })
        const ownedClassIds = new Set(ownedClasses.map(c => c.id))
        const unauthorizedClasses = classTargets.filter(id => !ownedClassIds.has(id))
        if (unauthorizedClasses.length > 0) {
          return NextResponse.json(
            { error: 'Unauthorized: you do not own all targeted classes' },
            { status: 403 }
          )
        }
      }

      // Verify students are in teacher's classes
      if (studentTargets.length > 0) {
        const teacherClasses = await prisma.class.findMany({
          where: { teacherId: userId },
          select: { id: true },
        })
        const teacherClassIds = teacherClasses.map(c => c.id)

        const studentsInClasses = await prisma.classMembership.findMany({
          where: {
            studentId: { in: studentTargets },
            classId: { in: teacherClassIds },
          },
          select: { studentId: true },
        })
        const authorizedStudentIds = new Set(studentsInClasses.map(s => s.studentId))
        const unauthorizedStudents = studentTargets.filter(id => !authorizedStudentIds.has(id))
        if (unauthorizedStudents.length > 0) {
          return NextResponse.json(
            { error: 'Unauthorized: some students are not in your classes' },
            { status: 403 }
          )
        }
      }
    }

    // Process each item
    for (const item of items) {
      try {
        // Parse the data string to JSON
        let parsedData: unknown
        try {
          parsedData = JSON.parse(item.data)
        } catch {
          parsedData = item.data
        }

        // Normalize targeting fields (null if not set)
        const targetType = item.targetType || null
        const targetId = item.targetId || null

        // Check for existing record first (needed for snap deletion check)
        // Use findFirst with explicit where clause since targetType/targetId can be null
        const existing = await prisma.userData.findFirst({
          where: {
            userId,
            siteId: item.siteId,
            adapter: item.adapter,
            itemId: item.itemId,
            targetType: targetType,
            targetId: targetId,
          },
        })

        if (existing && existing.version > item.version) {
          // Server has newer version - conflict
          // Include targeting info so client can resolve conflict correctly
          conflicts.push({
            siteId: item.siteId,
            adapter: item.adapter,
            itemId: item.itemId,
            serverData: existing.data,
            serverVersion: existing.version,
            targetType: targetType,
            targetId: targetId,
          })
          continue
        }

        // Special handling for snaps: upload new images to S3 and delete removed ones.
        // Runs after the conflict check: a stale write that gets rejected must not
        // delete images of snaps the server row still holds.
        if (item.adapter === 'snaps' && parsedData && typeof parsedData === 'object') {
          const snapsData = parsedData as SnapsData
          if (Array.isArray(snapsData.snaps)) {
            const processedSnaps: SnapData[] = []
            const newSnapIds = new Set(snapsData.snaps.map(s => s.id))

            // Check for deleted snaps and remove from S3
            if (existing?.data && isS3Configured()) {
              const existingSnaps = (existing.data as unknown as SnapsData).snaps || []
              for (const oldSnap of existingSnaps) {
                // If snap was removed and has an S3 URL, delete from bucket
                if (!newSnapIds.has(oldSnap.id) && oldSnap.imageUrl?.includes('s3.')) {
                  try {
                    await deleteSnapImage(oldSnap.imageUrl)
                  } catch (deleteError) {
                    console.error(`[user-data/sync] Failed to delete snap ${oldSnap.id} from S3:`, deleteError)
                    // Continue anyway - orphaned files can be cleaned up later
                  }
                }
              }
            }

            // Upload new snaps with base64 data to S3
            for (const snap of snapsData.snaps) {
              if (snap.imageUrl?.startsWith('data:image/')) {
                if (isS3Configured()) {
                  try {
                    const s3Url = await uploadSnapImage(
                      userId,
                      item.itemId, // pageId
                      snap.id,
                      snap.imageUrl
                    )
                    processedSnaps.push({ ...snap, imageUrl: s3Url })
                    uploadedSnaps.push({ snapId: snap.id, imageUrl: s3Url })
                  } catch (uploadError) {
                    console.error(`[user-data/sync] S3 upload failed for snap ${snap.id}:`, uploadError)
                    s3Errors.push(`Failed to upload snap "${snap.name}" to storage`)
                    processedSnaps.push(snap)
                  }
                } else {
                  processedSnaps.push(snap)
                }
              } else {
                processedSnaps.push(snap)
              }
            }

            parsedData = { ...snapsData, snaps: processedSnaps }
          }
        }

        // Create or update the data with targeting
        // Use create/update pattern since upsert has issues with nullable compound keys
        if (existing) {
          await prisma.userData.update({
            where: { id: existing.id },
            data: {
              data: parsedData as object,
              version: item.version,
            },
          })
        } else {
          await prisma.userData.create({
            data: {
              userId,
              siteId: item.siteId,
              adapter: item.adapter,
              itemId: item.itemId,
              data: parsedData as object,
              version: item.version,
              targetType,
              targetId,
            },
          })
        }

        synced.push(`${item.siteId}:${item.adapter}:${item.itemId}`)

        // Track teacher broadcasts for SSE notification (page-targeted public
        // layer rows are handled by ISR invalidation below, not SSE)
        if (targetType && targetType !== 'page' && targetId) {
          teacherBroadcasts.push({
            targetType: targetType as 'class' | 'student',
            targetId,
            pageId: item.itemId,
            siteId: item.siteId,
            adapter: item.adapter,
          })
        }

        // Track quiz submissions for SSE notification
        // Quiz adapters are formatted as "quiz-{questionId}" and itemId is the pageId
        if (item.adapter.startsWith('quiz-') && parsedData && typeof parsedData === 'object') {
          const quizData = parsedData as { isSubmitted?: boolean }
          if (quizData.isSubmitted) {
            quizSubmissions.push({
              pageId: item.itemId,
              siteId: item.siteId,
              questionId: item.adapter
            })
          }
        }
      } catch (error) {
        // Foreign key violation = user was deleted but session is stale
        if (error instanceof Error && 'code' in error && (error as { code: string }).code === 'P2003') {
          return NextResponse.json({ error: 'User not found. Please sign in again.' }, { status: 401 })
        }
        console.error(`[user-data/sync] Error syncing item ${item.adapter}:${item.itemId}:`, error)
        // Continue with other items
      }
    }

    // Publish SSE events for quiz submissions
    // Notify all classes the student is enrolled in so teachers see real-time updates
    if (quizSubmissions.length > 0 && !isTeacher) {
      try {
        const memberships = await prisma.classMembership.findMany({
          where: { studentId: userId },
          select: { classId: true }
        })
        // Get student pseudonym from database (for exam session case where we don't have session)
        const studentUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { studentPseudonym: true }
        })
        const studentPseudonym = studentUser?.studentPseudonym ?? ''

        for (const submission of quizSubmissions) {
          for (const membership of memberships) {
            await eventBus.publish(`class:${membership.classId}:teacher`, {
              type: 'quiz-submission',
              classId: membership.classId,
              pageId: submission.pageId,
              siteId: submission.siteId,
              questionId: submission.questionId,
              studentPseudonym,
              timestamp: Date.now()
            })
          }
        }

      } catch (err) {
        console.error('[user-data/sync] Failed to publish quiz submission events:', err)
        // Don't fail the sync if event publishing fails
      }
    }

    // Publish SSE events for student annotation updates
    // Notify teachers who may be viewing this student's work
    if (!isTeacher && synced.length > 0) {
      // Get items that were personal saves (not targeted broadcasts)
      const personalItems = items.filter(item => !item.targetType && !item.targetId)

      if (personalItems.length > 0) {
        try {
          // Find all classes this student is in
          const memberships = await prisma.classMembership.findMany({
            where: { studentId: userId },
            select: { classId: true }
          })

          if (memberships.length > 0) {
            // Deduplicate by (site, page) to avoid spamming
            const pageSites = [...new Map(personalItems.map(item => [`${item.siteId}:${item.itemId}`, item])).values()]

            for (const { itemId: pageId, siteId } of pageSites) {
              for (const membership of memberships) {
                await eventBus.publish(`class:${membership.classId}:teacher`, {
                  type: 'student-work-update',
                  studentId: userId,
                  classId: membership.classId,
                  pageId,
                  siteId,
                  timestamp: Date.now()
                })
              }
            }
          }
        } catch (err) {
          console.error('[user-data/sync] Failed to publish student work events:', err)
          // Don't fail the sync if event publishing fails
        }
      }
    }

    // Publish SSE events for teacher broadcasts/feedback
    // Deduplicate broadcasts by targetType+targetId+pageId to avoid spamming students
    // when multiple adapters (e.g., 5 code editors) sync in the same request
    if (teacherBroadcasts.length > 0) {
      const uniqueBroadcasts = new Map<string, typeof teacherBroadcasts[0]>()
      for (const broadcast of teacherBroadcasts) {
        const key = `${broadcast.targetType}:${broadcast.targetId}:${broadcast.siteId}:${broadcast.pageId}`
        // Keep the first occurrence (adapter doesn't matter for notification)
        if (!uniqueBroadcasts.has(key)) {
          uniqueBroadcasts.set(key, broadcast)
        }
      }

      try {
        for (const broadcast of uniqueBroadcasts.values()) {
          if (broadcast.targetType === 'class') {
            // Broadcast to entire class
            await eventBus.publish(`class:${broadcast.targetId}`, {
              type: 'teacher-annotations-update',
              classId: broadcast.targetId,
              pageId: broadcast.pageId,
              siteId: broadcast.siteId,
              // Don't include full data in event - clients will refetch
              timestamp: Date.now(),
            })
          } else if (broadcast.targetType === 'student') {
            // Individual student feedback
            await eventBus.publish(`user:${broadcast.targetId}`, {
              type: 'teacher-feedback',
              studentId: broadcast.targetId,
              pageId: broadcast.pageId,
              siteId: broadcast.siteId,
              adapter: broadcast.adapter,
              timestamp: Date.now(),
            })
          }
        }

      } catch (err) {
        console.error('[user-data/sync] Failed to publish broadcast events:', err)
        // Don't fail the sync if event publishing fails
      }
    }

    // Invalidate ISR cache for page-targeted public layers (drawn annotations,
    // snaps, sticky notes). Each is SSR-prefetched per (page, site) in
    // src/lib/public-page-data.ts and rendered at first paint, so the cached
    // layer data (tag) and the ONE affected site's HTML (path) must be
    // regenerated — otherwise visitors see stale public content.
    const PUBLIC_REVALIDATING_ADAPTERS = new Set(['annotations', 'snaps', 'sticky-notes'])
    const pageAnnotationItems = items.filter(
      item => item.targetType === 'page'
        && PUBLIC_REVALIDATING_ADAPTERS.has(item.adapter)
        && synced.includes(`${item.siteId}:${item.adapter}:${item.itemId}`)
    )

    if (pageAnnotationItems.length > 0) {
      try {
        // Drop the cached public layers first — getPublicLayers() keys on this
        // tag and caches forever. Independent of the path revalidation below.
        const pageIds = [...new Set(pageAnnotationItems.map(item => item.itemId))]
        for (const pageId of pageIds) {
          revalidateTag(CACHE_TAGS.page(pageId), { expire: 0 })
        }
        const pairs = [...new Map(pageAnnotationItems.map(i => [`${i.siteId}:${i.itemId}`, i])).values()]
        for (const { itemId, siteId } of pairs) {
          await revalidateItemOnSite(itemId, siteId)
        }
      } catch (err) {
        console.error('[user-data/sync] Failed to invalidate ISR cache:', err)
        // Don't fail the sync if cache invalidation fails
      }
    }

    return NextResponse.json({
      ok: true,
      synced: synced.length,
      conflicts,
      // Items refused by site scoping. The client keeps them unsynced locally.
      rejected: rejected.length > 0 ? rejected : undefined,
      uploadedSnaps: uploadedSnaps.length > 0 ? uploadedSnaps : undefined,
      s3Errors: s3Errors.length > 0 ? s3Errors : undefined,
    })
  } catch (error) {
    console.error('[user-data/sync] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
