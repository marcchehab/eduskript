/**
 * Exam State SSE Stream
 *
 * Server-Sent Events endpoint for real-time exam state updates.
 * Works with exam session cookies (for students in SEB) or NextAuth sessions.
 *
 * Subscribes to exam:${pageId}:${classId} channel for state changes.
 */

import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { eventBus } from '@/lib/events'
import { validateExamSession, type ExamSessionData } from '@/lib/exam-tokens'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params
  const { searchParams } = new URL(request.url)
  const classId = searchParams.get('classId')

  if (!classId) {
    return new Response('classId query parameter required', { status: 400 })
  }

  // Authenticate via exam session or NextAuth
  let userId: string | null = null

  // Try exam session first (for students in SEB)
  const cookieStore = await cookies()
  const examSessionCookie = cookieStore.get('exam_session')?.value
  if (examSessionCookie) {
    const sessionData = await validateExamSession(examSessionCookie) as ExamSessionData | null
    if (sessionData) {
      userId = sessionData.userId
    }
  }

  // Fall back to NextAuth session
  if (!userId) {
    const session = await getServerSession(authOptions)
    userId = session?.user?.id || null
  }

  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Verify user has access to this exam (is a class member or teacher)
  const membership = await prisma.classMembership.findFirst({
    where: { classId, studentId: userId }
  })

  const isTeacher = await prisma.class.findFirst({
    where: { id: classId, teacherId: userId }
  })

  if (!membership && !isTeacher) {
    return new Response('Forbidden', { status: 403 })
  }

  // Create SSE stream
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  const encoder = new TextEncoder()

  let isActive = true

  // Subscribe to exam state changes
  const channel = `exam:${pageId}:${classId}`
  const unsubscribe = eventBus.subscribe(channel, async (event) => {
    if (!isActive) return

    try {
      const data = `data: ${JSON.stringify(event)}\n\n`
      await writer.write(encoder.encode(data))
    } catch {
      isActive = false
      unsubscribe()
    }
  })

  // Send initial state (class-level row; null studentId). No row == hidden.
  const currentState = await prisma.examState.findFirst({
    where: { pageId, classId, studentId: null },
    select: { state: true }
  })

  writer.write(encoder.encode(`data: ${JSON.stringify({
    type: 'exam-state-change',
    pageId,
    classId,
    state: currentState?.state || 'hidden',
    timestamp: Date.now()
  })}\n\n`)).catch(() => { /* ignore */ })

  // Keep-alive ping every 30 seconds
  const pingInterval = setInterval(async () => {
    try {
      await writer.write(encoder.encode(`: ping\n\n`))
    } catch {
      clearInterval(pingInterval)
    }
  }, 30000)

  // Cleanup on disconnect
  request.signal.addEventListener('abort', () => {
    isActive = false
    clearInterval(pingInterval)
    unsubscribe()
    writer.close().catch(() => { /* ignore */ })
  })

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
