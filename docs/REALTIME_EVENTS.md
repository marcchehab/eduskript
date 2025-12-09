# Real-Time Event System

Server-Sent Events (SSE) architecture for real-time updates without polling.

## Overview

Replace polling-based updates with server-push notifications. The system supports:
- Class invitation notifications (red dot on auth button)
- Teacher annotation broadcasting to students (Broadcast Mode)
- Quiz submission updates for teachers
- Future: collaboration requests, content updates

## Design Principles

1. **Piggyback on existing saves** - Don't add extra DB queries; broadcast when data is already being persisted
2. **Full state, not deltas** - Send complete data snapshots, same format as DB storage
3. **Leverage existing debouncing** - Annotation system already debounces saves to 2 seconds
4. **Simple client logic** - Students receive same data structure whether loading from DB or SSE

## Architecture

```
┌─────────────┐     POST /api/...          ┌─────────────┐
│   Teacher   │ ──────────────────────────▶│   Server    │
└─────────────┘                            └──────┬──────┘
                                                  │
                                                  │ eventBus.publish()
                                                  ▼
                                           ┌─────────────┐
                                           │  EventBus   │
                                           │ (pluggable) │
                                           └──────┬──────┘
                                                  │
                    ┌─────────────────────────────┼─────────────────────────────┐
                    ▼                             ▼                             ▼
             ┌─────────────┐              ┌─────────────┐              ┌─────────────┐
             │  Student 1  │              │  Student 2  │              │  Student 3  │
             │ (SSE conn)  │              │ (SSE conn)  │              │ (SSE conn)  │
             └─────────────┘              └─────────────┘              └─────────────┘
```

## Event Types

```typescript
// src/lib/events/types.ts
export type AppEvent =
  | { type: 'class-invitation'; classId: string; className: string }
  | { type: 'teacher-annotation'; classId: string; pageId: string; annotation: Annotation }
  | { type: 'quiz-submission'; quizId: string; studentPseudonym: string }
  | { type: 'quiz-started'; classId: string; quizId: string }
  | { type: 'collaboration-request'; fromUserId: string; fromName: string }

export interface Annotation {
  id: string
  sectionId: string
  highlightText?: string
  comment?: string
  color?: string
}
```

## Channel Naming Convention

```typescript
// User-specific (targeted notifications)
`user:${visitorId}`              // visitor-specific events (anonymous)
`user:${session.user.id}`        // logged-in user events

// Class-wide (broadcasts)
`class:${classId}`               // all members see this
`class:${classId}:students`      // students only
`class:${classId}:teacher`       // teacher only

// Resource-specific
`quiz:${quizId}`                 // quiz submissions/state changes
`page:${pageId}`                 // page annotations/updates
```

## Implementation

### 1. EventBus Interface

```typescript
// src/lib/events/types.ts
export interface EventBus {
  publish(channel: string, event: AppEvent): Promise<void>
  subscribe(channel: string, handler: (event: AppEvent) => void): () => void
}
```

### 2. In-Memory Implementation (Phase 1)

```typescript
// src/lib/events/memory-bus.ts
type Handler = (event: AppEvent) => void

class InMemoryEventBus implements EventBus {
  private subscribers = new Map<string, Set<Handler>>()

  async publish(channel: string, event: AppEvent): Promise<void> {
    const handlers = this.subscribers.get(channel)
    if (handlers) {
      handlers.forEach(handler => handler(event))
    }
  }

  subscribe(channel: string, handler: Handler): () => void {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set())
    }
    this.subscribers.get(channel)!.add(handler)

    // Return unsubscribe function
    return () => {
      this.subscribers.get(channel)?.delete(handler)
      if (this.subscribers.get(channel)?.size === 0) {
        this.subscribers.delete(channel)
      }
    }
  }
}

export const memoryEventBus = new InMemoryEventBus()
```

### 3. Factory with Environment Switch

```typescript
// src/lib/events/index.ts
import { EventBus } from './types'
import { memoryEventBus } from './memory-bus'
// import { postgresEventBus } from './postgres-bus'  // Future

export const eventBus: EventBus =
  process.env.EVENT_BUS === 'postgres'
    ? postgresEventBus
    : memoryEventBus

export * from './types'
```

### 4. SSE API Route

```typescript
// src/app/api/events/stream/route.ts
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { eventBus } from '@/lib/events'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)

  // Determine channels based on user type
  const channels: string[] = []

  if (session?.user?.id) {
    channels.push(`user:${session.user.id}`)

    // If student, also subscribe to their classes
    if (session.user.accountType === 'student') {
      const memberships = await getStudentClasses(session.user.id)
      memberships.forEach(m => channels.push(`class:${m.classId}`))
    }
  }

  if (channels.length === 0) {
    return new Response('No channels to subscribe', { status: 400 })
  }

  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  const encoder = new TextEncoder()

  // Subscribe to all relevant channels
  const unsubscribes = channels.map(channel =>
    eventBus.subscribe(channel, async (event) => {
      try {
        await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      } catch {
        // Connection closed
      }
    })
  )

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
    clearInterval(pingInterval)
    unsubscribes.forEach(unsub => unsub())
    writer.close().catch(() => {})
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
```

