/**
 * Delete a user account together with the content the user chose to remove.
 * Used by DELETE /api/user/account (self-service, teachers and students);
 * getAccountDeletionPreview feeds the dialog (GET /api/user/account) in
 * src/components/dashboard/account-data-card.tsx.
 * Related: purgeDemoUser in src/lib/seed-demo-content.ts (same S3 rules).
 *
 * Two modes, both decided per skript (the authorship unit, see
 * docs/internals/02-permissions.md). "Other author" = a SkriptAuthor /
 * PageAuthor row of another user with permission "author" (viewers don't
 * count and lose access with the content).
 * - "delete":   every skript the user is an author of is deleted, including
 *               skripts shared with other authors. Pages where the user is a
 *               page-level author in someone else's skript are deleted too.
 * - "transfer": only skripts without another author are deleted. Shared
 *               skripts stay with their remaining authors; page-level pages
 *               stay when the page or its skript has another author.
 * Known limitation: a page in a skript the user authors alone is deleted with
 * that skript in both modes, even if another user is a page-level author of
 * it (page-level sharing has no UI, only POST /api/pages/[id]/authors).
 * Collections are owned 1:1 by a Site (no collection authors), so they are
 * deleted with the user's sites in both modes; a kept skript only loses its
 * placement in the user's collections.
 *
 * Order matters:
 * 1. References without onDelete in the schema (PageUnlock.unlockedBy,
 *    ExamSubmission.scoredBy, ExamAuditLog.createdBy) default to RESTRICT and
 *    would block user.delete — cleared first.
 * 2. File.createdBy cascades. Files the user uploaded into skripts that
 *    survive would vanish from their pages, so those rows are handed to one
 *    of the remaining authors (the first one Postgres returns).
 * 3. The chosen skripts and pages are deleted (pages, files, versions and
 *    student data on them cascade). The hidden file-storage skript of an
 *    ORGANIZATION frontpage is never deleted here: the org outlives the user.
 *    Root PageLayoutItems reference skripts without FK → removed explicitly.
 * 4. user.delete cascades the rest (sites → collections, classes, UserData,
 *    exam submissions, subscriptions, OAuth tokens, plugins, …).
 *    PageVersion.authorId / FrontPageVersion.authorId are SET NULL, so the
 *    versions a co-author wrote of a kept page survive (graded exams render
 *    the version handed in: src/lib/scoring/exam-version.ts).
 * 5. ISR: sites placing a deleted skript/page are revalidated (their cached
 *    pages would otherwise keep rendering it).
 * 6. S3: snap objects are deleted one by one from the URLs stored in the
 *    user's "snaps" UserData rows. Not via prefix listing: the user-data
 *    bucket's policy denies ListObjects to our keys (checked 2026-09-23), so
 *    deleteS3Prefix fails there with AccessDenied. Snaps never synced to
 *    UserData have no S3 object in the first place.
 *    files/{hash}.{ext} is content-addressed and shared across users → a blob
 *    is deleted only once no File row anywhere references its hash (checked
 *    after the cascade). If an S3 delete fails the blob leaks (logged); that is
 *    preferred over deleting a blob another teacher's page still renders.
 *
 * Cost: a handful of queries, plus getPlacingSites per deleted skript/page
 * (O(deleted items)) and one count per distinct candidate hash (O(files)).
 * Not atomic with the preview: an author added between preview and delete is
 * respected, because the sets are recomputed at delete time.
 * Plugins (single author) are deleted with the user in both modes; pages of
 * other teachers embedding them then show a missing plugin.
 * Organizations the user owned keep existing without that owner.
 */

import { prisma } from '@/lib/prisma'
import { deleteSnapImage, deleteTeacherFile, isS3Configured, isTeacherS3Configured } from '@/lib/s3'
import { getFileExtension } from '@/lib/file-storage'
import { getPlacingSites, revalidateSkriptOnPlacingSites, type PlacingSite } from '@/lib/site-revalidate'

export type AccountDeletionMode = 'delete' | 'transfer'

export interface CoAuthor {
  name: string | null
  email: string | null
}

export interface SharedItem {
  id: string
  title: string
  coAuthors: CoAuthor[]
}

export interface AccountDeletionPreview {
  /** Skripts the user authors alone — deleted in both modes. */
  soleSkripts: number
  /** Skripts with other authors — deleted in "delete", kept in "transfer". */
  sharedSkripts: SharedItem[]
  /** Page-level authorship in someone else's skript, with other authors on
   *  the page or the skript — deleted in "delete", kept in "transfer". */
  sharedPages: (SharedItem & { skriptTitle: string })[]
  /** Page-level authorship without any other author — deleted in both. */
  solePages: number
}

const otherAuthor = (userId: string) => ({ userId: { not: userId }, permission: 'author' })
const meAuthor = (userId: string) => ({ userId, permission: 'author' })

// Hidden skript holding an organization frontpage's files (see
// src/app/api/frontpage/[id]/ensure-file-storage/route.ts): belongs to the org.
const NOT_ORG_FILE_STORAGE = {
  NOT: { frontPageFileStorage: { is: { site: { is: { organizationId: { not: null } } } } } },
}

function skriptsToDelete(userId: string, mode: AccountDeletionMode) {
  return {
    ...NOT_ORG_FILE_STORAGE,
    authors: mode === 'delete'
      ? { some: meAuthor(userId) }
      : { some: meAuthor(userId), none: otherAuthor(userId) },
  }
}

/** Pages outside the deleted skripts that go anyway (page-level authorship). */
function pagesToDelete(userId: string, mode: AccountDeletionMode, deletedSkriptIds: string[]) {
  return {
    skriptId: { notIn: deletedSkriptIds },
    ...(mode === 'delete'
      ? { authors: { some: meAuthor(userId) } }
      : {
          authors: { some: meAuthor(userId), none: otherAuthor(userId) },
          skript: { authors: { none: otherAuthor(userId) } },
        }),
  }
}

