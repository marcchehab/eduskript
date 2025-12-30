# Real-Time Events

Server-Sent Events (SSE) for push notifications without polling.

## Architecture

```
Teacher saves → Server → EventBus → SSE → Students
```

## Event Types

```typescript
type AppEvent =
  | { type: 'class-invitation'; classId: string; className: string }
  | { type: 'teacher-annotation'; classId: string; pageId: string; annotation: Annotation }
  | { type: 'quiz-submission'; quizId: string; studentPseudonym: string }
  | { type: 'collaboration-request'; fromUserId: string; fromName: string }
```

## Channel Naming

| Pattern | Use |
|---------|-----|
| `user:${userId}` | User-specific notifications |
| `class:${classId}` | Class-wide broadcasts |
| `class:${classId}:students` | Students only |
| `quiz:${quizId}` | Quiz state changes |

## Publishing Events

```typescript
import { eventBus } from '@/lib/events'

await eventBus.publish(`class:${classId}`, {
  type: 'teacher-annotation',
  classId,
  pageId,
  annotation: data
})
```

## Client Hook

```typescript
import { useRealtimeEvents } from '@/hooks/use-realtime-events'

useRealtimeEvents(
  ['class-invitation'],
  (event) => handleInvitation(event),
  enabled
)
```

## EventBus Implementations

| Implementation | Use Case |
|----------------|----------|
| `memory-bus.ts` | Single server (default) |
| `postgres-bus.ts` | Multi-instance (PostgreSQL LISTEN/NOTIFY) |

Switch via `EVENT_BUS=postgres` environment variable.

## Teacher Broadcast Mode

Teachers can broadcast annotations to students in real-time:

1. Teacher enables Broadcast Mode for a class
2. Annotation saves trigger broadcast (piggybacks on 2s debounce)
3. Students receive same data format as DB storage
4. Late-joining students load from DB

## Performance

| Metric | Value |
|--------|-------|
| Latency | <100ms |
| Per connection | ~1KB memory |
| Browser limit | 6 SSE connections/domain |

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/events/types.ts` | Event definitions |
| `src/lib/events/memory-bus.ts` | In-memory implementation |
| `src/lib/events/index.ts` | Factory export |
| `src/app/api/events/stream/route.ts` | SSE endpoint |
| `src/hooks/use-realtime-events.ts` | Client hook |