### 5. Client-Side Hooks

```typescript
// src/hooks/use-realtime-events.ts
'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { AppEvent } from '@/lib/events/types'

type EventType = AppEvent['type']

export function useRealtimeEvents<T extends EventType>(
  eventTypes: T[],
  onEvent: (event: Extract<AppEvent, { type: T }>) => void,
  enabled = true
) {
  const { status } = useSession()
  const eventSourceRef = useRef<EventSource | null>(null)
  const onEventRef = useRef(onEvent)

  // Keep callback ref updated
  onEventRef.current = onEvent

  useEffect(() => {
    if (!enabled || status !== 'authenticated') return

    const eventSource = new EventSource('/api/events/stream')
    eventSourceRef.current = eventSource

    eventSource.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as AppEvent
        if (eventTypes.includes(event.type as T)) {
          onEventRef.current(event as Extract<AppEvent, { type: T }>)
        }
      } catch {
        // Invalid JSON, ignore
      }
    }

    eventSource.onerror = () => {
      // EventSource auto-reconnects, but we could add backoff logic here
    }

    return () => {
      eventSource.close()
      eventSourceRef.current = null
    }
  }, [enabled, status, eventTypes.join(',')])
}
```

```typescript
// src/hooks/use-pending-invitations.ts (updated)
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRealtimeEvents } from './use-realtime-events'

export function usePendingInvitations() {
  const { data: session, status } = useSession()
  const [hasPendingInvitations, setHasPendingInvitations] = useState(false)

  const isStudent = status === 'authenticated' && session?.user?.accountType === 'student'

  // Initial fetch on mount
  useEffect(() => {
    if (!isStudent) return

    fetch('/api/classes/my-classes?checkOnly=true')
      .then(res => res.json())
      .then(data => setHasPendingInvitations(!!data.hasPendingInvitations))
      .catch(() => setHasPendingInvitations(false))
  }, [isStudent])

  // Real-time updates via SSE
  useRealtimeEvents(
    ['class-invitation'],
    () => setHasPendingInvitations(true),
    isStudent
  )

  return hasPendingInvitations
}
```

### 6. Publishing Events

```typescript
// In /api/classes/[id]/bulk-import/route.ts
import { eventBus } from '@/lib/events'

// After creating pre-authorized students:
if (pseudonymsToAdd.length > 0) {
  await prisma.preAuthorizedStudent.createMany({
    data: pseudonymsToAdd.map(pseudonym => ({
      classId,
      pseudonym
    }))
  })

  // Notify each pre-authorized student
  for (const pseudonym of pseudonymsToAdd) {
    await eventBus.publish(`user:student_${pseudonym}@eduskript.local`, {
      type: 'class-invitation',
      classId,
      className: classRecord.name
    })
  }
}
```

## Future: PostgreSQL LISTEN/NOTIFY

When scaling to multiple server instances, swap to Postgres:

```typescript
// src/lib/events/postgres-bus.ts
import { Client } from 'pg'
import { EventBus, AppEvent } from './types'

class PostgresEventBus implements EventBus {
  private client: Client
  private subscribers = new Map<string, Set<(event: AppEvent) => void>>()
  private listening = new Set<string>()

  constructor() {
    this.client = new Client(process.env.DATABASE_URL)
    this.client.connect()

    this.client.on('notification', (msg) => {
      if (!msg.payload) return
      const event = JSON.parse(msg.payload) as AppEvent
      const handlers = this.subscribers.get(msg.channel)
      handlers?.forEach(handler => handler(event))
    })
  }

  async publish(channel: string, event: AppEvent): Promise<void> {
    // Sanitize channel name for Postgres (alphanumeric + underscore only)
    const safeChannel = channel.replace(/[^a-zA-Z0-9_]/g, '_')
    await this.client.query(
      'SELECT pg_notify($1, $2)',
      [safeChannel, JSON.stringify(event)]
    )
  }

  subscribe(channel: string, handler: (event: AppEvent) => void): () => void {
    const safeChannel = channel.replace(/[^a-zA-Z0-9_]/g, '_')

    if (!this.subscribers.has(safeChannel)) {
      this.subscribers.set(safeChannel, new Set())
    }
    this.subscribers.get(safeChannel)!.add(handler)

    // Start listening if not already
    if (!this.listening.has(safeChannel)) {
      this.client.query(`LISTEN "${safeChannel}"`)
      this.listening.add(safeChannel)
    }

    return () => {
      this.subscribers.get(safeChannel)?.delete(handler)
      if (this.subscribers.get(safeChannel)?.size === 0) {
        this.client.query(`UNLISTEN "${safeChannel}"`)
        this.listening.delete(safeChannel)
        this.subscribers.delete(safeChannel)
      }
    }
  }
}

export const postgresEventBus = new PostgresEventBus()
```

