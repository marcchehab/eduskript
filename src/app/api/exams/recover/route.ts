/**
 * Offline Exam Backup Recovery
 *
 * Teachers upload a student's encrypted .examfile (produced when hand-in
 * failed offline) and the server decrypts it with the teacher's stored
 * private key, then writes the same ExamSubmission + handin checkpoint rows
 * that a live hand-in would have produced.
 *
 * Auth: NextAuth teacher session. The file's embedded keyId must belong to
 * the calling teacher — recovery cannot be triggered by anyone else — AND the
 * caller must manage the site the exam was taken on (site scoping,
 * src/lib/site-access.ts; authorship is not enough). The site comes from the
 * file's meta.siteId; legacy files without it use the caller's first managed
 * site that places the page.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { eventBus } from '@/lib/events'
import { getExamKeyByKeyId } from '@/lib/exam-keys'
import {
  decryptBackupWithPrivateKey,
  type ExamBackupFile,
} from '@/lib/exam-backup'
import { applyHandinSnapshots } from '@/lib/exam-recovery'
import { canManageSite, getManagedSiteIds, getPlacementSiteIdsForPage } from '@/lib/site-access'

function isExamBackupFile(value: unknown): value is ExamBackupFile {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.v !== 1) return false
  if (v.alg !== 'RSA-OAEP-256+AES-256-GCM') return false
  if (typeof v.keyId !== 'string' || !v.keyId) return false
  if (typeof v.wrappedKey !== 'string' || !v.wrappedKey) return false
  if (typeof v.iv !== 'string' || !v.iv) return false
  if (typeof v.ciphertext !== 'string' || !v.ciphertext) return false
  if (!v.meta || typeof v.meta !== 'object') return false
  const meta = v.meta as Record<string, unknown>
  return (
    typeof meta.pageId === 'string' &&
    typeof meta.studentId === 'string' &&
    typeof meta.skriptId === 'string' &&
    typeof meta.createdAt === 'string'
  )
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    const teacherId = session.user.id

    const body = (await request.json().catch(() => null)) as unknown
    if (!isExamBackupFile(body)) {
      return NextResponse.json(
        { error: 'Invalid backup file format' },
        { status: 400 },
      )
    }
    const file = body

    // Look up the keypair by the file's embedded keyId, restricted to the
    // calling teacher's keys. Active or rotated — old backups must still
    // recover after a key rotation.
    const keyRow = await getExamKeyByKeyId(file.keyId, teacherId)
    if (!keyRow) {
      return NextResponse.json(
        { error: 'No matching encryption key found for this backup file' },
        { status: 404 },
      )
    }

    // Decrypt and verify. Throws on auth-tag failure / meta mismatch — those
    // surface as a 400 so the teacher knows the file is bad or not theirs.
    let plaintext: Awaited<ReturnType<typeof decryptBackupWithPrivateKey>>
    try {
      plaintext = await decryptBackupWithPrivateKey(file, keyRow.privateKeyJwk)
    } catch (err) {
      console.error('exam recovery decrypt failed:', err)
      return NextResponse.json(
        { error: 'Backup file could not be decrypted (wrong key or tampered)' },
        { status: 400 },
      )
    }

    // Ensure the page belongs to this teacher. We do this *after* decrypt so
    // the teacher uploading a stranger's file can't fish information about
    // which pages exist — they need the matching private key first.
    const page = await prisma.page.findUnique({
      where: { id: plaintext.meta.pageId },
      select: { id: true, title: true },
    })
    if (!page) {
      return NextResponse.json(
        { error: 'Page referenced by the backup file no longer exists' },
        { status: 404 },
      )
    }
    let siteId = plaintext.meta.siteId ?? ''
    if (!siteId) {
      const [managed, placed] = await Promise.all([
        getManagedSiteIds(teacherId),
        getPlacementSiteIdsForPage(page.id),
      ])
      siteId = managed.filter((id) => placed.includes(id)).sort()[0] ?? ''
    }
    if (!siteId || !(await canManageSite(teacherId, siteId))) {
      return NextResponse.json(
        { error: 'You do not manage the site this exam was taken on' },
        { status: 403 },
      )
    }

    // Sanity check on the student id — we don't gate on class membership here
    // because students may have been removed from the class between exam day
    // and recovery upload, but we do confirm the user exists so we don't
    // dangle ExamSubmission rows pointing at deleted users.
    const student = await prisma.user.findUnique({
      where: { id: plaintext.meta.studentId },
      select: { id: true, accountType: true },
    })
    if (!student) {
      return NextResponse.json(
        { error: 'Student referenced by the backup file no longer exists' },
        { status: 404 },
      )
    }

    const result = await prisma.$transaction(async (tx) => {
      return applyHandinSnapshots(tx, {
        pageId: plaintext.meta.pageId,
        studentId: plaintext.meta.studentId,
        siteId,
        snapshots: plaintext.snapshots,
        label: 'recovered from offline backup',
        source: 'recovery',
      })
    })

    // Mirror the live hand-in SSE so a teacher watching the dashboard sees
    // the student flip to "submitted" the moment recovery completes.
    const membership = await prisma.classMembership.findFirst({
      where: {
        studentId: plaintext.meta.studentId,
        class: { examStates: { some: { pageId: plaintext.meta.pageId, siteId } } },
      },
      select: { classId: true },
    })
    if (membership) {
      await eventBus.publish(
        `exam:${plaintext.meta.pageId}:${membership.classId}`,
        {
          type: 'exam-student-status',
          pageId: plaintext.meta.pageId,
          classId: membership.classId,
          studentId: plaintext.meta.studentId,
          status: 'submitted',
          timestamp: Date.now(),
        },
      )
    }

    return NextResponse.json({
      success: true,
      submissionId: result.submissionId,
      submittedAt: result.submittedAt,
      alreadyExisted: result.alreadyExisted,
      checkpointsInserted: result.checkpointsInserted,
      pageTitle: page.title,
    })
  } catch (error) {
    console.error('Error recovering exam backup:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
