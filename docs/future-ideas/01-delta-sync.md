# Delta Sync

Optimization to reduce bandwidth by syncing only changes instead of full state.

## Current State

User data service sends full state on every sync:

| Adapter | Typical Size | Sync Frequency | Issue |
|---------|--------------|----------------|-------|
| `annotations` | 10-500 KB | Every 2s | Large, frequent |
| `code` | 1-50 KB | On edit | Medium, frequent |
| `snaps` | 1-10 KB | On capture | Small, infrequent |
| `settings` | <1 KB | Rare | Fine as-is |

**Biggest opportunity:** Annotations can grow to 500 KB+ synced every 2 seconds.

## Proposed Solution

Domain-specific delta strategies per adapter.

### Extended Adapter Interface

```typescript
interface DeltaAdapter<T> extends DataAdapter<T> {
  computeDelta?: (prev: T, current: T) => DeltaPayload | null
  applyDelta?: (state: T, delta: DeltaPayload) => T
  deltaThreshold?: number  // Use delta if savings > X% (default 50%)
}

interface DeltaPayload {
  type: 'delta'
  adapter: string
  baseVersion: number
  operations: Operation[]
}

interface Operation {
  op: 'add' | 'update' | 'delete'
  path: string   // e.g., 'strokes.5'
  value?: unknown
}
```

### Annotations Strategy

**Prerequisite:** Add stable IDs to strokes (currently array indices).

```typescript
interface StrokeWithId extends Stroke {
  id: string  // 'stroke_' + crypto.randomUUID().slice(0, 8)
}
```

Delta computation:
- Track added strokes (in current, not in prev)
- Track deleted strokes (in prev, not in current)
- Send only changes, not full canvas data

### Code Strategy

```typescript
// Changed files only
for (const file of current.files) {
  const prevFile = prev.files.find(f => f.name === file.name)
  if (!prevFile) {
    operations.push({ op: 'add', path: `files.${file.name}`, value: file })
  } else if (prevFile.content !== file.content) {
    operations.push({ op: 'update', path: `files.${file.name}`, value: file })
  }
}
```

## Bandwidth Savings

| Scenario | Full State | Delta | Savings |
|----------|------------|-------|---------|
| Add 1 stroke (100 existing) | 50 KB | 0.5 KB | 99% |
| Erase 3 strokes | 47 KB | 0.1 KB | 99.8% |
| Change 1 code file (5 files) | 25 KB | 5 KB | 80% |

## Implementation Phases

1. **Add stroke IDs** - Prerequisite for annotation deltas
2. **Annotations delta adapter** - Biggest bandwidth win
3. **Code delta adapter** - Secondary win
4. **Server-side delta application** - Handle version conflicts

## Files to Modify

- `src/lib/userdata/adapters.ts` - DeltaAdapter interface
- `src/lib/userdata/sync-engine.ts` - Delta computation
- `src/components/annotations/simple-canvas.tsx` - Generate stroke IDs
- `src/app/api/user-data/sync/route.ts` - Server-side application
