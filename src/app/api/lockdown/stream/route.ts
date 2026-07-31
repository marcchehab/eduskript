/**
 * Lockdown SSE Stream
 *
 * Pushes LockdownChangeEvent to a logged-in student's open tabs so they reload
 * the moment a teacher toggles lockdown on one of their classes. A reload re-hits
 * the middleware gate (src/proxy.ts): locked → SEB-required screen, unlocked →
 * normal content. Anti-distraction, not security.
 *
 * Subscribes to `lockdown:${classId}` for every class the student belongs to.
 */

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { eventBus } from '@/lib/events'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  // Only students are ever gated, so only they need the watcher stream.
  if (!session?.user?.id || session.user.accountType !== 'student') {
    return new Response(null, { status: 204 })
  }
  const studentId = session.user.id

  const memberships = await prisma.classMembership.findMany({
    where: { studentId },
    select: { classId: true },
  })

  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  const encoder = new TextEncoder()
  let isActive = true

  // A live subscription holds the event bus's LISTEN connection open, which
  // stops the managed Postgres from suspending — so cleanup runs from every
  // path that can end the stream, not only from the abort signal (which does
  // not reliably fire behind the proxy). Same pattern as
  // src/app/api/events/stream/route.ts.
  let pingInterval: ReturnType<typeof setInterval> | undefined
  let maxLifetimeTimer: ReturnType<typeof setTimeout> | undefined
  let unsubscribers: Array<() => void> = []

  const cleanup = () => {
    if (!isActive) return
    isActive = false
    clearInterval(pingInterval)
    clearTimeout(maxLifetimeTimer)
    unsubscribers.forEach((u) => u())
    writer.close().catch(() => { /* already closed */ })
  }

  unsubscribers = memberships.map(({ classId }) =>
    eventBus.subscribe(`lockdown:${classId}`, async (event) => {
      if (!isActive) return
      try {
        await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      } catch {
        cleanup()
      }
    })
  )

  // Initial comment so the connection opens cleanly even with zero classes.
  writer.write(encoder.encode(`: connected\n\n`)).catch(() => { /* ignore */ })

  // Keep-alive ping every 30s.
  pingInterval = setInterval(async () => {
    try {
      await writer.write(encoder.encode(`: ping\n\n`))
    } catch {
      cleanup()
    }
  }, 30000)

  // Backstop for a client that vanishes without an abort or a failed write.
  // EventSource reconnects on its own, so students only see a brief gap.
  maxLifetimeTimer = setTimeout(cleanup, 30 * 60 * 1000)

  request.signal.addEventListener('abort', cleanup)

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
