# Delta Sync for User Data Service

Future optimization to reduce bandwidth by syncing only changes instead of full state.

## Current State

The user data service sends **full state** on every sync:

```typescript
// sync-engine.ts line 174
body: JSON.stringify({ items: batch })  // Full data for each item
```

| Adapter | Typical Size | Sync Frequency | Problem |
|---------|--------------|----------------|---------|
| `annotations` | 10-500 KB | Every 2s while drawing | Large, frequent |
| `code` | 1-50 KB | On every edit | Medium, frequent |
| `snaps` | 1-10 KB | On capture | Small, infrequent |
| `settings` | <1 KB | Rare | Fine as-is |
| `preferences` | <1 KB | Very rare | Fine as-is |

**Biggest opportunity:** Annotations can grow to 500 KB+ after extended drawing sessions, synced every 2 seconds.

## Proposed Solution: Domain-Specific Deltas

Different delta strategies per adapter, tailored to each data type's structure.

### Extended Adapter Interface

```typescript
// src/lib/userdata/adapters.ts
interface DeltaAdapter<T> extends DataAdapter<T> {
  /** Compute delta from previous to current state */
  computeDelta?: (prevState: T, currentState: T) => DeltaPayload | null

  /** Apply delta to reconstruct state */
  applyDelta?: (state: T, delta: DeltaPayload) => T

  /** Threshold: use delta if savings > X% (default 50%) */
  deltaThreshold?: number
}

interface DeltaPayload {
  type: 'delta'
  adapter: string
  baseVersion: number      // Version this delta applies to
  operations: Operation[]  // Add/update/delete operations
  sizeBytes: number        // For metrics
}

interface Operation {
  op: 'add' | 'update' | 'delete'
  path: string             // e.g., 'strokes.5' or 'files.main.py'
  value?: unknown          // For add/update
}
```

### Annotations Delta Strategy

**Prerequisite:** Add stable IDs to strokes (currently just array indices).

```typescript
// Current stroke structure
interface Stroke {
  points: Array<{ x: number; y: number; pressure: number }>
  mode: 'draw' | 'erase'
  color: string
  width: number
  sectionId: string
  sectionOffsetY: number
}

// Enhanced with ID
interface StrokeWithId extends Stroke {
  id: string  // e.g., 'stroke_' + crypto.randomUUID().slice(0, 8)
}
```

**Delta computation:**

```typescript
const annotationsDeltaAdapter: DeltaAdapter<AnnotationData> = {
  ...annotationsAdapter,

  computeDelta: (prev, current) => {
    const prevStrokes: StrokeWithId[] = JSON.parse(prev.canvasData || '[]')
    const currentStrokes: StrokeWithId[] = JSON.parse(current.canvasData || '[]')

    const prevIds = new Set(prevStrokes.map(s => s.id))
    const currentIds = new Set(currentStrokes.map(s => s.id))

    const operations: Operation[] = []

    // Added strokes (in current but not in prev)
    for (const stroke of currentStrokes) {
      if (!prevIds.has(stroke.id)) {
        operations.push({ op: 'add', path: `strokes.${stroke.id}`, value: stroke })
      }
    }

    // Deleted strokes (in prev but not in current) - happens on erase
    for (const stroke of prevStrokes) {
      if (!currentIds.has(stroke.id)) {
        operations.push({ op: 'delete', path: `strokes.${stroke.id}` })
      }
    }

    // Metadata changes
    if (prev.pageVersion !== current.pageVersion) {
      operations.push({ op: 'update', path: 'pageVersion', value: current.pageVersion })
    }
    if (JSON.stringify(prev.headingOffsets) !== JSON.stringify(current.headingOffsets)) {
      operations.push({ op: 'update', path: 'headingOffsets', value: current.headingOffsets })
    }

    if (operations.length === 0) return null

    return {
      type: 'delta',
      adapter: 'annotations',
      baseVersion: prev.version,
      operations,
      sizeBytes: JSON.stringify(operations).length
    }
  },

  applyDelta: (state, delta) => {
    const strokes: StrokeWithId[] = JSON.parse(state.canvasData || '[]')
    let headingOffsets = { ...state.headingOffsets }
    let pageVersion = state.pageVersion

    for (const op of delta.operations) {
      if (op.path.startsWith('strokes.')) {
        const strokeId = op.path.split('.')[1]
        if (op.op === 'add') {
          strokes.push(op.value as StrokeWithId)
        } else if (op.op === 'delete') {
          const idx = strokes.findIndex(s => s.id === strokeId)
          if (idx >= 0) strokes.splice(idx, 1)
        }
      } else if (op.path === 'headingOffsets' && op.op === 'update') {
        headingOffsets = op.value as Record<string, number>
      } else if (op.path === 'pageVersion' && op.op === 'update') {
        pageVersion = op.value as string
      }
    }

    return {
      canvasData: JSON.stringify(strokes),
      headingOffsets,
      pageVersion,
      paddingLeft: state.paddingLeft
    }
  },

  deltaThreshold: 0.5  // Use delta if it's <50% the size of full state
}
```

