/**
 * Transfer a temporary user's exam work to a real student's account — the
 * follow-up to the spare-laptop flow (see /api/classes/[id]/temp-user). After a
 * student finished an exam on a throwaway account, the teacher copies that work
 * onto the student's real account so it grades/returns under their identity.
 *
 * POST /api/teacher/temp-users/[sourceId]/transfer   body: { targetUserId }
 *
 * Auth: teacher session; the SOURCE must be `isTemporary` AND a member of a class
 * the teacher owns; the TARGET must be a student member of *some* class the
 * teacher owns; target != source.
 *
 * Transfers the student's ANSWERS only — NOT any grading/scoring. We copy the
 * live answers (user_data) and hand-in snapshots (user_data_checkpoints), and
 * create a CLEAN submission for the target (marked submitted so you can grade it,
 * but with no score / returnedAt / gradeSnapshot). ComponentScores are NOT copied;
 * you grade the real student fresh.
 *
 * COPY (not move): the source account is left intact as a backup until the
 * teacher deletes it. For every page where the source has an ExamSubmission we
 * copy. Wrapped in one transaction.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{ sourceId: string }>
}

/** True if `studentId` is a member of any class owned by `teacherId`. */
async function isMemberOfTeachersClass(teacherId: string, studentId: string): Promise<boolean> {
  const m = await prisma.classMembership.findFirst({
    where: { studentId, class: { teacherId } },
    select: { id: true },
  })
  return !!m
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { sourceId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const teacherId = session.user.id

    const { targetUserId } = (await request.json().catch(() => ({}))) as { targetUserId?: string }
    if (!targetUserId) {
      return NextResponse.json({ error: 'targetUserId is required' }, { status: 400 })
    }
    if (targetUserId === sourceId) {
      return NextResponse.json({ error: 'Source and target are the same user' }, { status: 400 })
    }

    const source = await prisma.user.findUnique({ where: { id: sourceId }, select: { isTemporary: true } })
    if (!source) return NextResponse.json({ error: 'Source user not found' }, { status: 404 })
    if (!source.isTemporary) {
      return NextResponse.json({ error: 'Source is not a temporary user' }, { status: 400 })
    }
    if (!(await isMemberOfTeachersClass(teacherId, sourceId))) {
      return NextResponse.json({ error: 'Source is not in any of your classes' }, { status: 403 })
    }
    if (!(await isMemberOfTeachersClass(teacherId, targetUserId))) {
      return NextResponse.json({ error: 'Target is not a student in any of your classes' }, { status: 403 })
    }

    // Pages the source actually engaged with (has a submission for).
    const subs = await prisma.examSubmission.findMany({
      where: { studentId: sourceId },
      select: { pageId: true },
    })
    const pageIds = [...new Set(subs.map((s) => s.pageId))]
    if (pageIds.length === 0) {
      return NextResponse.json({ error: 'The temporary user has no submitted exams to transfer.' }, { status: 400 })
    }

    const now = new Date()
    const result = await prisma.$transaction(async (tx) => {
      const counts = { pages: pageIds.length, userData: 0, checkpoints: 0, submissions: 0, audit: 0 }

      for (const pageId of pageIds) {
        // --- exam_submissions (unique [pageId, studentId]) ---
        // Create a CLEAN submission for the target: marked submitted so it's
        // gradeable, but with NO score / scoredAt / returnedAt / gradeSnapshot —
        // we transfer answers, not grading. The teacher grades the real student fresh.
        const srcSub = await tx.examSubmission.findUnique({
          where: { pageId_studentId: { pageId, studentId: sourceId } },
          select: { submittedAt: true },
        })
        if (srcSub) {
          await tx.examSubmission.deleteMany({ where: { pageId, studentId: targetUserId } })
          await tx.examSubmission.create({
            data: { pageId, studentId: targetUserId, submittedAt: srcSub.submittedAt, source: 'transfer' },
          })
          counts.submissions++
        }

        // --- user_data: live answers for this page (unique [userId, adapter, itemId, targetType, targetId]) ---
        const srcData = await tx.userData.findMany({
          where: { userId: sourceId, itemId: pageId, targetType: null },
        })
        for (const d of srcData) {
          await tx.userData.deleteMany({
            where: { userId: targetUserId, adapter: d.adapter, itemId: pageId, targetType: null, targetId: null },
          })
          await tx.userData.create({
            data: {
              userId: targetUserId,
              adapter: d.adapter,
              itemId: d.itemId,
              data: d.data as Prisma.InputJsonValue,
              version: d.version,
              createdAt: d.createdAt, // preserve original timestamps, not the transfer time
            },
          })
          counts.userData++
        }

        // --- user_data_checkpoints (no unique key) ---
        // Replace the target's checkpoints for this page so the transfer is a clean
        // full-replace and IDEMPOTENT: re-transferring (e.g. to fix something) won't
        // pile up duplicate hand-ins. Safe here because the transfer already replaces
        // the target's submission + live answers for this page.
        await tx.userDataCheckpoint.deleteMany({ where: { userId: targetUserId, pageId } })
        const srcCps = await tx.userDataCheckpoint.findMany({ where: { userId: sourceId, pageId } })
        if (srcCps.length) {
          await tx.userDataCheckpoint.createMany({
            // Preserve each checkpoint's ORIGINAL createdAt: the grading version
            // history sorts by it, so collapsing them to the transfer time would
            // hide which snapshot is the hand-in vs an earlier run/check.
            data: srcCps.map((c) => ({
              userId: targetUserId,
              pageId,
              componentId: c.componentId,
              kind: c.kind,
              payload: c.payload as Prisma.InputJsonValue,
              label: c.label ?? 'transferred from temporary account',
              createdAt: c.createdAt,
            })),
          })
          counts.checkpoints += srcCps.length
        }

        // --- exam_audit_logs (no unique key — append a marker so the timeline shows the transfer) ---
        await tx.examAuditLog.create({ data: { pageId, studentId: targetUserId, event: 'submitted', occurredAt: now } })
        counts.audit++
      }

      return counts
    })

    return NextResponse.json({ ok: true, pageIds, ...result })
  } catch (error) {
    console.error('[temp-user transfer] POST failed:', error)
    return NextResponse.json({ error: 'Failed to transfer answers' }, { status: 500 })
  }
}
