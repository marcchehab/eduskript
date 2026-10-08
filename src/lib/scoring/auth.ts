/**
 * Class helpers for the exam endpoints. Authorization to see student data is
 * SITE management now (src/lib/scoring/site-scope.ts + src/lib/site-access.ts),
 * not page authorship; these helpers only answer class questions (which of
 * the teacher's classes relate to the exam, is X the class teacher).
 */

import { prisma } from '@/lib/prisma'

/**
 * The teacher's classes for an exam page: those assigned (a class-level ExamState
 * row exists — see lib/exam-state) OR with a member who has submitted this exam.
 * The assigned branch keeps a class visible before anyone submits; the submission
 * branch keeps a class visible after it's set back to hidden while answers still
 * need grading. Shape is `{ id, name }[]`, deduped by the query, name-ordered.
 *
 * Site scoping: with `siteIds`, only assignments/submissions on those sites
 * count (the in-exam toolbar passes its own site; grading passes the viewer's
 * managed scope sites).
 *
 * `ExamSubmission.submittedAt` is non-null, so a row existing == submitted.
 * Limitation: a class only surfaces while a submitting member is still enrolled —
 * if both the assignment and the membership are gone, the ExamSubmission persists
 * but nothing links it back to a class. The submission branch can also
 * over-include a student's *other* classes (ExamSubmission carries no classId to
 * disambiguate); all are the same teacher's, so the teacher just picks the right one.
 */
export async function getExamClassesForTeacher(pageId: string, teacherId: string, siteIds?: string[]) {
  const site = siteIds ? { siteId: { in: siteIds } } : {}
  return prisma.class.findMany({
    where: {
      teacherId,
      OR: [
        { examStates: { some: { pageId, studentId: null, ...site } } },
        { memberships: { some: { student: { examSubmissions: { some: { pageId, ...site } } } } } },
      ],
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

/**
 * The URL a teacher opens to see a student's exam in place, for one site.
 * Personal site → /exam/<siteSlug>/<skriptSlug>/<pageSlug>. Org sites have no
 * /exam route (the org /c/ route renders exam pages inline) →
 * /org/<orgSlug>/c/<skriptSlug>/<pageSlug>. null if unresolved.
 */
export async function getExamUrl(pageId: string, siteId: string | null | undefined): Promise<string | null> {
  if (!siteId) return null
  const [page, site] = await Promise.all([
    prisma.page.findUnique({
      where: { id: pageId },
      select: { slug: true, skript: { select: { slug: true } } },
    }),
    prisma.site.findUnique({ where: { id: siteId }, select: { slug: true, organizationId: true } }),
  ])
  if (!page?.skript?.slug || !site) return null
  if (site.organizationId) return `/org/${site.slug}/c/${page.skript.slug}/${page.slug}`
  return `/exam/${site.slug}/${page.skript.slug}/${page.slug}`
}

/** True if `userId` is the teacher of `classId`. */
export async function isClassTeacher(userId: string, classId: string): Promise<boolean> {
  const c = await prisma.class.findFirst({
    where: { id: classId, teacherId: userId },
    select: { id: true },
  })
  return Boolean(c)
}
