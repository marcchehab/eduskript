/**
 * Delete a user account together with the stored data only it owned.
 * Used by DELETE /api/user/account (self-service, teachers and students).
 * Related: purgeDemoUser in src/lib/seed-demo-content.ts (same S3 rules).
 *
 * Order matters:
 * 1. References without onDelete in the schema (PageUnlock.unlockedBy,
 *    ExamSubmission.scoredBy, ExamAuditLog.createdBy) default to RESTRICT and
 *    would block user.delete — cleared first.
 * 2. File.createdBy cascades. Files the user uploaded into skripts that other
 *    authors keep would vanish from their pages, so those rows are handed to
 *    one of the remaining authors.
 * 3. Skripts where the user is the only "author" are deleted (pages and files
 *    cascade); skriptAuthors alone would leave them as unreachable orphans.
 * 4. user.delete cascades the rest (sites → collections, classes, UserData,
 *    exam submissions, subscriptions, OAuth tokens, …).
 * 5. S3: snap objects are deleted one by one from the URLs stored in the
 *    user's "snaps" UserData rows. Not via prefix listing: the user-data
 *    bucket's policy denies ListObjects to our keys (checked 2026-09-23), so
 *    deleteS3Prefix fails there with AccessDenied. Snaps never synced to
 *    UserData have no S3 object in the first place.
 *    files/{hash}.{ext} is content-addressed and shared across users → a blob
 *    is deleted only once no File row anywhere references its hash (checked
 *    after the cascade). If an S3 delete fails the blob leaks (logged); that is
 *    preferred over deleting a blob another teacher's page still renders.
 *
 * Cost: a handful of queries plus one count per distinct hash — O(files).
 * Organizations the user owned keep existing without that owner.
 */

import { prisma } from '@/lib/prisma'
import { deleteSnapImage, deleteTeacherFile, isS3Configured, isTeacherS3Configured } from '@/lib/s3'

export async function deleteUserAccount(userId: string): Promise<void> {
  const snapRows = await prisma.userData.findMany({
    where: { userId, adapter: 'snaps' },
    select: { data: true },
  })
  const snapUrls = snapRows.flatMap((r) =>
    ((r.data as { snaps?: { imageUrl?: string }[] } | null)?.snaps ?? [])
      .map((snap) => snap.imageUrl)
      .filter((u): u is string => !!u && u.includes(`/snaps/${userId}/`)),
  )

  // Skripts that survive (another "author" exists) and hold files by this user.
  const sharedFiles = await prisma.file.findMany({
    where: {
      createdBy: userId,
      skript: { authors: { some: { userId: { not: userId }, permission: 'author' } } },
    },
    select: {
      skriptId: true,
      skript: {
        select: {
          authors: {
            where: { userId: { not: userId }, permission: 'author' },
            select: { userId: true },
            take: 1,
          },
        },
      },
    },
    distinct: ['skriptId'],
  })

  // Hashes whose blobs may become unreferenced: the user's own uploads outside
  // surviving skripts, plus everything inside skripts that are about to go.
  const doomedFiles = await prisma.file.findMany({
    where: {
      isDirectory: false,
      hash: { not: null },
      OR: [
        {
          createdBy: userId,
          skript: { authors: { none: { userId: { not: userId }, permission: 'author' } } },
        },
        {
          skript: {
            authors: {
              some: { userId, permission: 'author' },
              none: { userId: { not: userId }, permission: 'author' },
            },
          },
        },
      ],
    },
    select: { hash: true, name: true },
  })

  await prisma.$transaction([
    prisma.pageUnlock.deleteMany({ where: { unlockedBy: userId } }),
    prisma.examSubmission.updateMany({ where: { scoredBy: userId }, data: { scoredBy: null } }),
    prisma.examAuditLog.updateMany({ where: { createdBy: userId }, data: { createdBy: null } }),
    ...sharedFiles.map((f) =>
      prisma.file.updateMany({
        where: { skriptId: f.skriptId, createdBy: userId },
        data: { createdBy: f.skript.authors[0].userId },
      }),
    ),
    prisma.skript.deleteMany({
      where: {
        authors: {
          some: { userId, permission: 'author' },
          none: { userId: { not: userId }, permission: 'author' },
        },
      },
    }),
    prisma.user.delete({ where: { id: userId } }),
  ])

  if (isS3Configured()) {
    for (const url of snapUrls) {
      try {
        await deleteSnapImage(url)
      } catch (error) {
        console.error(`[account-deletion] snap delete failed (${url}):`, String(error).slice(0, 200))
      }
    }
  }

  if (!isTeacherS3Configured()) return
  const seen = new Set<string>()
  for (const file of doomedFiles) {
    if (!file.hash || seen.has(file.hash)) continue
    seen.add(file.hash)
    if ((await prisma.file.count({ where: { hash: file.hash } })) > 0) continue
    const extension = file.name.includes('.') ? file.name.split('.').pop()! : ''
    if (!extension) continue
    try {
      await deleteTeacherFile(`files/${file.hash}.${extension}`)
    } catch (error) {
      console.error(`[account-deletion] blob purge failed for ${file.hash}:`, String(error).slice(0, 200))
    }
  }
}
