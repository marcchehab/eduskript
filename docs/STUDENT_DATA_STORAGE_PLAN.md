# User Data Storage Plan

## Decision: Unified Data Provider with Cloud Sync

After cost analysis, we're implementing full cloud sync for all users (teachers and students). The marginal cost is negligible (~€0.03/student/year) and provides significant UX benefits.

## Cost Analysis (100 Teachers + 10,000 Students)

### Data Volumes

| User Type | Count | Data per User | Total |
|-----------|-------|---------------|-------|
| Students | 10,000 | 1.25MB (code+annotations) + 2.4MB (snaps) | 12.5GB + 24GB |
| Teachers | 100 | 2MB (code+annotations) + 8MB (snaps) | 200MB + 800MB |
| **Total** | | | **~13GB (PostgreSQL) + ~25GB (Scaleway)** |

### Monthly Costs

| Component | Cost |
|-----------|------|
| Koyeb PostgreSQL (medium, 50GB) | €25 |
| Scaleway Object Storage (25GB) | €0.30 |
| Scaleway Egress (~3GB) | €0.03 |
| **Total** | **~€25/month** |
| **Per user/year** | **€0.03** |

## Architecture: UserDataProvider

```
┌─────────────────────────────────────────────────────────────────┐
│                        React App                                │
├─────────────────────────────────────────────────────────────────┤
│                     useUserData() hook                          │
│         (code, annotations, snaps, preferences, etc.)           │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                    UserDataProvider                             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   UserDataService                           ││
│  │  - get(adapter, id)     → returns cached or fetches         ││
│  │  - set(adapter, id, v)  → writes local + queues sync        ││
│  │  - subscribe(adapter, id, cb) → reactive updates            ││
│  │  - sync()               → force sync pending changes        ││
│  └─────────────────────────────────────────────────────────────┘│
│                            │                                    │
│           ┌────────────────┼────────────────┐                   │
│           ▼                ▼                ▼                   │
│    ┌────────────┐   ┌────────────┐   ┌────────────┐             │
│    │ LocalCache │   │ SyncEngine │   │  Adapters  │             │
│    │ (IndexedDB)│   │ (debounce, │   │ - code     │             │
│    │            │   │  queue,    │   │ - annotate │             │
│    │            │   │  retry)    │   │ - snaps    │             │
│    └────────────┘   └─────┬──────┘   │ - prefs    │             │
│                           │          └────────────┘             │
└───────────────────────────┼─────────────────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │      /api/user-data       │
              │  (PostgreSQL + Scaleway)  │
              └───────────────────────────┘
```

## Data Types & Adapters

Each data type has its own adapter defining serialization and merge strategy:

### 1. Code Data (`code`)
```typescript
interface CodeData {
  files: Array<{ name: string; content: string }>
  activeFile: string
  versions: Array<{ id: string; files: any[]; label?: string; createdAt: string }>
}
// Merge: Keep newer files, merge version history (deduped, max 50)
```

### 2. Annotations (`annotations`)
```typescript
interface AnnotationData {
  strokes: Array<{ points: number[]; color: string; width: number }>
  highlights: Array<{ sectionId: string; text: string; color: string }>
}
// Merge: Additive (union of strokes and highlights)
```

### 3. Editor Settings (`settings`)
```typescript
interface EditorSettings {
  fontSize: number
  editorWidth: number
  canvasTransform: { x: number; y: number; scale: number }
}
// Merge: Local wins (user's current device preferences)
```

### 4. Snaps (`snaps`)
```typescript
interface SnapReference {
  id: string
  pageId: string
  bucketPath: string  // "snaps/{userId}/{snapId}.webp"
  position: { x: number; y: number }
  createdAt: string
}
// Storage: Metadata in PostgreSQL, image in Scaleway bucket
// Merge: None needed (immutable, identified by ID)
```

### 5. User Preferences (`preferences`)
```typescript
interface UserPreferences {
  theme: 'light' | 'dark' | 'system'
  sidebarCollapsed: boolean
  // Extensible...
}
// Merge: Local wins
```

## Storage Layout

### PostgreSQL Schema

```sql
-- Single table for all user data (JSONB is efficient)
CREATE TABLE user_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  adapter VARCHAR(50) NOT NULL,      -- 'code', 'annotations', 'settings', 'snaps', 'preferences'
  item_id VARCHAR(255) NOT NULL,     -- pageId, 'global', or snapId
  data JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(user_id, adapter, item_id)
);

CREATE INDEX idx_user_data_user ON user_data(user_id);
CREATE INDEX idx_user_data_lookup ON user_data(user_id, adapter);
CREATE INDEX idx_user_data_updated ON user_data(updated_at);
```

