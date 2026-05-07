/**
 * User Data Service
 *
 * Singleton service for managing local user data persistence via IndexedDB.
 * Handles debounced saves, versioning, and remote-sync handoff.
 *
 * USERID SCOPING: All records are keyed on `currentUserId` (default 'anonymous'),
 * set via setCurrentUser() from the provider when auth resolves. Different users
 * on one browser are naturally isolated — no wipe needed.
 */

import { db } from './schema'
import type { UserDataRecord, SaveOptions, UserDataVersion, VersionBlob, CreateVersionOptions, VersionSummary, VersionKind } from './types'
import { generateSHA256, gzipCompress, gzipDecompress, calculateSize } from './compression'

interface PendingSave<T = any> {
  timer: NodeJS.Timeout
  // Replay function captures the data + targeting at the time of debounce.
  // Awaiting this from flush() actually persists the pending save (the previous
  // implementation only cleared timers and dropped data).
  replay: () => Promise<void>
}

/**
 * Singleton service for user data management
 */
export class UserDataService {
  private static instance: UserDataService
  private currentUserId: string = 'anonymous'
  private saveTimers: Map<string, PendingSave> = new Map()
  private readonly DEFAULT_DEBOUNCE = 1000 // 1 second

  // Pub/sub listeners keyed by cacheKey, used for cross-editor sync of shared data (e.g. Python imports)
  private listeners: Map<string, Set<{ callback: (data: any, sourceId?: string) => void; id?: string }>> = new Map()

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): UserDataService {
    if (!UserDataService.instance) {
      UserDataService.instance = new UserDataService()
    }
    return UserDataService.instance
  }

  /**
   * Set the active userId for all subsequent reads/writes. 'anonymous' is the
   * default scope for not-logged-in browsers. Awaits flush() so any save
   * debounced under the previous userId actually lands under that userId
   * before the swap.
   */
  public async setCurrentUser(userId: string | null): Promise<void> {
    await this.flush()
    this.currentUserId = userId ?? 'anonymous'
  }

  public getCurrentUser(): string {
    return this.currentUserId
  }

  /**
   * Generate cache key for debounce timers and pub/sub (includes userId + targeting)
   */
  private getCacheKey(
    pageId: string,
    componentId: string,
    targetType?: 'class' | 'student' | 'page' | null,
    targetId?: string | null
  ): string {
    const targetKey = targetType && targetId ? `:${targetType}:${targetId}` : ''
    return `${this.currentUserId}:${pageId}:${componentId}${targetKey}`
  }

  /**
   * Generate IndexedDB compound key (5-tuple including userId)
   * Note: Uses empty strings instead of null because IndexedDB doesn't support null in compound keys
   */
  private getDbKey(
    pageId: string,
    componentId: string,
    targetType?: 'class' | 'student' | 'page' | null,
    targetId?: string | null
  ): [string, string, string, string, string] {
    return [this.currentUserId, pageId, componentId, targetType ?? '', targetId ?? '']
  }

  /**
   * Retrieve user data for a specific page component
   */
  public async get<T = any>(
    pageId: string,
    componentId: string,
    options: {
      targetType?: 'class' | 'student' | 'page' | null
      targetId?: string | null
    } = {}
  ): Promise<UserDataRecord<T> | null> {
    // Validate inputs to prevent IndexedDB DataError
    // Skip silently for placeholder values (used when hook shouldn't load yet)
    if (!pageId || !componentId || pageId === '__skip__') {
      return null
    }

    try {
      const dbKey = this.getDbKey(pageId, componentId, options.targetType, options.targetId)
      const record = await db.userData.get(dbKey)
      return (record as UserDataRecord<T>) || null
    } catch (error) {
      console.error('Failed to retrieve user data:', error)
      return null
    }
  }

  /**
   * Subscribe to changes for a specific pageId + componentId.
   * Callback fires after each save with the saved data and the sourceId of the saver.
   * Returns an unsubscribe function.
   */
  public subscribe<T = any>(
    pageId: string,
    componentId: string,
    callback: (data: T, sourceId?: string) => void,
    options: {
      targetType?: 'class' | 'student' | 'page' | null
      targetId?: string | null
      id?: string // Caller's unique ID, so it can filter self-notifications
    } = {}
  ): () => void {
    const cacheKey = this.getCacheKey(pageId, componentId, options.targetType, options.targetId)
    if (!this.listeners.has(cacheKey)) {
      this.listeners.set(cacheKey, new Set())
    }
    const entry = { callback, id: options.id }
    this.listeners.get(cacheKey)!.add(entry)
    return () => {
      this.listeners.get(cacheKey)?.delete(entry)
    }
  }

  /**
   * Notify all listeners for a given cache key
   */
  private notifyListeners<T>(cacheKey: string, data: T, sourceId?: string): void {
    const set = this.listeners.get(cacheKey)
    if (!set) return
    for (const entry of set) {
      try {
        entry.callback(data, sourceId)
      } catch (e) {
        console.error('Listener error:', e)
      }
    }
  }

  /**
   * Save user data for a specific page component
   */
  public async save<T = any>(
    pageId: string,
    componentId: string,
    data: T,
    options: SaveOptions & {
      targetType?: 'class' | 'student' | 'page' | null
      targetId?: string | null
      sourceId?: string // ID of the editor instance that triggered this save
      // When true, the record is flagged so the sync engine never pushes it.
      // Persists on the record so the flag survives reload. Once set, it sticks
      // unless an explicit save passes localOnly=false.
      localOnly?: boolean
    } = {}
  ): Promise<void> {
    // Validate inputs to prevent IndexedDB DataError
    // Skip silently for placeholder values (used when hook shouldn't save yet)
    if (!pageId || !componentId || pageId === '__skip__') {
      return
    }

    const { debounce = this.DEFAULT_DEBOUNCE, immediate = false, targetType, targetId, sourceId, localOnly } = options
    const cacheKey = this.getCacheKey(pageId, componentId, targetType, targetId)

    // Capture the userId active right now; if the user changes mid-debounce,
    // setCurrentUser() awaits flush() and the replay below will run under
    // this captured userId rather than the new one.
    const capturedUserId = this.currentUserId

    // Clear existing timer if any
    const existing = this.saveTimers.get(cacheKey)
    if (existing) {
      clearTimeout(existing.timer)
      this.saveTimers.delete(cacheKey)
    }

    // If immediate save requested, execute now
    if (immediate) {
      await this.performSave(capturedUserId, pageId, componentId, data, targetType, targetId, sourceId, localOnly)
      return
    }

    // Otherwise, debounce. The replay closure captures the payload so flush()
    // can persist it instead of dropping it.
    const replay = async () => {
      this.saveTimers.delete(cacheKey)
      await this.performSave(capturedUserId, pageId, componentId, data, targetType, targetId, sourceId, localOnly)
    }
    const timer = setTimeout(() => { void replay() }, debounce)

    this.saveTimers.set(cacheKey, { timer, replay })
  }

  /**
   * Internal method to perform the actual save operation
   */
  private async performSave<T = any>(
    userId: string,
    pageId: string,
    componentId: string,
    data: T,
    targetType?: 'class' | 'student' | 'page' | null,
    targetId?: string | null,
    sourceId?: string,
    localOnly?: boolean
  ): Promise<void> {
    try {
      // Look up the existing record under the userId active at save time —
      // not this.currentUserId, which may have changed since debounce started.
      const existing = await db.userData.get([userId, pageId, componentId, targetType ?? '', targetId ?? ''])
      const now = Date.now()

      // Preserve existing localOnly flag unless caller explicitly overrides.
      // This ensures the flag survives normal saves that don't pass it.
      const effectiveLocalOnly = localOnly !== undefined ? localOnly : existing?.localOnly

      const record: UserDataRecord<T> = {
        userId,
        pageId,
        componentId,
        data,
        updatedAt: now,
        savedToRemote: false,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt || new Date().toISOString(),
        // Use empty strings for IndexedDB compound key compatibility (null not allowed)
        targetType: targetType ?? '',
        targetId: targetId ?? '',
        ...(effectiveLocalOnly ? { localOnly: true } : {}),
      }

      await db.userData.put(record)

      // Notify subscribers under the cache key matching this userId. We
      // recompute the key here using `userId` (not currentUserId) so that
      // late replays after a user swap notify under the captured user.
      const targetKey = targetType && targetId ? `:${targetType}:${targetId}` : ''
      const cacheKey = `${userId}:${pageId}:${componentId}${targetKey}`
      this.notifyListeners(cacheKey, data, sourceId)
    } catch (error) {
      console.error('Failed to save user data:', error)
      throw error
    }
  }

  /**
   * Delete user data for a specific page component
   */
  public async delete(
    pageId: string,
    componentId: string,
    options: {
      targetType?: 'class' | 'student' | 'page' | null
      targetId?: string | null
    } = {}
  ): Promise<void> {
    // Validate inputs to prevent IndexedDB DataError
    if (!pageId || !componentId) {
      console.warn('UserDataService.delete called with invalid keys:', { pageId, componentId })
      return
    }

    try {
      const { targetType, targetId } = options
      const cacheKey = this.getCacheKey(pageId, componentId, targetType, targetId)

      // Clear pending save timer if any
      const existing = this.saveTimers.get(cacheKey)
      if (existing) {
        clearTimeout(existing.timer)
        this.saveTimers.delete(cacheKey)
      }

      const dbKey = this.getDbKey(pageId, componentId, targetType, targetId)
      await db.userData.delete(dbKey)
    } catch (error) {
      console.error('Failed to delete user data:', error)
      throw error
    }
  }

  /**
   * Delete all data for a specific page (scoped to current user)
   */
  public async deleteAllForPage(pageId: string): Promise<void> {
    try {
      await db.userData
        .where('[userId+pageId]')
        .equals([this.currentUserId, pageId])
        .delete()
    } catch (error) {
      console.error('Failed to delete page data:', error)
      throw error
    }
  }

  /**
   * Get all component IDs with data for a specific page (scoped to current user)
   */
  public async getComponentsForPage(pageId: string): Promise<string[]> {
    try {
      const records = await db.userData
        .where('[userId+pageId]')
        .equals([this.currentUserId, pageId])
        .toArray()
      return records.map((r) => r.componentId)
    } catch (error) {
      console.error('Failed to retrieve page components:', error)
      return []
    }
  }

  /**
   * Clear old data for the current user (for cleanup purposes)
   * @param olderThanDays Delete records older than this many days
   */
  public async cleanupOldData(olderThanDays: number = 90): Promise<number> {
    try {
      const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
      const userId = this.currentUserId
      const deleted = await db.userData
        .where('updatedAt').below(cutoff)
        .and((r) => r.userId === userId)
        .delete()
      return deleted
    } catch (error) {
      console.error('Failed to cleanup old data:', error)
      return 0
    }
  }

  /**
   * Flush all pending debounced saves immediately. Returns once every queued
   * payload has been persisted. Call this before swapping userId or unmounting.
   */
  public async flush(): Promise<void> {
    const replays: Array<() => Promise<void>> = []
    this.saveTimers.forEach(({ timer, replay }) => {
      clearTimeout(timer)
      replays.push(replay)
    })
    this.saveTimers.clear()

    // performSave handles its own errors; surface any here for visibility.
    await Promise.all(replays.map((r) => r().catch((e) => console.error('Flush replay failed:', e))))
  }

  /* ========================================================================
   * VERSION HISTORY METHODS
   * ======================================================================== */

  /**
   * Create a new version snapshot of the current data.
   *
   * Concurrency: the version-number lookup and the row insert run inside a
   * single Dexie transaction so two parallel callers can't both compute the
   * same `versionNumber` from a stale snapshot. Without this, a fast typist
   * triggering autosaves in close succession would write rows with duplicate
   * versionNumber — visible in the UI as duplicate React keys.
   *
   * The (potentially expensive) gzip happens *outside* the transaction
   * because Dexie transactions can't await non-Dexie promises.
   */
  public async createVersion<T = any>(
    pageId: string,
    componentId: string,
    data: T,
    options: CreateVersionOptions = {}
  ): Promise<UserDataVersion> {
    try {
      const { label, isManualSave = false } = options
      // Resolve the row's kind: explicit `kind` wins, then legacy
      // `isManualSave` flag, default to 'auto'.
      const kind: VersionKind = options.kind ?? (isManualSave ? 'manual' : 'auto')
      const userId = this.currentUserId

      // Serialize data to JSON
      const dataJson = JSON.stringify(data)
      const sizeBytes = calculateSize(dataJson)

      // Generate hash for deduplication
      const dataHash = await generateSHA256(dataJson)
      const blobId = dataHash

      // Pre-compress outside the transaction (gzip is async non-Dexie work
      // and would abort a Dexie transaction). We may end up not needing it
      // if a concurrent caller wrote the same blob first; that's fine —
      // the put inside the transaction is idempotent on the blobId key.
      const existingBlobBefore = await db.versionBlobs.get(blobId)
      const compressedBlob = existingBlobBefore ? null : await gzipCompress(dataJson)

      const created = await db.transaction('rw', db.userData_history, db.versionBlobs, async () => {
        // Read existing rows once: needed for both the dedup guard below and
        // the version-number assignment further down.
        const existingVersions = await db.userData_history
          .where('[userId+pageId+componentId]')
          .equals([userId, pageId, componentId])
          .toArray()

        // Dedup guard: skip rows whose content hash matches the most recent
        // row when the new row would carry no information beyond the
        // content. Two cases:
        //   - 'auto', no label: a passive autosave; redundant against any
        //     latest row regardless of kind.
        //   - 'run', no label: pressing Run again with no edits; only
        //     redundant against another 'run' (Run after a check/autosave
        //     should still record the deliberate Run event).
        // The blob hasn't been touched yet, so no refCount cleanup is
        // needed. Manual/check saves and *labeled* rows always insert
        // because their row carries meaning beyond the content. Comparing
        // against the latest row by createdAt — not versionNumber —
        // because reassignVersionHistory can move rows in from other
        // componentIds and createdAt is the canonical UI sort key.
        if (existingVersions.length > 0) {
          const latest = existingVersions.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
          const sameContent = latest.dataHash === dataHash
          const dedupAuto = kind === 'auto' && !label && sameContent
          const dedupRun =
            kind === 'run' && !label && sameContent && latest.kind === 'run' && !latest.label
          if (dedupAuto || dedupRun) {
            return { ...latest, isDuplicate: true }
          }
        }

        // Re-check blob existence inside the transaction so refCount is
        // accurate even under concurrent createVersion calls.
        const existingBlob = await db.versionBlobs.get(blobId)
        if (existingBlob) {
          await db.versionBlobs.update(blobId, { refCount: existingBlob.refCount + 1 })
        } else if (compressedBlob) {
          await db.versionBlobs.put({
            blobId,
            data: compressedBlob,
            refCount: 1,
            createdAt: Date.now(),
          })
        } else {
          // Race: blob existed before, was deleted by cleanup mid-flight.
          // Re-compress synchronously is not possible here (would break the
          // transaction); throw so the outer catch logs and skips this snapshot.
          throw new Error('Blob disappeared mid-transaction; retry')
        }

        const versionNumber = existingVersions.length > 0
          ? Math.max(...existingVersions.map(v => v.versionNumber)) + 1
          : 1

        const version: UserDataVersion = {
          userId,
          pageId,
          componentId,
          versionNumber,
          dataHash,
          blobId,
          createdAt: Date.now(),
          label,
          sizeBytes,
          // Keep both for back-compat with code that still reads isManualSave.
          isManualSave: kind === 'manual',
          kind,
        }

        const id = await db.userData_history.add(version)
        version.id = id
        return version
      })

      // Cleanup runs outside the transaction — opportunistic, non-critical.
      await this.cleanupOldVersions(pageId, componentId, 64)

      return created
    } catch (error) {
      console.error('Failed to create version:', error)
      throw error
    }
  }

  /**
   * Get version history for a component (current user only).
   *
   * Sorted descending by createdAt rather than versionNumber so that rows
   * moved in by `reassignVersionHistory` (orphan-restore) interleave
   * correctly with native rows. versionNumber is still written on creation
   * but is no longer used as an identifier or sort key.
   */
  public async getVersionHistory(
    pageId: string,
    componentId: string
  ): Promise<VersionSummary[]> {
    try {
      const rows = await db.userData_history
        .where('[userId+pageId+componentId]')
        .equals([this.currentUserId, pageId, componentId])
        .toArray()
      const versions = rows.sort((a, b) => b.createdAt - a.createdAt)

      return versions.map(v => ({
        id: v.id,
        versionNumber: v.versionNumber,
        createdAt: v.createdAt,
        label: v.label,
        sizeBytes: v.sizeBytes,
        canRestore: true,
        isManualSave: v.isManualSave,
        // Derive kind for legacy rows that don't have it stamped yet.
        kind: v.kind ?? (v.isManualSave ? 'manual' : 'auto'),
        synced: !!v.serverCheckpointId,
      }))
    } catch (error) {
      console.error('Failed to get version history:', error)
      return []
    }
  }

  /**
   * Distinct code-editor componentIds that have version-history rows on
   * this page for the current user. Used by the orphaned-versions feature
   * to detect editor IDs whose saves still live in IndexedDB even though
   * no editor is currently mounted with that ID.
   */
  public async getCodeEditorComponentIdsWithHistory(pageId: string): Promise<string[]> {
    try {
      const versions = await db.userData_history
        .where('[userId+pageId+componentId]')
        .between(
          [this.currentUserId, pageId, ''],
          [this.currentUserId, pageId, '\uffff']
        )
        .toArray()
      const ids = new Set<string>()
      for (const v of versions) {
        if (v.componentId.startsWith('code-editor-')) ids.add(v.componentId)
      }
      return [...ids]
    } catch (error) {
      console.error('Failed to list code-editor component ids:', error)
      return []
    }
  }

  /**
   * Move every version-history row from `fromComponentId` to `toComponentId`
   * for the current user/page. Used by the orphan-restore action.
   *
   * Rows are mutated in place (`update` only flips componentId), so:
   *  - Auto-increment `id`s are preserved.
   *  - `versionBlobs` and their refCounts are not touched (rows are moved,
   *    not duplicated).
   *  - `versionNumber` is left as-is. It's no longer used as an identifier;
   *    duplicates after a move are tolerated because lookups are id-based.
   *  - The compound secondary index `[userId+pageId+componentId]` is
   *    re-keyed by Dexie automatically on update.
   *
   * The whole batch runs in a single transaction so a partial failure rolls
   * back — there is no half-moved orphan.
   */
  public async reassignVersionHistory(
    pageId: string,
    fromComponentId: string,
    toComponentId: string
  ): Promise<number> {
    try {
      const userId = this.currentUserId
      return await db.transaction('rw', db.userData_history, async () => {
        const rows = await db.userData_history
          .where('[userId+pageId+componentId]')
          .equals([userId, pageId, fromComponentId])
          .toArray()
        for (const row of rows) {
          if (row.id == null) continue
          await db.userData_history.update(row.id, { componentId: toComponentId })
        }
        return rows.length
      })
    } catch (error) {
      console.error('Failed to reassign version history:', error)
      throw error
    }
  }

  /**
   * Restore data from a specific version (current user only) by its
   * IndexedDB auto-increment id. The version's stored componentId/pageId
   * decide where the snapshot is written, so this also works for orphans.
   */
  public async restoreVersion<T = any>(versionId: number): Promise<T | null> {
    try {
      const version = await db.userData_history.get(versionId)
      if (!version) {
        console.error('Version not found:', versionId)
        return null
      }
      if (version.userId !== this.currentUserId) {
        console.error('Version does not belong to current user:', versionId)
        return null
      }

      const blob = await db.versionBlobs.get(version.blobId)
      if (!blob) {
        console.error('Version blob not found:', version.blobId)
        return null
      }

      const dataJson = await gzipDecompress(blob.data)
      const data = JSON.parse(dataJson) as T

      // Save as current (debounce-skipped). Writes only to db.userData;
      // does NOT create a history row. Any subsequent autosave that
      // produces the same hash will be deduped by createVersion's guard.
      await this.save(version.pageId, version.componentId, data, { immediate: true })

      return data
    } catch (error) {
      console.error('Failed to restore version:', error)
      return null
    }
  }

  /**
   * Delete a specific version. Identifies by the row's unique IndexedDB id
   * when provided, falling back to versionNumber lookup for legacy callers.
   * Version-number lookup can hit ambiguity if old data has duplicate
   * versionNumbers (from a pre-fix race); id is unique by definition.
   */
  public async deleteVersion(
    pageId: string,
    componentId: string,
    versionNumberOrId: number,
    options: { byId?: boolean } = {}
  ): Promise<void> {
    try {
      let version: UserDataVersion | undefined
      if (options.byId) {
        version = await db.userData_history.get(versionNumberOrId)
        // Also confirm it belongs to the current user / page / component.
        if (
          version &&
          (version.userId !== this.currentUserId ||
            version.pageId !== pageId ||
            version.componentId !== componentId)
        ) {
          version = undefined
        }
      } else {
        version = await db.userData_history
          .where('[userId+pageId+componentId]')
          .equals([this.currentUserId, pageId, componentId])
          .filter(v => v.versionNumber === versionNumberOrId)
          .first()
      }

      if (!version) {
        throw new Error(`Version ${versionNumberOrId} not found`)
      }

      // Decrement blob refCount
      const blob = await db.versionBlobs.get(version.blobId)
      if (blob) {
        if (blob.refCount <= 1) {
          // No more references, delete the blob
          await db.versionBlobs.delete(version.blobId)
        } else {
          // Decrement reference count
          await db.versionBlobs.update(version.blobId, { refCount: blob.refCount - 1 })
        }
      }

      // Delete the version record
      if (version.id) {
        await db.userData_history.delete(version.id)
      }
    } catch (error) {
      console.error('Failed to delete version:', error)
      throw error
    }
  }

  /**
   * Stamp a local version row with the id of its corresponding server-side
   * checkpoint. Called after a successful POST to /api/user-data/checkpoints
   * so the UI can render a "synced" badge that survives reloads.
   */
  public async markVersionSynced(versionId: number, serverCheckpointId: string): Promise<void> {
    try {
      await db.userData_history.update(versionId, { serverCheckpointId })
    } catch (error) {
      console.error('Failed to mark version synced:', error)
    }
  }

  /**
   * Decompress and return the full payload for a given version row. Used
   * when promoting an autosave to a synced manual save — the caller needs
   * the original CodeEditorData snapshot to POST as the checkpoint payload.
   */
  public async getVersionPayload<T = any>(versionId: number): Promise<T | null> {
    try {
      const version = await db.userData_history.get(versionId)
      if (!version) return null
      const blob = await db.versionBlobs.get(version.blobId)
      if (!blob) return null
      const dataJson = await gzipDecompress(blob.data)
      return JSON.parse(dataJson) as T
    } catch (error) {
      console.error('Failed to get version payload:', error)
      return null
    }
  }

  /**
   * Generic in-place update for a version row. Used by the autosave→manual
   * promotion flow to flip `kind`, set `isManualSave`, and optionally stamp
   * a preserved label so the display name doesn't shift after promotion.
   */
  public async updateVersion(
    versionId: number,
    updates: Partial<UserDataVersion>
  ): Promise<void> {
    try {
      await db.userData_history.update(versionId, updates)
    } catch (error) {
      console.error('Failed to update version:', error)
    }
  }

  /**
   * Update a version's label by its IndexedDB auto-increment id (current
   * user only). id-based lookup avoids the duplicate-versionNumber
   * ambiguity that the old (pageId, componentId, versionNumber) signature
   * had — and that the orphan-restore path can produce on purpose.
   */
  public async updateVersionLabel(
    versionId: number,
    label: string
  ): Promise<void> {
    try {
      const version = await db.userData_history.get(versionId)
      if (!version || version.userId !== this.currentUserId) {
        throw new Error(`Version ${versionId} not found`)
      }
      await db.userData_history.update(versionId, { label })
    } catch (error) {
      console.error('Failed to update version label:', error)
      throw error
    }
  }

  /**
   * Cleanup old versions to maintain retention limit (per-user)
   */
  private async cleanupOldVersions(
    pageId: string,
    componentId: string,
    maxVersions: number = 64
  ): Promise<void> {
    try {
      const versions = await db.userData_history
        .where('[userId+pageId+componentId]')
        .equals([this.currentUserId, pageId, componentId])
        .sortBy('versionNumber')

      if (versions.length <= maxVersions) {
        return // Nothing to cleanup
      }

      // Calculate how many to delete
      const toDelete = versions.slice(0, versions.length - maxVersions)

      for (const version of toDelete) {
        // Decrement blob refCount
        const blob = await db.versionBlobs.get(version.blobId)
        if (blob) {
          if (blob.refCount <= 1) {
            // No more references, delete the blob
            await db.versionBlobs.delete(version.blobId)
          } else {
            // Decrement reference count
            await db.versionBlobs.update(version.blobId, { refCount: blob.refCount - 1 })
          }
        }

        // Delete the version record
        if (version.id) {
          await db.userData_history.delete(version.id)
        }
      }
    } catch (error) {
      console.error('Failed to cleanup old versions:', error)
    }
  }

  /**
   * Delete all versions for a component (current user only)
   */
  public async deleteAllVersions(
    pageId: string,
    componentId: string
  ): Promise<void> {
    try {
      const versions = await db.userData_history
        .where('[userId+pageId+componentId]')
        .equals([this.currentUserId, pageId, componentId])
        .toArray()

      for (const version of versions) {
        // Decrement blob refCount
        const blob = await db.versionBlobs.get(version.blobId)
        if (blob) {
          if (blob.refCount <= 1) {
            await db.versionBlobs.delete(version.blobId)
          } else {
            await db.versionBlobs.update(version.blobId, { refCount: blob.refCount - 1 })
          }
        }

        // Delete version record
        if (version.id) {
          await db.userData_history.delete(version.id)
        }
      }
    } catch (error) {
      console.error('Failed to delete all versions:', error)
      throw error
    }
  }

  /**
   * Get the most recent version (quick undo)
   */
  public async getPreviousVersion(
    pageId: string,
    componentId: string
  ): Promise<VersionSummary | null> {
    try {
      const versions = await this.getVersionHistory(pageId, componentId)
      return versions.length > 0 ? versions[0] : null
    } catch (error) {
      console.error('Failed to get previous version:', error)
      return null
    }
  }
}

// Export singleton instance
export const userDataService = UserDataService.getInstance()
