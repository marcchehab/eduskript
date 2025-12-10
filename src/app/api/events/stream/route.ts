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
import { authOptions } from '@/lib/auth'
import { eventBus } from '@/lib/events'
import { prisma } from '@/lib/prisma'

// Force dynamic rendering (no caching)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/events/stream - SSE endpoint for real-time events
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)

  // Require authentication
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Determine channels to subscribe to based on user type
  const channels: string[] = []

  // Always subscribe to user-specific channel
  channels.push(`user:${session.user.id}`)

  // For students, also subscribe to their enrolled classes
  if (session.user.accountType === 'student') {
    try {
      const memberships = await prisma.classMembership.findMany({
        where: { studentId: session.user.id },
        select: { classId: true }
      })

      memberships.forEach(m => {
        channels.push(`class:${m.classId}`)
        channels.push(`class:${m.classId}:students`)
      })

      // Also subscribe via pseudonym for pre-authorized invitations
      if (session.user.studentPseudonym) {
        channels.push(`pseudonym:${session.user.studentPseudonym}`)
      }
    } catch (error) {
      console.error('[SSE] Failed to fetch student classes:', error)
    }
  }

  // For teachers, subscribe to their classes (for quiz submissions, etc.)
  if (session.user.accountType === 'teacher') {
    try {
      const classes = await prisma.class.findMany({
        where: { teacherId: session.user.id, isActive: true },
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

  // Subscribe to all relevant channels
  const unsubscribes = channels.map(channel =>
    eventBus.subscribe(channel, async (event) => {
      try {
        const data = `data: ${JSON.stringify(event)}\n\n`
        await writer.write(encoder.encode(data))
      } catch {
        // Connection closed, ignore write errors
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
