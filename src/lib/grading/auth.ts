/**
 * Authorization helpers for the grading endpoints. Mirror the checks already
 * used by the exam roster (`/api/exams/[pageId]/students`) and student-snapshot
 * routes: the caller must author the page, and for class- or student-scoped
 * actions also teach the relevant class.
 */

import { prisma } from '@/lib/prisma'

/** The page if `userId` is one of its authors, else null. */
export async function getAuthoredExamPage(userId: string, pageId: string) {
  return prisma.page.findFirst({
    where: { id: pageId, authors: { some: { userId } } },
    select: { id: true, skriptId: true, title: true, content: true },
  })
}

/**
 * The /exam/... URL for a page (resolving site + skript + page slugs), so the
 * grading table can link a student to the in-exam view. null if unresolved.
 */
export async function getExamUrl(pageId: string): Promise<string | null> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      slug: true,
      skript: {
        select: {
          slug: true,
          collectionSkripts: {
            take: 1,
            select: { collection: { select: { site: { select: { slug: true } } } } },
          },
        },
      },
    },
  })
  const siteSlug = page?.skript?.collectionSkripts?.[0]?.collection?.site?.slug
  const skriptSlug = page?.skript?.slug
  if (!siteSlug || !skriptSlug || !page?.slug) return null
  return `/exam/${siteSlug}/${skriptSlug}/${page.slug}`
}

/** True if `userId` is the teacher of `classId`. */
export async function isClassTeacher(userId: string, classId: string): Promise<boolean> {
  const c = await prisma.class.findFirst({
    where: { id: classId, teacherId: userId },
    select: { id: true },
  })
  return Boolean(c)
}

/** True if `userId` teaches a class containing `studentId` with `pageId` unlocked. */
export async function isTeacherOfStudentForPage(
  userId: string,
  studentId: string,
  pageId: string,
): Promise<boolean> {
  const membership = await prisma.classMembership.findFirst({
    where: {
      studentId,
      class: { teacherId: userId, pageUnlocks: { some: { pageId } } },
    },
    select: { id: true },
  })
  return Boolean(membership)
}
