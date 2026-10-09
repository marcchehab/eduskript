/**
 * Site scope for the teacher side of exams (grading, scoring, snapshots,
 * roster). Replaces the old "caller authors the page" check: under site
 * scoping (src/lib/site-access.ts) student data belongs to the SITE it was
 * produced on, and only the site's managers (personal owner / org
 * owner+admin) may see it. Authorship grants nothing; no superadmin bypass.
 *
 * Grading aggregates every site the viewer manages (one view, not split per
 * site). Each student is graded against ONE site's data — the "student site"
 * resolved below. A student with data for the same exam on two of the
 * viewer's sites is shown with the most recent one (documented limitation;
 * per-student endpoints accept an explicit `siteId` to pick the other).
 *
 * Cost: getExamScope = 3–4 indexed queries; resolveStudentSites = up to 3
 * queries for the whole student list (not per student).
 */

import { prisma } from '@/lib/prisma'
import { getManagedSiteIds, getPlacementSiteIdsForPage } from '@/lib/site-access'
import { getExamClassesForTeacher } from './auth'

export interface ExamScope {
  page: { id: string; skriptId: string; title: string; content: string }
  /** Managed sites this viewer may read exam data from, sorted. */
  siteIds: string[]
}

/**
 * The viewer's grading scope for an exam page: their managed sites that
 * either place the page or already hold exam data for it (a skript removed
 * from a site keeps its data; its manager can still grade it). null → 404.
 */
export async function getExamScope(userId: string, pageId: string): Promise<ExamScope | null> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { id: true, skriptId: true, title: true, content: true },
  })
  if (!page) return null
  const managed = await getManagedSiteIds(userId)
  if (managed.length === 0) return null

  const [placed, withSubmissions, withData] = await Promise.all([
    getPlacementSiteIdsForPage(pageId),
    prisma.examSubmission.findMany({
      where: { pageId, siteId: { in: managed } },
      select: { siteId: true },
      distinct: ['siteId'],
    }),
    prisma.userData.findMany({
      where: { itemId: pageId, siteId: { in: managed } },
      select: { siteId: true },
      distinct: ['siteId'],
    }),
  ])
  const relevant = new Set<string>([
    ...placed,
    ...withSubmissions.map(s => s.siteId),
    ...withData.map(s => s.siteId),
  ])
  const siteIds = managed.filter(id => relevant.has(id)).sort()
  if (siteIds.length === 0) return null
  return { page, siteIds }
}

/**
 * Narrow a scope to an explicit site the client asked for (in-exam teacher
 * view passes the current site). Returns null when the site is not in scope.
 */
export function pickScopeSite(scope: ExamScope, siteId: string | null | undefined): string | null {
  if (!siteId) return null
  return scope.siteIds.includes(siteId) ? siteId : null
}

/**
 * Which of `siteIds` each student is graded on: the site of their latest
 * ExamSubmission, else of their latest user_data row for the page, else of
 * their latest audit-log event, else the first scope site (deterministic).
 */
export async function resolveStudentSites(
  pageId: string,
  studentIds: string[],
  siteIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (studentIds.length === 0 || siteIds.length === 0) return result
  if (siteIds.length === 1) {
    for (const sid of studentIds) result.set(sid, siteIds[0])
    return result
  }

  const [subs, data, audit] = await Promise.all([
    prisma.examSubmission.findMany({
      where: { pageId, studentId: { in: studentIds }, siteId: { in: siteIds } },
      orderBy: { submittedAt: 'desc' },
      select: { studentId: true, siteId: true },
    }),
    prisma.userData.findMany({
      where: { itemId: pageId, userId: { in: studentIds }, siteId: { in: siteIds } },
      orderBy: { updatedAt: 'desc' },
      select: { userId: true, siteId: true },
    }),
    prisma.examAuditLog.findMany({
      where: { pageId, studentId: { in: studentIds }, siteId: { in: siteIds } },
      orderBy: { occurredAt: 'desc' },
      select: { studentId: true, siteId: true },
    }),
  ])
  for (const s of subs) if (!result.has(s.studentId)) result.set(s.studentId, s.siteId)
  for (const d of data) if (!result.has(d.userId)) result.set(d.userId, d.siteId)
  for (const a of audit) if (!result.has(a.studentId)) result.set(a.studentId, a.siteId)
  for (const sid of studentIds) if (!result.has(sid)) result.set(sid, siteIds[0])
  return result
}