### Scaleway Bucket Structure

```
eduskript-user-data/
└── snaps/
    └── {userId}/
        └── {snapId}.webp
```

### IndexedDB Schema (Local Cache)

```typescript
// Dexie schema
db.version(1).stores({
  data: '[adapter+itemId], adapter, updatedAt, synced',
  pending: '++id, [adapter+itemId]',
  meta: 'key'
})
```

## Sync Strategy

### Write Path
1. User edits code/annotations
2. Write immediately to IndexedDB (instant feedback)
3. Queue change for sync
4. After 2s debounce, batch POST to `/api/user-data/sync`
5. Mark as synced on success
6. On failure, retry in 30s (exponential backoff)

### Read Path
1. On page load, read from IndexedDB (instant)
2. Background fetch manifest from server
3. For items newer on server, fetch and merge
4. Update local cache with merged result
5. Notify subscribers of changes

### Conflict Resolution
- **Code**: Last-write-wins for files, merge version history
- **Annotations**: Additive merge (union)
- **Settings/Preferences**: Local device wins
- **Snaps**: No conflicts (immutable)

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/user-data/sync` | POST | Batch upsert multiple items |
| `/api/user-data/manifest` | GET | Get all item timestamps for sync |
| `/api/user-data/[adapter]/[itemId]` | GET | Fetch single item |
| `/api/user-data/snaps/upload` | POST | Upload snap image to bucket |

## Environment Variables

```bash
# Scaleway Object Storage
SCW_ACCESS_KEY=xxx
SCW_SECRET_KEY=xxx
SCW_USER_BUCKET_NAME=eduskript-user-data
SCW_REGION=fr-par
SCW_ENDPOINT=https://s3.fr-par.scw.cloud
```

## Implementation Plan

### Phase 1: Core Infrastructure
- [ ] Add Prisma schema for `UserData` table
- [ ] Create `src/lib/user-data/` module structure
- [ ] Implement `UserDataService` with IndexedDB
- [ ] Implement adapters (code, annotations, settings, preferences)
- [ ] Create `UserDataProvider` React context
- [ ] Create `useUserData` hook

### Phase 2: Server Sync
- [ ] Create `/api/user-data/sync` endpoint
- [ ] Create `/api/user-data/manifest` endpoint
- [ ] Implement SyncEngine with debounce/retry
- [ ] Add online/offline detection
- [ ] Add sync status indicator UI

### Phase 3: Snap Storage
- [ ] Set up Scaleway SDK integration
- [ ] Create `/api/user-data/snaps/upload` endpoint
- [ ] Implement snap adapter with bucket storage
- [ ] Add snap capture → upload flow

### Phase 4: Migration & Integration
- [ ] Migrate existing IndexedDB data to new schema
- [ ] Update CodeEditor to use `useUserData`
- [ ] Update AnnotationLayer to use `useUserData`
- [ ] Remove old `useUserPageData` hook
- [ ] Test cross-device sync

## File Structure

```
src/lib/user-data/
├── types.ts              # Core interfaces
├── service.ts            # UserDataService implementation
├── provider.tsx          # React context & hooks
├── sync-engine.ts        # Debounce, queue, retry logic
├── local-cache.ts        # IndexedDB wrapper (Dexie)
└── adapters/
    ├── index.ts          # Export all adapters
    ├── code.ts           # Code editor data
    ├── annotations.ts    # Drawing/highlight data
    ├── settings.ts       # Editor settings per page
    ├── preferences.ts    # Global user preferences
    └── snaps.ts          # Snap references

src/app/api/user-data/
├── sync/route.ts         # Batch sync endpoint
├── manifest/route.ts     # Timestamp manifest
└── snaps/
    └── upload/route.ts   # Snap upload to Scaleway
```

## Benefits

| Benefit | Description |
|---------|-------------|
| **Cross-device sync** | Students can switch devices seamlessly |
| **Data persistence** | Survives browser clears |
| **Offline-first** | Works without network, syncs when online |
| **Extensible** | Add new data types with 5-line adapter |
| **Conflict resolution** | Per-adapter merge strategies |
| **Efficient** | Debounced batched syncs, not per-keystroke |
| **Observable** | Teachers can see student progress (future) |
| **Cheap** | €0.03/student/year |
