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
import { revalidatePath } from 'next/cache'
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
  // Optional targeting for teacher broadcasts/feedback/public
  targetType?: 'class' | 'student' | 'page' | null
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

/**
 * Check if user has author permission on a page (directly or via skript/collection)
 */
async function canCreatePageAnnotations(userId: string, pageId: string, isAdmin?: boolean): Promise<boolean> {
  // Site admins can always create page annotations
  if (isAdmin) return true

  // Check PageAuthor
  const pageAuthor = await prisma.pageAuthor.findFirst({
    where: { pageId, userId, permission: 'author' }
  })
  if (pageAuthor) return true

  // Get the page with its skript
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { skriptId: true }
  })

  if (!page?.skriptId) return false

  // Check SkriptAuthor (inherits to pages)
  const skriptAuthor = await prisma.skriptAuthor.findFirst({
    where: { skriptId: page.skriptId, userId, permission: 'author' }
  })
  if (skriptAuthor) return true

  // Check CollectionAuthor via CollectionSkript (inherits to skripts and pages)
  const collectionSkripts = await prisma.collectionSkript.findMany({
    where: { skriptId: page.skriptId },
    select: { collectionId: true }
  })
  if (collectionSkripts.length > 0) {
    const collectionIds = collectionSkripts.map(cs => cs.collectionId).filter((id): id is string => id !== null)
    if (collectionIds.length > 0) {
      const collectionAuthor = await prisma.collectionAuthor.findFirst({
        where: {
          collectionId: { in: collectionIds },
          userId,
          permission: 'author'
        }
      })
      if (collectionAuthor) return true
    }
  }

  return false
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

    // For targeted items, validate authorization upfront
    const isTeacher = session.user.accountType === 'teacher'
    const targetedItems = items.filter(item => item.targetType && item.targetId)
    const pageTargetedItems = items.filter(item => item.targetType === 'page')
    const classStudentTargetedItems = items.filter(item => item.targetType && item.targetType !== 'page' && item.targetId)

    // Class/student targeting requires teacher role
    if (classStudentTargetedItems.length > 0 && !isTeacher) {
      return NextResponse.json(
        { error: 'Only teachers can save class/student targeted data' },
        { status: 403 }
      )
    }

    // Page targeting requires author permission on the page
    if (pageTargetedItems.length > 0) {
      const isAdmin = session.user.isAdmin
      for (const item of pageTargetedItems) {
        const canCreate = await canCreatePageAnnotations(userId, item.itemId, isAdmin)
        if (!canCreate) {
          return NextResponse.json(
            { error: 'You do not have author permission on this page' },
            { status: 403 }
          )
        }
      }
    }

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

    // Invalidate ISR cache for page-targeted annotations
    // This ensures public annotations are visible to other visitors
    const pageAnnotationItems = items.filter(
      item => item.targetType === 'page' && item.adapter === 'annotations' && synced.includes(`${item.adapter}:${item.itemId}`)
    )

    if (pageAnnotationItems.length > 0) {
      console.log('[user-data/sync] Invalidating ISR cache for page annotations:', pageAnnotationItems.length)
      try {
        // Get all unique pageIds that were updated
        const pageIds = [...new Set(pageAnnotationItems.map(item => item.itemId))]

        // Look up page paths for cache invalidation
        for (const pageId of pageIds) {
          // First try to find it as a regular page
          const page = await prisma.page.findUnique({
            where: { id: pageId },
            select: {
              slug: true,
              skript: {
                select: {
                  slug: true,
                  collectionSkripts: {
                    select: {
                      collection: {
                        select: {
                          slug: true,
                          authors: {
                            select: {
                              user: {
                                select: { pageSlug: true }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          })

          if (page?.skript) {
            const skriptSlug = page.skript.slug
            const contentPageSlug = page.slug

            // Invalidate paths for all collections this skript is in
            for (const cs of page.skript.collectionSkripts) {
              if (!cs.collection) continue
              const collectionSlug = cs.collection.slug

              // Invalidate for all authors' domains
              for (const author of cs.collection.authors) {
                const userPageSlug = author.user.pageSlug
                if (userPageSlug) {
                  const path = `/${userPageSlug}/${collectionSlug}/${skriptSlug}/${contentPageSlug}`
                  console.log('[user-data/sync] Revalidating path:', path)
                  revalidatePath(path)
                }
              }
            }

            // Also check if page is accessible via any organization
            // Get collection IDs from the skript
            const collectionIds = page.skript.collectionSkripts
              .filter(cs => cs.collection)
              .map(cs => cs.collection!.slug)

            if (collectionIds.length > 0) {
              const orgLayouts = await prisma.orgPageLayout.findMany({
                where: {
                  items: {
                    some: {
                      OR: [
                        { type: 'collection', contentId: { in: collectionIds } },
                        { type: 'skript', contentId: page.skript.slug }
                      ]
                    }
                  }
                },
                select: {
                  organization: { select: { slug: true } }
                }
              })

              for (const orgLayout of orgLayouts) {
                // Invalidate org page paths for all collections
                for (const cs of page.skript.collectionSkripts) {
                  if (!cs.collection) continue
                  const orgPath = `/org/${orgLayout.organization.slug}/c/${cs.collection.slug}/${skriptSlug}/${contentPageSlug}`
                  console.log('[user-data/sync] Revalidating org path:', orgPath)
                  revalidatePath(orgPath)
                }
              }
            }
            continue // Handled as regular page, skip front page check
          }

          // Not a regular page - check if it's a front page
          const frontPage = await prisma.frontPage.findUnique({
            where: { id: pageId },
            select: {
              userId: true,
              organizationId: true,
              skriptId: true,
              user: { select: { pageSlug: true } },
              organization: { select: { slug: true } },
              skript: {
                select: {
                  slug: true,
                  collectionSkripts: {
                    select: {
                      collection: {
                        select: {
                          slug: true,
                          authors: {
                            select: {
                              user: { select: { pageSlug: true } }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          })

          if (frontPage) {
            // User front page: /{pageSlug}
            if (frontPage.userId && frontPage.user?.pageSlug) {
              const path = `/${frontPage.user.pageSlug}`
              console.log('[user-data/sync] Revalidating user front page:', path)
              revalidatePath(path)
            }

            // Organization front page: /org/{orgSlug}
            if (frontPage.organizationId && frontPage.organization?.slug) {
              const path = `/org/${frontPage.organization.slug}`
              console.log('[user-data/sync] Revalidating org front page:', path)
              revalidatePath(path)
            }

            // Skript front page: /{pageSlug}/{collectionSlug}/{skriptSlug}
            if (frontPage.skriptId && frontPage.skript) {
              const skriptSlug = frontPage.skript.slug
              for (const cs of frontPage.skript.collectionSkripts) {
                if (!cs.collection) continue
                const collectionSlug = cs.collection.slug

                // Invalidate for all authors' domains
                for (const author of cs.collection.authors) {
                  const userPageSlug = author.user.pageSlug
                  if (userPageSlug) {
                    const path = `/${userPageSlug}/${collectionSlug}/${skriptSlug}`
                    console.log('[user-data/sync] Revalidating skript front page:', path)
                    revalidatePath(path)
                  }
                }
              }

              // Also check orgs that have this skript in their layout
              const orgLayouts = await prisma.orgPageLayout.findMany({
                where: {
                  items: {
                    some: { type: 'skript', contentId: skriptSlug }
                  }
                },
                select: {
                  organization: { select: { slug: true } }
                }
              })

              for (const orgLayout of orgLayouts) {
                for (const cs of frontPage.skript.collectionSkripts) {
                  if (!cs.collection) continue
                  const orgPath = `/org/${orgLayout.organization.slug}/c/${cs.collection.slug}/${skriptSlug}`
                  console.log('[user-data/sync] Revalidating org skript front page:', orgPath)
                  revalidatePath(orgPath)
                }
              }
            }
          }
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
