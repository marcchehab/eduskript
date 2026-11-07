/**
 * Which version of an exam page a student wrote, so grading and viewing use
 * that version instead of the live page (a teacher may edit the page after
 * the exam, e.g. to reuse it next year, and still correct an old exam).
 *
 * ExamSubmission.pageVersion is set when the submission is created
 * (applyHandinSnapshots, src/lib/exam-recovery.ts; copied by the temp-user
 * transfer) to the page's latest PageVersion, if its content equals the live
 * content. Known limitation: an edit DURING the exam is not seen;
 * the student is recorded with the version current at hand-in.
 *
 * Versions referenced here must not change afterwards: updatePageForUser
 * (src/lib/services/pages.ts) does not coalesce inline edits into them.
 *
 * Readers: computeExamGrades (aggregate.ts), the exam route (returned review,
 * teacher grading view via ?v=), the exam archive (src/lib/exam-records.ts).
 */

import { prisma } from '@/lib/prisma'

export interface ExamContent {
  /** null = live page (no recorded or no stored version). */
  version: number | null
  content: string
}

/** Content of `version` of the page, else the live content. null = page gone. */
export async function getExamVersionContent(pageId: string, version: number | null | undefined): Promise<ExamContent | null> {
  if (version != null) {
    const v = await prisma.pageVersion.findUnique({
      where: { pageId_version: { pageId, version } },
      select: { content: true },
    })
    if (v) return { version, content: v.content }
  }
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { content: true } })
  return page ? { version: null, content: page.content } : null
}

/**
 * Per student: the content they handed in (their site's submission), else the
 * live content. 3 queries.
 */
export async function getSubmittedContents(
  pageId: string,
  studentSites: Map<string, string>,
): Promise<{ live: string | null; byStudent: Map<string, ExamContent> }> {
  const studentIds = [...studentSites.keys()]
  const [page, subs] = await Promise.all([
    prisma.page.findUnique({ where: { id: pageId }, select: { content: true } }),
    studentIds.length
      ? prisma.examSubmission.findMany({
          where: { pageId, studentId: { in: studentIds }, siteId: { in: [...new Set(studentSites.values())] }, pageVersion: { not: null } },
          select: { studentId: true, siteId: true, pageVersion: true },
        })
      : Promise.resolve([]),
  ])
  const versionOf = new Map(
    subs
      .filter((s) => s.pageVersion != null && studentSites.get(s.studentId) === s.siteId)
      .map((s) => [s.studentId, s.pageVersion!]),
  )
  const versions = [...new Set(versionOf.values())]
  const rows = versions.length
    ? await prisma.pageVersion.findMany({ where: { pageId, version: { in: versions } }, select: { version: true, content: true } })
    : []
  const contentOf = new Map(rows.map((r) => [r.version, r.content]))

  const byStudent = new Map<string, ExamContent>()
  for (const sid of studentIds) {
    const v = versionOf.get(sid)
    const content = v != null ? contentOf.get(v) : undefined
    if (content !== undefined) byStudent.set(sid, { version: v!, content })
    else if (page) byStudent.set(sid, { version: null, content: page.content })
  }
  return { live: page?.content ?? null, byStudent }
}