### Code Delta Strategy

```typescript
const codeDeltaAdapter: DeltaAdapter<CodeEditorData> = {
  ...codeAdapter,

  computeDelta: (prev, current) => {
    const operations: Operation[] = []

    // Changed files only
    for (const file of current.files) {
      const prevFile = prev.files.find(f => f.name === file.name)
      if (!prevFile) {
        operations.push({ op: 'add', path: `files.${file.name}`, value: file })
      } else if (prevFile.content !== file.content) {
        operations.push({ op: 'update', path: `files.${file.name}`, value: file })
      }
    }

    // Deleted files
    for (const prevFile of prev.files) {
      if (!current.files.find(f => f.name === prevFile.name)) {
        operations.push({ op: 'delete', path: `files.${prevFile.name}` })
      }
    }

    // Active file change
    if (prev.activeFileIndex !== current.activeFileIndex) {
      operations.push({ op: 'update', path: 'activeFileIndex', value: current.activeFileIndex })
    }

    if (operations.length === 0) return null

    return {
      type: 'delta',
      adapter: 'code',
      baseVersion: prev.version,
      operations,
      sizeBytes: JSON.stringify(operations).length
    }
  },

  applyDelta: (state, delta) => {
    const files = [...state.files]
    let activeFileIndex = state.activeFileIndex

    for (const op of delta.operations) {
      if (op.path.startsWith('files.')) {
        const fileName = op.path.split('.')[1]
        const idx = files.findIndex(f => f.name === fileName)

        if (op.op === 'add' || op.op === 'update') {
          if (idx >= 0) {
            files[idx] = op.value as PythonFile
          } else {
            files.push(op.value as PythonFile)
          }
        } else if (op.op === 'delete' && idx >= 0) {
          files.splice(idx, 1)
        }
      } else if (op.path === 'activeFileIndex') {
        activeFileIndex = op.value as number
      }
    }

    return { ...state, files, activeFileIndex }
  }
}
```

## Sync Engine Changes

```typescript
// sync-engine.ts

async sync(): Promise<void> {
  const batch = Array.from(this.syncQueue.values())

  // Transform to deltas where beneficial
  const itemsToSync = await Promise.all(batch.map(async (item) => {
    const adapter = getAdapter(item.adapter) as DeltaAdapter<unknown>

    if (!adapter.computeDelta) {
      // No delta support - send full state
      return { ...item, deltaMode: false }
    }

    // Get previous synced state from server or local cache
    const prevState = await this.getPreviousSyncedState(item.adapter, item.itemId)
    if (!prevState) {
      // First sync - send full state
      return { ...item, deltaMode: false }
    }

    const currentState = adapter.deserialize(item.data)
    const delta = adapter.computeDelta(prevState, currentState)

    if (!delta) {
      // No changes
      return null
    }

    // Check if delta is worth it
    const fullSize = item.data.length
    const deltaSize = delta.sizeBytes
    const threshold = adapter.deltaThreshold ?? 0.5

    if (deltaSize < fullSize * threshold) {
      // Delta is smaller - use it
      return {
        ...item,
        data: JSON.stringify(delta),
        deltaMode: true,
        baseVersion: delta.baseVersion
      }
    }

    // Full state is better
    return { ...item, deltaMode: false }
  }))

  const validItems = itemsToSync.filter(Boolean)

  // Send to server
  const response = await fetch('/api/user-data/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: validItems })
  })

  // ... rest of sync logic
}
```

