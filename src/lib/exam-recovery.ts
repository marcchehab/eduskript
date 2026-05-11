/**
 * Shared "apply student snapshots as a hand-in" path, used by both the live
 * hand-in route (POST /api/exams/[pageId]/hand-in) and the offline recovery
 * route (POST /api/exams/recover) so the two stay byte-identical in what
 * they write to the DB.
 *
 * The transaction is all-or-nothing: if any checkpoint insert fails, the
 * ExamSubmission row is rolled back too. Idempotent on (pageId, studentId)
 * via the existing unique constraint — a second call returns the existing
 * submission and only adds new (label-distinguished) checkpoints.
 */

import type { Prisma } from '@prisma/client'
import type { prisma } from '@/lib/prisma'

/**
 * The transactional client type as seen by callbacks of our *extended* Prisma
 * client (the one re-exported from `@/lib/prisma` with the metrics extension).
 * `Prisma.TransactionClient` from `@prisma/client` doesn't match because the
 * extension changes the generated callback signature; inferring it from the
 * extended `$transaction`'s callback parameter is the documented Prisma 7
 * pattern.
 */
type ExtendedTransactionClient =
  Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

export interface HandinSnapshot {
  componentId: string
  payload: unknown
}

export interface ApplyHandinResult {
  submissionId: string
  submittedAt: Date
  alreadyExisted: boolean
  checkpointsInserted: number
}

/**
 * Insert (or no-op on duplicate) the ExamSubmission and write all snapshot
 * checkpoints. Callers wrap this in their own request handler — auth, session
 * validation, and SSE emission live in the route, not here.
 *
 * @param tx — a Prisma transactional client. Pass the result of
 *   `prisma.$transaction(async (tx) => …)`; do not call this with the
 *   top-level client, since the unique-violation handling assumes a
 *   single-transaction view.
 * @param label — appended to each checkpoint so the teacher can tell live
 *   hand-ins apart from offline recovery (default null = live hand-in).
 */
export async function applyHandinSnapshots(
  tx: ExtendedTransactionClient,
  args: {
    pageId: string
    studentId: string
    snapshots: HandinSnapshot[]
    label?: string | null
  },
): Promise<ApplyHandinResult> {
  const { pageId, studentId, snapshots, label } = args

  let alreadyExisted = false
  let submission = await tx.examSubmission.findUnique({
    where: { pageId_studentId: { pageId, studentId } },
  })
  if (submission) {
    alreadyExisted = true
  } else {
    submission = await tx.examSubmission.create({
      data: { pageId, studentId },
    })
  }

  let checkpointsInserted = 0
  if (snapshots.length > 0) {
    const result = await tx.userDataCheckpoint.createMany({
      data: snapshots.map((s) => ({
        userId: studentId,
        pageId,
        componentId: s.componentId,
        kind: 'handin',
        payload: s.payload as Prisma.InputJsonValue,
        label: label ?? 'exam hand-in',
      })),
    })
    checkpointsInserted = result.count
  }

  return {
    submissionId: submission.id,
    submittedAt: submission.submittedAt,
    alreadyExisted,
    checkpointsInserted,
  }
}