const coAuthorSelect = (userId: string) => ({
  where: otherAuthor(userId),
  select: { user: { select: { name: true, email: true } } },
})

export async function getAccountDeletionPreview(userId: string): Promise<AccountDeletionPreview> {
  const [soleSkripts, shared, pages] = await Promise.all([
    prisma.skript.count({ where: skriptsToDelete(userId, 'transfer') }),
    prisma.skript.findMany({
      where: { ...NOT_ORG_FILE_STORAGE, AND: [{ authors: { some: meAuthor(userId) } }, { authors: { some: otherAuthor(userId) } }] },
      select: { id: true, title: true, authors: coAuthorSelect(userId) },
      orderBy: { title: 'asc' },
    }),
    prisma.page.findMany({
      where: { authors: { some: meAuthor(userId) }, skript: { authors: { none: meAuthor(userId) } } },
      select: {
        id: true,
        title: true,
        authors: coAuthorSelect(userId),
        skript: { select: { title: true, authors: coAuthorSelect(userId) } },
      },
      orderBy: { title: 'asc' },
    }),
  ])

  const sharedPages: AccountDeletionPreview['sharedPages'] = []
  let solePages = 0
  for (const p of pages) {
    const byEmail = new Map<string, CoAuthor>()
    for (const a of [...p.authors, ...p.skript.authors]) byEmail.set(a.user.email ?? a.user.name ?? '', a.user)
    if (byEmail.size === 0) solePages++
    else sharedPages.push({ id: p.id, title: p.title, skriptTitle: p.skript.title, coAuthors: [...byEmail.values()] })
  }

  return {
    soleSkripts,
    sharedSkripts: shared.map((s) => ({ id: s.id, title: s.title, coAuthors: s.authors.map((a) => a.user) })),
    sharedPages,
    solePages,
  }
}

export async function deleteUserAccount(userId: string, mode: AccountDeletionMode = 'transfer'): Promise<void> {
  const snapRows = await prisma.userData.findMany({
    where: { userId, adapter: 'snaps' },
    select: { data: true },
  })
  const snapUrls = snapRows.flatMap((r) =>
    ((r.data as { snaps?: { imageUrl?: string }[] } | null)?.snaps ?? [])
      .map((snap) => snap.imageUrl)
      .filter((u): u is string => !!u && u.includes(`/snaps/${userId}/`)),
  )

  const doomedSkripts = await prisma.skript.findMany({
    where: skriptsToDelete(userId, mode),
    select: { id: true, slug: true, pages: { select: { slug: true } } },
  })
  const doomedSkriptIds = doomedSkripts.map((s) => s.id)
  const doomedPages = await prisma.page.findMany({
    where: pagesToDelete(userId, mode, doomedSkriptIds),
    select: { id: true, slug: true, skriptId: true, skript: { select: { slug: true } } },
  })

  // Surviving skripts (not deleted, another author exists) that hold files by
  // this user.
  const sharedFiles = await prisma.file.findMany({
    where: {
      createdBy: userId,
      skriptId: { notIn: doomedSkriptIds },
      skript: { authors: { some: otherAuthor(userId) } },
    },
    select: {
      skriptId: true,
      skript: { select: { authors: { where: otherAuthor(userId), select: { userId: true }, take: 1 } } },
    },
    distinct: ['skriptId'],
  })

  // Hashes whose blobs may become unreferenced. Over-inclusive on purpose
  // (the user's own uploads incl. handed-over ones): each hash is re-counted
  // after the delete, so an extra candidate costs one count query, nothing more.
  const doomedFiles = await prisma.file.findMany({
    where: {
      isDirectory: false,
      hash: { not: null },
      OR: [{ createdBy: userId }, { skriptId: { in: doomedSkriptIds } }],
    },
    select: { hash: true, name: true },
  })

  // Placing sites must be read BEFORE the delete (collection memberships
  // cascade away), same as deleteSkriptForUser in src/lib/services/skripts.ts.
  const revalidations: { skriptId: string; skriptSlug: string; pageSlugs: string[]; sites: PlacingSite[] }[] = []
  for (const s of doomedSkripts) {
    revalidations.push({ skriptId: s.id, skriptSlug: s.slug, pageSlugs: s.pages.map((p) => p.slug), sites: await getPlacingSites(s.id) })
  }
  for (const p of doomedPages) {
    revalidations.push({ skriptId: p.skriptId, skriptSlug: p.skript.slug, pageSlugs: [p.slug], sites: await getPlacingSites(p.skriptId) })
  }

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
    prisma.page.deleteMany({ where: { id: { in: doomedPages.map((p) => p.id) } } }),
    prisma.skript.deleteMany({ where: { id: { in: doomedSkriptIds } } }),
    prisma.pageLayoutItem.deleteMany({ where: { type: 'skript', contentId: { in: doomedSkriptIds } } }),
    prisma.user.delete({ where: { id: userId } }),
  ])

  for (const r of revalidations) {
    if (r.sites.length === 0) continue
    try {
      await revalidateSkriptOnPlacingSites(r.skriptId, [r.skriptSlug], r.pageSlugs, r.sites)
    } catch (error) {
      console.error(`[account-deletion] revalidation failed (${r.skriptId}):`, String(error).slice(0, 200))
    }
  }

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
    const extension = getFileExtension(file.name)
    if (!extension) continue
    try {
      await deleteTeacherFile(`files/${file.hash}.${extension}`)
    } catch (error) {
      console.error(`[account-deletion] blob purge failed for ${file.hash}:`, String(error).slice(0, 200))
    }
  }
}
