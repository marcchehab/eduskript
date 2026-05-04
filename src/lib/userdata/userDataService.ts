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
import type { UserDataRecord, SaveOptions, UserDataVersion, VersionBlob, CreateVersionOptions, VersionSummary } from './types'
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
      const kind: 'auto' | 'manual' | 'check' = options.kind ?? (isManualSave ? 'manual' : 'auto')
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

        // Compute next version number atomically inside the transaction.
        const existingVersions = await db.userData_history
          .where('[userId+pageId+componentId]')
          .equals([userId, pageId, componentId])
          .toArray()
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
   * Get version history for a component (current user only)
   */
  public async getVersionHistory(
    pageId: string,
    componentId: string
  ): Promise<VersionSummary[]> {
    try {
      const versions = await db.userData_history
        .where('[userId+pageId+componentId]')
        .equals([this.currentUserId, pageId, componentId])
        .reverse()
        .sortBy('versionNumber')

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
   * Restore data from a specific version (current user only)
   */
  public async restoreVersion<T = any>(
    pageId: string,
    componentId: string,
    versionNumber: number
  ): Promise<T | null> {
    try {
      // Find the version record
      const versions = await db.userData_history
        .where('[userId+pageId+componentId]')
        .equals([this.currentUserId, pageId, componentId])
        .filter(v => v.versionNumber === versionNumber)
        .toArray()

      if (versions.length === 0) {
        console.error('Version not found:', versionNumber)
        return null
      }

      const version = versions[0]

      // Get the blob
      const blob = await db.versionBlobs.get(version.blobId)
      if (!blob) {
        console.error('Version blob not found:', version.blobId)
        return null
      }

      // Decompress and parse
      const dataJson = await gzipDecompress(blob.data)
      const data = JSON.parse(dataJson) as T

      // Save the restored data as current (this will also create a new version via normal save flow)
      await this.save(pageId, componentId, data, { immediate: true })

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
   * Update a version's label (current user only)
   */
  public async updateVersionLabel(
    pageId: string,
    componentId: string,
    versionNumber: number,
    label: string
  ): Promise<void> {
    try {
      // Find the version
      const version = await db.userData_history
        .where('[userId+pageId+componentId]')
        .equals([this.currentUserId, pageId, componentId])
        .filter(v => v.versionNumber === versionNumber)
        .first()

      if (!version || !version.id) {
        throw new Error(`Version ${versionNumber} not found`)
      }

      // Update the label
      await db.userData_history.update(version.id, { label })
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
