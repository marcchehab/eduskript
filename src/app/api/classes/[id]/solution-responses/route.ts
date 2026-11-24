import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkClassSiteRead } from '@/lib/class-site-auth'

interface RouteParams {
  params: Promise<{ id: string }>
}

// Stored per student by <solution> (src/components/markdown/solution.tsx).
interface SolutionData {
  done?: boolean
  opened?: boolean
}

type SolutionStatus = 'done' | 'opened' | 'none'

interface SolutionResponseItem {
  studentId: string
  displayName: string
  status: SolutionStatus
  updatedAt: number | null
}

interface SolutionStats {
  done: number
  opened: number
  none: number
  total: number
}

// GET /api/classes/[id]/solution-responses?pageId=X&componentId=Y&siteId=Z
// Class-wide tally of a <solution>'s "Done" checkbox: done, opened but not
// done, or nothing. Copy of geogebra-responses with another status rule.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: classId } = await params
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const pageId = searchParams.get('pageId')
    const componentId = searchParams.get('componentId')

    if (!pageId || !componentId) {
      return NextResponse.json(
        { error: 'Missing required parameters: pageId and componentId' },
        { status: 400 }
      )
    }

    // Site scoping: answers of ONE site; class teacher must own that site
    // (src/lib/class-site-auth.ts).
    const siteId = searchParams.get('siteId')
    const classRecord = await prisma.class.findUnique({
      where: { id: classId },
      select: { teacherId: true, isImplicit: true, implicitPageId: true }
    })

    if (!classRecord) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }
    const denied = await checkClassSiteRead(session.user.id, classRecord, siteId, pageId)
    if (denied) return denied

    const memberships = await prisma.classMembership.findMany({
      where: { classId },
      include: {
        student: { select: { id: true, name: true, studentPseudonym: true } }
      }
    })

    const studentIds = memberships.map(m => m.student.id)

    const records = await prisma.userData.findMany({
      where: { userId: { in: studentIds }, siteId: siteId!, adapter: componentId, itemId: pageId },
      select: { userId: true, data: true, updatedAt: true }
    })

    const recordMap = new Map(
      records.map(r => [r.userId, { data: r.data as unknown as SolutionData, updatedAt: r.updatedAt }])
    )

    const stats: SolutionStats = { done: 0, opened: 0, none: 0, total: memberships.length }

    const responseItems: SolutionResponseItem[] = memberships.map(m => {
      const record = recordMap.get(m.student.id)
      const data = record?.data
      const status: SolutionStatus = data?.done ? 'done' : data?.opened ? 'opened' : 'none'
      stats[status]++
      return {
        studentId: m.student.id,
        displayName: m.student.name ?? '—',
        status,
        updatedAt: record?.updatedAt ? record.updatedAt.getTime() : null,
      }
    })

    return NextResponse.json({ stats, responses: responseItems })
  } catch (error) {
    console.error('[API] Error fetching solution responses:', error)
    return NextResponse.json({ error: 'Failed to fetch solution responses' }, { status: 500 })
  }
}
