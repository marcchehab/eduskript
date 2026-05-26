/**
 * Server-Sent Events (SSE) Stream Endpoint
 *
 * Provides real-time event streaming to authenticated clients.
 * Automatically subscribes to relevant channels based on user type.
 *
 * Usage:
 *   const eventSource = new EventSource('/api/events/stream')
 *   eventSource.onmessage = (msg) => console.log(JSON.parse(msg.data))
 */

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { authOptions } from '@/lib/auth'
import { eventBus } from '@/lib/events'
import { prisma } from '@/lib/prisma'
import { validateExamSession } from '@/lib/exam-tokens'

// Force dynamic rendering (no caching)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/events/stream - SSE endpoint for real-time events
 */
export async function GET(request: NextRequest) {
  let userId: string | null = null
  let userAccountType: 'teacher' | 'student' | undefined = undefined
  let userPseudonym: string | null = null

  // Try NextAuth session first
  const session = await getServerSession(authOptions)
  if (session?.user?.id) {
    userId = session.user.id
    userAccountType = session.user.accountType as 'teacher' | 'student' | undefined
    userPseudonym = session.user.studentPseudonym ?? null
  }

  // If no NextAuth session, try exam session cookie (for SEB mode)
  // For SSE, we don't have a pageId, so we validate against any active exam session
  if (!userId) {
    const cookieStore = await cookies()
    const examSessionCookie = cookieStore.get('exam_session')?.value
    if (examSessionCookie) {
      // Decode the exam session to get the skript ID
      try {
        const examSession = await prisma.examSession.findUnique({
          // Cookie holds `sessionId` (random hex), not the row PK `id`.
          where: { sessionId: examSessionCookie },
          select: { userId: true, skriptId: true, expiresAt: true }
        })
        if (examSession && new Date(examSession.expiresAt) > new Date()) {
          userId = examSession.userId
          // Exam sessions are for students
          userAccountType = 'student'
          // Get student pseudonym for class channels
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { studentPseudonym: true }
          })
          userPseudonym = user?.studentPseudonym ?? null
        }
      } catch (error) {
        console.error('[SSE] Failed to validate exam session:', error)
      }
    }
  }

  // Require authentication
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Determine channels to subscribe to based on user type
  const channels: string[] = []

  // Always subscribe to user-specific channel
  channels.push(`user:${userId}`)

  // For students, also subscribe to their enrolled classes
  if (userAccountType === 'student') {
    try {
      const memberships = await prisma.classMembership.findMany({
        where: { studentId: userId },
        select: { classId: true }
      })

      memberships.forEach(m => {
        channels.push(`class:${m.classId}`)
        channels.push(`class:${m.classId}:students`)
      })

      // Also subscribe via pseudonym for pre-authorized invitations
      if (userPseudonym) {
        channels.push(`pseudonym:${userPseudonym}`)
      }
    } catch (error) {
      console.error('[SSE] Failed to fetch student classes:', error)
    }
  }

  // For teachers, subscribe to their classes (for quiz submissions, etc.)
  if (userAccountType === 'teacher') {
    try {
      const classes = await prisma.class.findMany({
        where: { teacherId: userId, isActive: true },
        select: { id: true }
      })

      classes.forEach(c => {
        channels.push(`class:${c.id}`)
        channels.push(`class:${c.id}:teacher`)
      })
    } catch (error) {
      console.error('[SSE] Failed to fetch teacher classes:', error)
    }
  }

  if (channels.length === 0) {
    return new Response('No channels to subscribe', { status: 400 })
  }

  // Create SSE stream
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  const encoder = new TextEncoder()

  // Track if connection is still active
  let isActive = true

  // Subscribe to all relevant channels
  const unsubscribes = channels.map(channel =>
    eventBus.subscribe(channel, async (event) => {
      if (!isActive) {
        return
      }
      try {
        const data = `data: ${JSON.stringify(event)}\n\n`
        await writer.write(encoder.encode(data))
      } catch {
        isActive = false
        // Connection closed, unsubscribe
        unsubscribes.forEach(unsub => unsub())
      }
    })
  )

  // Keep-alive ping every 30 seconds (prevents proxy timeouts)
  const pingInterval = setInterval(async () => {
    try {
      await writer.write(encoder.encode(`: ping\n\n`))
    } catch {
      // Connection closed
      clearInterval(pingInterval)
    }
  }, 30000)

  // Send initial connected message
  writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'connected', channels: channels.length })}\n\n`))
    .catch(() => { /* ignore */ })

  // Cleanup on client disconnect
  request.signal.addEventListener('abort', () => {
    isActive = false
    clearInterval(pingInterval)
    unsubscribes.forEach(unsub => unsub())
    writer.close().catch(() => { /* ignore */ })
  })

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',  // Disable nginx buffering
    },
  })
}
