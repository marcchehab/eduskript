/**
 * Check if current user has author permission on a page
 * Used for public pages to determine if user can create public annotations
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: pageId } = await params

  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ isPageAuthor: false })
  }

  const userId = session.user.id

  // Check if user is site admin
  if (session.user.isAdmin) {
    return NextResponse.json({ isPageAuthor: true })
  }

  // Check PageAuthor
  const pageAuthor = await prisma.pageAuthor.findFirst({
    where: { pageId, userId, permission: 'author' }
  })
  if (pageAuthor) {
    return NextResponse.json({ isPageAuthor: true })
  }

  // Get page's skript
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { skriptId: true }
  })

  if (!page?.skriptId) {
    return NextResponse.json({ isPageAuthor: false })
  }

  // Page-author rights come from SkriptAuthor only — collection ownership
  // no longer grants page rights (collections are sidebar groupings now).
  const skriptAuthor = await prisma.skriptAuthor.findFirst({
    where: { skriptId: page.skriptId, userId, permission: 'author' }
  })
  return NextResponse.json({ isPageAuthor: !!skriptAuthor })
}