/**
 * The students a grading action covers.
 *   classId = a specific class → its members (caller must teach it; returns
 *             null otherwise → 403).
 *   classId = 'all' / missing → members of the teacher's classes related to
 *             the exam on scope sites, PLUS every student with an
 *             ExamSubmission on a scope site (org owners/admins have no
 *             classes — this is how they see org-site submissions).
 */
export async function getGradingStudentIds(
  scope: ExamScope,
  userId: string,
  pageId: string,
  classId: string | null | undefined,
): Promise<string[] | null> {
  if (classId && classId !== 'all') {
    const owned = await prisma.class.findFirst({ where: { id: classId, teacherId: userId }, select: { id: true } })
    if (!owned) return null
    const members = await prisma.classMembership.findMany({ where: { classId }, select: { studentId: true } })
    return [...new Set(members.map(m => m.studentId))]
  }
  const classes = await getExamClassesForTeacher(pageId, userId, scope.siteIds)
  const [members, subs] = await Promise.all([
    classes.length
      ? prisma.classMembership.findMany({ where: { classId: { in: classes.map(c => c.id) } }, select: { studentId: true } })
      : Promise.resolve([] as { studentId: string }[]),
    prisma.examSubmission.findMany({
      where: { pageId, siteId: { in: scope.siteIds } },
      select: { studentId: true },
    }),
  ])
  return [...new Set([...members.map(m => m.studentId), ...subs.map(s => s.studentId)])]
}

/**
 * Per-student teacher gate in one call: the site whose data for (page,
 * student) the caller may read/write, or null (→ 403/404). Explicit siteId
 * must be one of the caller's scope sites.
 */
export async function authorizeStudentSite(
  userId: string,
  pageId: string,
  studentId: string,
  explicitSiteId?: string | null,
): Promise<string | null> {
  const scope = await getExamScope(userId, pageId)
  if (!scope) return null
  return resolveStudentSite(scope, pageId, studentId, explicitSiteId)
}

/** One student's site: explicit (if in scope) or resolved. */
export async function resolveStudentSite(
  scope: ExamScope,
  pageId: string,
  studentId: string,
  explicitSiteId?: string | null,
): Promise<string | null> {
  if (explicitSiteId) return pickScopeSite(scope, explicitSiteId)
  return (await resolveStudentSites(pageId, [studentId], scope.siteIds)).get(studentId) ?? null
}

/**
 * Exam CONTENT (rubrics, grade key) belongs to the page's authors (rule 1).
 * WRITE: page author (PageAuthor 'author', else SkriptAuthor 'author' —
 * checkPagePermissions semantics, no admin bypass). Bughunt #1/#3.
 */
export async function isExamContentAuthor(userId: string, pageId: string): Promise<boolean> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      authors: { select: { userId: true, permission: true } },
      skript: { select: { authors: { select: { userId: true, permission: true } } } },
    },
  })
  if (!page) return false
  const own = (page.authors ?? []).find(a => a.userId === userId)
  if (own) return own.permission === 'author'
  return (page.skript?.authors ?? []).some(a => a.userId === userId && a.permission === 'author')
}

/**
 * READ of exam content needed for grading: authors, plus managers of a site
 * that PLACES the page (they grade with the shared rubric/grade key).
 */
export async function canReadExamContent(userId: string, pageId: string): Promise<boolean> {
  if (await isExamContentAuthor(userId, pageId)) return true
  const [managed, placed] = await Promise.all([getManagedSiteIds(userId), getPlacementSiteIdsForPage(pageId)])
  const placedSet = new Set(placed)
  return managed.some(id => placedSet.has(id))
}
