/**
 * User Data Sync API
 *
 * POST /api/user-data/sync
 * Batch upsert user data items to the server.
 *
 * For snaps: automatically uploads base64 images to S3 and replaces with URLs
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
}

interface ConflictItem {
  adapter: string
  itemId: string
  serverData: unknown
  serverVersion: number
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

        // Check for existing record first (needed for snap deletion check)
        const existing = await prisma.userData.findUnique({
          where: {
            userId_adapter_itemId: {
              userId,
              adapter: item.adapter,
              itemId: item.itemId,
            },
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
          conflicts.push({
            adapter: item.adapter,
            itemId: item.itemId,
            serverData: existing.data,
            serverVersion: existing.version,
          })
          continue
        }

        // Upsert the data
        await prisma.userData.upsert({
          where: {
            userId_adapter_itemId: {
              userId,
              adapter: item.adapter,
              itemId: item.itemId,
            },
          },
          update: {
            data: parsedData as object,
            version: item.version,
          },
          create: {
            userId,
            adapter: item.adapter,
            itemId: item.itemId,
            data: parsedData as object,
            version: item.version,
          },
        })

        synced.push(`${item.adapter}:${item.itemId}`)

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
      try {
        const memberships = await prisma.classMembership.findMany({
          where: { studentId: userId },
          select: { classId: true }
        })

        const studentPseudonym = session.user.studentPseudonym ?? ''

        for (const submission of quizSubmissions) {
          for (const membership of memberships) {
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

        console.log(`[user-data/sync] Published ${quizSubmissions.length} quiz submissions to ${memberships.length} classes`)
      } catch (eventError) {
        console.error('[user-data/sync] Failed to publish quiz submission events:', eventError)
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