## Server-Side Changes

```typescript
// /api/user-data/sync/route.ts

for (const item of items) {
  if (item.deltaMode) {
    // Apply delta to stored state
    const delta = JSON.parse(item.data) as DeltaPayload
    const currentRecord = await prisma.userData.findUnique({
      where: { id: item.itemId }
    })

    if (!currentRecord || currentRecord.version !== delta.baseVersion) {
      // Version mismatch - request full state
      conflicts.push({ adapter: item.adapter, itemId: item.itemId, needsFullState: true })
      continue
    }

    const adapter = getAdapter(item.adapter) as DeltaAdapter<unknown>
    const currentState = adapter.deserialize(currentRecord.data)
    const newState = adapter.applyDelta(currentState, delta)

    await prisma.userData.update({
      where: { id: item.itemId },
      data: {
        data: adapter.serialize(newState),
        version: { increment: 1 }
      }
    })
  } else {
    // Full state - replace entirely
    await prisma.userData.upsert({
      where: { id: item.itemId },
      create: { ... },
      update: { data: item.data, version: { increment: 1 } }
    })
  }
}
```

## Migration: Adding Stroke IDs

Existing annotations need IDs added on first load:

```typescript
// In annotation-layer.tsx or simple-canvas.tsx

function migrateStrokesToIds(strokes: Stroke[]): StrokeWithId[] {
  return strokes.map((stroke, index) => {
    if ('id' in stroke) return stroke as StrokeWithId
    return {
      ...stroke,
      id: `stroke_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`
    }
  })
}
```

## Bandwidth Savings Estimate

| Scenario | Full State | Delta | Savings |
|----------|------------|-------|---------|
| Add 1 stroke (100 existing) | 50 KB | 0.5 KB | 99% |
| Add 5 strokes (100 existing) | 50 KB | 2.5 KB | 95% |
| Erase 3 strokes | 47 KB | 0.1 KB | 99.8% |
| Change 1 code file (5 files) | 25 KB | 5 KB | 80% |
| Change active file index | 25 KB | 0.05 KB | 99.8% |

## Implementation Priority

1. **Phase 1: Add stroke IDs** (prerequisite)
   - Update `simple-canvas.tsx` to generate IDs for new strokes
   - Add migration for existing annotations

2. **Phase 2: Annotations delta adapter**
   - Biggest bandwidth win
   - Most frequent syncs

3. **Phase 3: Code delta adapter**
   - Secondary win
   - Useful for multi-file editors

4. **Phase 4: Server-side delta application**
   - Update sync API to handle delta payloads
   - Add version conflict handling

## Integration with Real-Time Events

Delta sync complements the broadcast feature:

```
Teacher draws → Delta computed →
  ├── Save delta to DB (small payload)
  └── Broadcast delta via SSE (same small payload)
```

Students can apply the same delta format, whether loading from DB or receiving via SSE.

## Files to Modify

- `src/lib/userdata/adapters.ts` - Add DeltaAdapter interface and implementations
- `src/lib/userdata/sync-engine.ts` - Delta computation and conditional sync
- `src/components/annotations/simple-canvas.tsx` - Generate stroke IDs
- `src/app/api/user-data/sync/route.ts` - Server-side delta application
- `prisma/schema.prisma` - May need version field on UserData model