Migration is just:
```bash
# .env
EVENT_BUS=postgres
```

## Teacher Annotation Broadcasting (Broadcast Mode)

Teachers can enable "Broadcast Mode" to share their annotations with students in real-time.

### How It Works

The annotation system already debounces saves to every 2 seconds via `useSyncedUserData`.
We piggyback on this existing save to also broadcast:

```
Teacher draws → 2s debounce → Save to DB → Also broadcast via SSE
                                    ↓
                              Single operation, zero extra queries
```

### Data Flow

1. Teacher enables Broadcast Mode for a class
2. Teacher's annotation saves trigger broadcast of full `canvasData`
3. Students receive same data format as DB storage
4. Students joining late load from DB (same format)

### Teacher Side (Sync API Integration)

```typescript
// In /api/user-data/sync/route.ts (or dedicated broadcast endpoint)
// After successfully saving annotation data:

if (broadcastSession?.enabled && item.adapter === 'annotations') {
  await eventBus.publish(`class:${broadcastSession.classId}`, {
    type: 'teacher-annotations-update',
    pageId: item.itemId,
    canvasData: item.data,  // Full stroke data, same as saved to DB
    timestamp: Date.now()
  })
}
```

### Student Side (Receiving)

```typescript
// src/hooks/use-teacher-broadcast.ts
export function useTeacherBroadcast(classId: string, pageId: string) {
  const [teacherAnnotations, setTeacherAnnotations] = useState<string | null>(null)

  // Real-time updates - receives full canvas data
  useRealtimeEvents(
    ['teacher-annotations-update'],
    (event) => {
      if (event.pageId === pageId) {
        // Replace entire canvas data (same format as loading from DB)
        setTeacherAnnotations(event.canvasData)
      }
    }
  )

  return teacherAnnotations
}
```

### Broadcast Mode Toggle

```typescript
// Teacher UI - floating button or class settings
interface BroadcastSession {
  enabled: boolean
  classId: string
  startedAt: number
}

// Teacher enables broadcast for their class
<BroadcastToggle
  classId={classId}
  onEnable={() => setBroadcastSession({ enabled: true, classId, startedAt: Date.now() })}
  onDisable={() => setBroadcastSession(null)}
/>
```

### Latency Characteristics

| Scenario | Latency | Notes |
|----------|---------|-------|
| Normal annotation save | 2s debounce | Existing behavior |
| Broadcast to students | 2s + ~100ms | Piggybacks on save |
| Student joins mid-session | Immediate | Loads from DB |

### Optional: Throttled Real-Time Mode (Future Enhancement)

For lower latency (if 2s feels too slow), add optional 15-20 Hz streaming:

```typescript
// Only if broadcast mode is set to 'realtime'
let pointBuffer: Point[] = []

// Every 50ms (20 Hz) during active drawing
setInterval(() => {
  if (broadcastMode === 'realtime' && pointBuffer.length > 0) {
    eventBus.publish(`class:${classId}`, {
      type: 'stroke-progress',
      points: pointBuffer,
      strokeId: currentStrokeId
    })
    pointBuffer = []
  }
}, 50)
```

This is optional complexity - the 2s debounced approach works well for most teaching scenarios.

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Latency | <100ms typically |
| Bandwidth per event | ~200-500 bytes |
| Connections per class | 30-100 (one per student) |
| Server memory | ~1KB per connection |
| Reconnection | Automatic (EventSource built-in) |

### Limits

- **In-memory bus**: Single server instance only
- **Postgres LISTEN/NOTIFY**: ~8KB payload limit per notification
- **Browser**: ~6 SSE connections per domain (we use 1 multiplexed)

## Files to Create/Modify

### New Files
- `src/lib/events/types.ts` - Event type definitions
- `src/lib/events/memory-bus.ts` - In-memory implementation
- `src/lib/events/index.ts` - Factory export
- `src/app/api/events/stream/route.ts` - SSE endpoint
- `src/hooks/use-realtime-events.ts` - Generic SSE hook

### Modified Files
- `src/hooks/use-pending-invitations.ts` - Use new SSE hook
- `src/app/api/classes/[id]/bulk-import/route.ts` - Publish events

## Testing

```bash
# Terminal 1: Start dev server
pnpm dev

# Terminal 2: Test SSE endpoint (requires auth cookie)
curl -N -H "Cookie: next-auth.session-token=..." \
  http://localhost:3000/api/events/stream

# Terminal 3: Trigger an event (e.g., bulk import)
# Watch Terminal 2 for the event
```
