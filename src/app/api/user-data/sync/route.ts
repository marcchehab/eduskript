/**
 * User Data Sync API
 *
 * POST /api/user-data/sync
 * Batch upsert user data items to the server.
 *
 * For snaps: automatically uploads base64 images to S3 and replaces with URLs
 * For teacher broadcasts: saves with targetType/targetId and publishes SSE events
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { uploadSnapImage, deleteSnapImage, isS3Configured } from '@/lib/s3'
import { eventBus } from '@/lib/events'

interface SyncItem {
  adapter: string
  itemId: string
  data: string
  version: number
  updatedAt: number
  // Optional targeting for teacher broadcasts/feedback
  targetType?: 'class' | 'student' | null
  targetId?: string | null
}

interface TeacherBroadcast {
  targetType: 'class' | 'student'
  targetId: string
  pageId: string
  adapter: string
}

interface ConflictItem {
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
  left: number
  width: number
  height: number
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
  questionId: string
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()
    const items: SyncItem[] = body.items

    if (!Array.isArray(items)) {
      return NextResponse.json({ error: 'Invalid request: items must be an array' }, { status: 400 })
    }

    const conflicts: ConflictItem[] = []
    const synced: string[] = []
    const uploadedSnaps: UploadedSnap[] = []
    const s3Errors: string[] = []
    const quizSubmissions: QuizSubmission[] = []
    const teacherBroadcasts: TeacherBroadcast[] = []

    // For targeted items, validate teacher authorization upfront
    const isTeacher = session.user.accountType === 'teacher'
    const targetedItems = items.filter(item => item.targetType && item.targetId)

    if (targetedItems.length > 0 && !isTeacher) {
      return NextResponse.json(
        { error: 'Only teachers can save targeted data' },
        { status: 403 }
      )
    }

    // Validate teacher owns the classes/students for all targeted items
    if (targetedItems.length > 0) {
      const classTargets = targetedItems
        .filter(item => item.targetType === 'class')
        .map(item => item.targetId!)
      const studentTargets = targetedItems
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

        // Debug: log targeting info
        console.log('[user-data/sync] Item:', {
          adapter: item.adapter,
          itemId: item.itemId,
          targetType: item.targetType,
          targetId: item.targetId,
          dataLength: item.data?.length ?? 0
        })

        // Normalize targeting fields (null if not set)
        const targetType = item.targetType || null
        const targetId = item.targetId || null

        // Check for existing record first (needed for snap deletion check)
        // Use findFirst with explicit where clause since targetType/targetId can be null
        const existing = await prisma.userData.findFirst({
          where: {
            userId,
            adapter: item.adapter,
            itemId: item.itemId,
            targetType: targetType,
            targetId: targetId,
          },
        })

        // Special handling for snaps: upload new images to S3 and delete removed ones
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

            parsedData = { snaps: processedSnaps }
          }
        }

        if (existing && existing.version > item.version) {
          // Server has newer version - conflict
          // Include targeting info so client can resolve conflict correctly
          conflicts.push({
            adapter: item.adapter,
            itemId: item.itemId,
            serverData: existing.data,
            serverVersion: existing.version,
            targetType: targetType,
            targetId: targetId,
          })
          continue
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
              adapter: item.adapter,
              itemId: item.itemId,
              data: parsedData as object,
              version: item.version,
              targetType,
              targetId,
            },
          })
        }

        synced.push(`${item.adapter}:${item.itemId}`)

        // Track teacher broadcasts for SSE notification
        console.log('[user-data/sync] After normalization:', { targetType, targetId, adapter: item.adapter })
        if (targetType && targetId) {
          console.log('[user-data/sync] Adding to teacherBroadcasts:', { targetType, targetId, pageId: item.itemId })
          teacherBroadcasts.push({
            targetType: targetType as 'class' | 'student',
            targetId,
            pageId: item.itemId,
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
              questionId: item.adapter
            })
          }
        }
      } catch (error) {
        console.error(`[user-data/sync] Error syncing item ${item.adapter}:${item.itemId}:`, error)
        // Continue with other items
      }
    }

    // Publish SSE events for quiz submissions
    // Notify all classes the student is enrolled in so teachers see real-time updates
    if (quizSubmissions.length > 0 && session.user.accountType === 'student') {
      console.log(`[user-data/sync] Publishing ${quizSubmissions.length} quiz submissions for student ${userId}`)
      try {
        const memberships = await prisma.classMembership.findMany({
          where: { studentId: userId },
          select: { classId: true }
        })

        console.log(`[user-data/sync] Student is in ${memberships.length} classes`)
        const studentPseudonym = session.user.studentPseudonym ?? ''

        for (const submission of quizSubmissions) {
          for (const membership of memberships) {
            console.log(`[user-data/sync] Publishing quiz-submission to class:${membership.classId}:teacher`, {
              pageId: submission.pageId,
              questionId: submission.questionId
            })
            await eventBus.publish(`class:${membership.classId}:teacher`, {
              type: 'quiz-submission',
              classId: membership.classId,
              pageId: submission.pageId,
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

    // Publish SSE events for teacher broadcasts/feedback
    if (teacherBroadcasts.length > 0) {
      console.log('[user-data/sync] Publishing teacher broadcast events:', teacherBroadcasts.length)
      try {
        for (const broadcast of teacherBroadcasts) {
          if (broadcast.targetType === 'class') {
            // Broadcast to entire class
            console.log('[user-data/sync] Publishing to class:', broadcast.targetId, 'pageId:', broadcast.pageId)
            await eventBus.publish(`class:${broadcast.targetId}`, {
              type: 'teacher-annotations-update',
              classId: broadcast.targetId,
              pageId: broadcast.pageId,
              // Don't include full data in event - clients will refetch
              timestamp: Date.now(),
            })
          } else if (broadcast.targetType === 'student') {
            // Individual student feedback
            console.log('[user-data/sync] Publishing to student:', broadcast.targetId, 'pageId:', broadcast.pageId)
            await eventBus.publish(`user:${broadcast.targetId}`, {
              type: 'teacher-feedback',
              studentId: broadcast.targetId,
              pageId: broadcast.pageId,
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

    return NextResponse.json({
      ok: true,
      synced: synced.length,
      conflicts,
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
