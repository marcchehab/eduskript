import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPagePermissions } from '@/lib/permissions'
import { stripTeacherContent } from '@/lib/teacher-content'
import { getSkriptFiles } from '@/lib/skript-files.server'

/**
 * GET — the teacher-only parts of a page (lib/teacher-content.ts) for its
 * authors: `<solution teacher>` bodies and `<blank answer>` values as
 * markdown, by slot, plus the skript's files to render them with
 * (components/markdown/teacher-content.tsx). Same check as ../can-edit:
 * page author, or skript author without a page-level override. 403 for
 * everyone else, including students.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id || session.user.accountType === 'student') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const page = await prisma.page.findUnique({
    where: { id },
    include: {
      authors: { include: { user: true } },
      skript: { include: { authors: { include: { user: true } } } },
    },
  })
  if (!page || !checkPagePermissions(session.user.id, page.authors, page.skript.authors).canEdit) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { solutions, answers } = stripTeacherContent(page.content)
  const files = await getSkriptFiles(page.skriptId)
  return NextResponse.json(
    { solutions, answers, files, skriptId: page.skriptId },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
