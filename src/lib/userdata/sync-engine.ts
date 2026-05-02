/**
 * Sync Engine for User Data Service
 *
 * Handles background synchronization between IndexedDB and server.
 * Features:
 * - Debounced batched syncs
 * - Retry with exponential backoff
 * - Online/offline detection
 * - Conflict resolution via adapters
 */

import { db } from './schema'
import { getAdapter } from './adapters'

export interface SyncOperation {
  id: string
  type: 'sync' | 'fetch' | 'merge' | 'conflict' | 'error'
  adapter: string
  itemId: string
  timestamp: Date
  status: 'pending' | 'success' | 'failed'
  message?: string
}

export interface SyncStatus {
  pending: number
  lastSync: Date | null
  error: string | null
  online: boolean
  syncing: boolean
  /** Recent operations log (max 50) */
  operations: SyncOperation[]
}

export interface SyncItem {
  adapter: string
  itemId: string
  data: string
  version: number
  updatedAt: number
  // Optional targeting for teacher broadcasts/feedback/public
  // Uses empty string (not null) for IndexedDB compound key compatibility
  targetType?: 'class' | 'student' | 'page' | ''
  targetId?: string
}

export interface ManifestItem {
  adapter: string
  itemId: string
  version: number
  updatedAt: number
}

type SyncStatusListener = (status: SyncStatus) => void

/**
 * Singleton sync engine that manages background synchronization
 */
export class SyncEngine {
  private static instance: SyncEngine | null = null

  private userId: string | null = null
  private syncQueue: Map<string, SyncItem> = new Map()
  private syncTimeout: ReturnType<typeof setTimeout> | null = null
  private retryTimeout: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  // Once true, the server has told us this user is on a free plan and
  // cloud sync is not allowed. Stop hammering the endpoint; data stays
  // in IndexedDB. Reset only on setUser() (e.g., after upgrade + re-login).
  private gatedByPlan = false
  private readonly MAX_RETRIES = 5
  private readonly SYNC_DEBOUNCE_MS = 2000
  private readonly BASE_RETRY_MS = 5000

  private readonly MAX_OPERATIONS = 50

  private status: SyncStatus = {
    pending: 0,
    lastSync: null,
    error: null,
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    syncing: false,
    operations: [],
  }

  private listeners: Set<SyncStatusListener> = new Set()

  private constructor() {
    // Set up online/offline listeners
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline)
      window.addEventListener('offline', this.handleOffline)
    }
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): SyncEngine {
    if (!SyncEngine.instance) {
      SyncEngine.instance = new SyncEngine()
    }
    return SyncEngine.instance
  }

  /**
   * Set the current user ID (call when auth state changes)
   */
  public setUser(userId: string | null): void {
    const wasLoggedIn = this.userId !== null
    this.userId = userId
    // New session — give cloud sync another chance (user may have upgraded).
    this.gatedByPlan = false

    if (userId && !wasLoggedIn) {
      // User just logged in - do initial sync
      this.initialSync()
    } else if (!userId && wasLoggedIn) {
      // User logged out - clear queue
      this.syncQueue.clear()
      this.updateStatus({ pending: 0 })
    }
  }

  /**
   * Queue data for sync
   * @param adapter - Adapter type (e.g., 'quiz-{id}')
   * @param itemId - Item identifier (e.g., pageId)
   * @param data - JSON stringified data
   * @param version - Data version number
   * @param options.immediate - If true, sync immediately without debounce (for quiz submissions)
   * @param options.targetType - For teacher broadcasts: 'class' or 'student'
   * @param options.targetId - For teacher broadcasts: classId or studentId
   */
  public queueSync(
    adapter: string,
    itemId: string,
    data: string,
    version: number,
    options: {
      immediate?: boolean
      targetType?: 'class' | 'student' | 'page' | null
      targetId?: string | null
    } = {}
  ): void {
    // Include targeting in key to allow same adapter/itemId with different targets
    const targetKey = options.targetType && options.targetId
      ? `:${options.targetType}:${options.targetId}`
      : ''
    const key = `${adapter}:${itemId}${targetKey}`

    this.syncQueue.set(key, {
      adapter,
      itemId,
      data,
      version,
      updatedAt: Date.now(),
      // Use empty string for IndexedDB compatibility (null not supported in compound keys)
      targetType: options.targetType ?? '',
      targetId: options.targetId ?? '',
    })

    this.updateStatus({ pending: this.syncQueue.size })

    // If immediate, sync now without debounce
    if (options.immediate) {
      if (this.syncTimeout) {
        clearTimeout(this.syncTimeout)
        this.syncTimeout = null
      }
      this.sync()
      return
    }

    // Debounce the sync
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout)
    }

    this.syncTimeout = setTimeout(() => {
      this.sync()
    }, this.SYNC_DEBOUNCE_MS)
  }

  /**
   * Force immediate sync
   */
  public async sync(): Promise<void> {
    if (!this.userId || this.syncQueue.size === 0) {
      return
    }

    // Free plan: server returned 402 once; stop syncing for this session.
    // Data stays in IndexedDB (still readable, still durable per-device).
    if (this.gatedByPlan) {
      this.syncQueue.clear()
      this.updateStatus({ pending: 0 })
      return
    }

    // Skip if offline (but items remain in queue)
    if (!this.status.online) {
      return
    }

    if (this.status.syncing) {
      // Already syncing, will be queued
      return
    }

    this.updateStatus({ syncing: true, error: null })

    const batch = Array.from(this.syncQueue.values())
    this.syncQueue.clear()

    // Log pending operations
    const operationIds = batch.map((item) =>
      this.logOperation('sync', item.adapter, item.itemId, 'pending', `Syncing ${item.adapter}`)
    )

    try {
      const response = await fetch('/api/user-data/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: batch }),
      })

      // 402 Payment Required → free plan. Mark as gated, drop the batch
      // (still safe in IndexedDB), and don't retry. Logged at info level.
      if (response.status === 402) {
        this.gatedByPlan = true
        await this.markSynced(batch)
        operationIds.forEach((id) => this.updateOperation(id, 'success'))
        this.syncQueue.clear()
        this.updateStatus({ pending: 0, syncing: false, error: null })
        console.info('[SyncEngine] Cloud sync disabled (free plan). Data stays local.')
        return
      }

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status}`)
      }

      const result = await response.json()

      // Mark items as synced in local DB
      await this.markSynced(batch)

      // Mark operations as successful
      operationIds.forEach((id) => this.updateOperation(id, 'success'))

      // Handle any conflicts returned by server
      if (result.conflicts && result.conflicts.length > 0) {
        await this.handleConflicts(result.conflicts)
      }

      // Handle S3 upload errors (snaps that failed to upload to storage)
      if (result.s3Errors && result.s3Errors.length > 0) {
        // Log each S3 error as a failed operation
        result.s3Errors.forEach((errorMsg: string) => {
          this.logOperation('error', 'snaps', 'storage', 'failed', errorMsg)
        })
        // Set error state so the indicator shows there's a problem
        this.updateStatus({
          pending: this.syncQueue.size,
          lastSync: new Date(),
          syncing: false,
          error: `${result.s3Errors.length} snap(s) failed to upload to storage`,
        })
        return
      }

      this.retryCount = 0
      this.updateStatus({
        pending: this.syncQueue.size,
        lastSync: new Date(),
        syncing: false,
        error: null,
      })
    } catch (error) {
      console.error('[SyncEngine] Sync failed:', error)
      const errorMsg = error instanceof Error ? error.message : 'Sync failed'

      // Mark operations as failed
      operationIds.forEach((id) => this.updateOperation(id, 'failed', errorMsg))

      // Re-queue failed items
      batch.forEach((item) => {
        this.syncQueue.set(`${item.adapter}:${item.itemId}`, item)
      })

      this.updateStatus({
        pending: this.syncQueue.size,
        syncing: false,
        error: errorMsg,
      })

      // Retry with exponential backoff
      this.scheduleRetry()
    }
  }

  /**
   * Get current sync status
   */
  public getStatus(): SyncStatus {
    return { ...this.status }
  }

  /**
   * Subscribe to status changes
   */
  public subscribe(listener: SyncStatusListener): () => void {
    this.listeners.add(listener)
    // Immediately call with current status
    listener(this.status)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Initial sync when user logs in
   * Fetches manifest from server and syncs newer items
   */
  private async initialSync(): Promise<void> {
    if (!this.userId) return

    try {
      // Get server manifest
      const response = await fetch('/api/user-data/manifest')
      if (!response.ok) {
        if (response.status === 401) {
          // Not authenticated - skip sync
          return
        }
        throw new Error(`Failed to fetch manifest: ${response.status}`)
      }

      const manifest: ManifestItem[] = await response.json()

      // Check for malformed entries and clean them up
      const malformedEntries = manifest.filter(item => !item.itemId || !item.adapter)
      if (malformedEntries.length > 0) {
        console.warn('[SyncEngine] Found malformed entries, cleaning up:', malformedEntries)
        await this.cleanupMalformedEntries()
      }

      // Compare with local data and sync as needed
      for (const serverItem of manifest) {
        // Skip malformed entries (already cleaned up above)
        if (!serverItem.itemId || !serverItem.adapter) {
          continue
        }

        // Use 4-element key: [pageId, componentId, targetType, targetId]
        // For initial sync, we're looking for personal data (empty targeting)
        const localRecord = await db.userData.get([serverItem.itemId, serverItem.adapter, '', ''])

        if (!localRecord || serverItem.updatedAt > localRecord.updatedAt) {
          // Server has newer data - fetch and merge
          await this.fetchAndMerge(serverItem)
        } else if (localRecord && localRecord.updatedAt > serverItem.updatedAt) {
          // Local has newer data - queue for sync
          this.queueSync(
            serverItem.adapter,
            serverItem.itemId,
            JSON.stringify(localRecord.data),
            localRecord.version
          )
        }
      }

      // Also push any unsynced local data not on server.
      // Skip localOnly records — those are deliberately on-device only
      // (e.g. student-uploaded binaries) and must never reach the server.
      const unsyncedRecords = await db.userData
        .filter((record) => record.savedToRemote === false && !record.localOnly)
        .toArray()

      for (const record of unsyncedRecords) {
        this.queueSync(
          record.componentId, // adapter
          record.pageId, // itemId
          JSON.stringify(record.data),
          record.version
        )
      }

      this.updateStatus({ lastSync: new Date() })
    } catch (error) {
      console.error('[SyncEngine] Initial sync failed:', error)
      // Don't show error to user on initial sync failure
    }
  }

  /**
   * Fetch item from server and merge with local
   */
  private async fetchAndMerge(serverItem: ManifestItem): Promise<void> {
    const opId = this.logOperation('fetch', serverItem.adapter, serverItem.itemId, 'pending', 'Fetching from server')

    try {
      const response = await fetch(
        `/api/user-data/${encodeURIComponent(serverItem.adapter)}/${encodeURIComponent(serverItem.itemId)}`
      )

      // 404 means the item doesn't exist on the server yet - that's fine, just skip
      if (response.status === 404) {
        this.updateOperation(opId, 'success', 'No server data (404)')
        return
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch item: ${response.status}`)
      }

      const serverData = await response.json()
      const localRecord = await db.userData.get([serverItem.itemId, serverItem.adapter])

      let mergedData = serverData.data
      let didMerge = false

      // If we have local data, try to merge
      if (localRecord && localRecord.data) {
        const adapter = getAdapter(serverItem.adapter)
        if (adapter?.merge) {
          try {
            const localData = adapter.deserialize(JSON.stringify(localRecord.data))
            const remoteData = adapter.deserialize(JSON.stringify(serverData.data))
            mergedData = adapter.merge(localData, remoteData)
            didMerge = true
          } catch {
            // Merge failed, use server data
            mergedData = serverData.data
          }
        }
      }

      // Update local DB (use '' for targeting since this is personal data)
      await db.userData.put({
        pageId: serverItem.itemId,
        componentId: serverItem.adapter,
        data: mergedData,
        updatedAt: serverItem.updatedAt,
        savedToRemote: true,
        version: serverData.version,
        createdAt: localRecord?.createdAt || new Date().toISOString(),
        targetType: localRecord?.targetType ?? '',
        targetId: localRecord?.targetId ?? '',
      })

      this.updateOperation(opId, 'success', didMerge ? 'Merged with local' : 'Fetched from server')
    } catch (error) {
      console.error('[SyncEngine] Fetch and merge failed:', error)
      this.updateOperation(opId, 'failed', error instanceof Error ? error.message : 'Fetch failed')
    }
  }

  /**
   * Handle conflicts returned by server
   */
  private async handleConflicts(
    conflicts: Array<{
      adapter: string
      itemId: string
      serverData: unknown
      serverVersion: number
      targetType?: string | null
      targetId?: string | null
    }>
  ): Promise<void> {
    for (const conflict of conflicts) {
      const opId = this.logOperation('conflict', conflict.adapter, conflict.itemId, 'pending', 'Resolving conflict')

      // Use targeting if provided, otherwise empty strings for personal data
      const targetType = conflict.targetType ?? ''
      const targetId = conflict.targetId ?? ''

      // Use 4-element key for conflict resolution WITH targeting
      const localRecord = await db.userData.get([conflict.itemId, conflict.adapter, targetType, targetId])
      if (!localRecord) {
        this.updateOperation(opId, 'failed', 'Local record not found')
        continue
      }

      const adapter = getAdapter(conflict.adapter)
      if (!adapter?.merge) {
        // No merge strategy - server wins
        await db.userData.put({
          ...localRecord,
          data: conflict.serverData,
          version: conflict.serverVersion,
          savedToRemote: true,
        })
        this.updateOperation(opId, 'success', 'Server version accepted')
        continue
      }

      try {
        const localData = adapter.deserialize(JSON.stringify(localRecord.data))
        const remoteData = adapter.deserialize(JSON.stringify(conflict.serverData))
        const mergedData = adapter.merge(localData, remoteData)

        await db.userData.put({
          ...localRecord,
          data: mergedData,
          version: conflict.serverVersion + 1,
          savedToRemote: false, // Need to sync merged result
        })

        // Queue the merged data for sync WITH targeting preserved
        this.queueSync(
          conflict.adapter,
          conflict.itemId,
          JSON.stringify(mergedData),
          conflict.serverVersion + 1,
          {
            targetType: (targetType === 'class' || targetType === 'student' || targetType === 'page') ? targetType : null,
            targetId: targetId || null,
          }
        )

        this.updateOperation(opId, 'success', 'Merged local and server')
      } catch {
        // Merge failed - server wins
        await db.userData.put({
          ...localRecord,
          data: conflict.serverData,
          version: conflict.serverVersion,
          savedToRemote: true,
        })
        this.updateOperation(opId, 'success', 'Merge failed, server version accepted')
      }
    }
  }

  /**
   * Mark items as synced in local DB
   */
  private async markSynced(items: SyncItem[]): Promise<void> {
    for (const item of items) {
      // Use 4-element key including targeting (if present)
      const record = await db.userData.get([item.itemId, item.adapter, item.targetType ?? '', item.targetId ?? ''])
      if (record) {
        await db.userData.put({
          ...record,
          savedToRemote: true,
        })
      }
    }
  }

  /**
   * Schedule retry with exponential backoff
   */
  private scheduleRetry(): void {
    if (this.retryCount >= this.MAX_RETRIES) {
      console.warn('[SyncEngine] Max retries reached, giving up')
      return
    }

    const delay = this.BASE_RETRY_MS * Math.pow(2, this.retryCount)
    this.retryCount++

    this.retryTimeout = setTimeout(() => {
      if (this.status.online) {
        this.sync()
      }
    }, delay)
  }

  private handleOnline = (): void => {
    this.updateStatus({ online: true })
    // Try to sync pending items
    if (this.syncQueue.size > 0) {
      this.sync()
    }
  }

  private handleOffline = (): void => {
    this.updateStatus({ online: false })
    // Clear any pending timeouts
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout)
      this.syncTimeout = null
    }
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
      this.retryTimeout = null
    }
  }

  private updateStatus(partial: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...partial }
    this.listeners.forEach((listener) => listener(this.status))
  }

  /**
   * Log an operation to the operations list
   */
  private logOperation(
    type: SyncOperation['type'],
    adapter: string,
    itemId: string,
    status: SyncOperation['status'],
    message?: string
  ): string {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const operation: SyncOperation = {
      id,
      type,
      adapter,
      itemId,
      timestamp: new Date(),
      status,
      message,
    }

    // Add to front and trim to max
    const operations = [operation, ...this.status.operations].slice(0, this.MAX_OPERATIONS)
    this.updateStatus({ operations })

    return id
  }

  /**
   * Update an existing operation's status
   */
  private updateOperation(id: string, status: SyncOperation['status'], message?: string): void {
    const operations = this.status.operations.map((op) =>
      op.id === id ? { ...op, status, message: message ?? op.message } : op
    )
    this.updateStatus({ operations })
  }

  /**
   * Clear all operations from the log
   */
  public clearOperations(): void {
    this.updateStatus({ operations: [] })
  }

  /**
   * Call cleanup endpoint to remove malformed entries (empty itemId)
   */
  private async cleanupMalformedEntries(): Promise<void> {
    try {
      const response = await fetch('/api/user-data/cleanup', { method: 'DELETE' })
      // Silently process cleanup result
      if (response.ok) {
        await response.json()
      }
    } catch {
      // Silently ignore cleanup errors
    }
  }

  /**
   * Cleanup - call on app unmount
   */
  public destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline)
      window.removeEventListener('offline', this.handleOffline)
    }
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout)
    }
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
    }
    this.listeners.clear()
    SyncEngine.instance = null
  }
}

// Export singleton getter
export const syncEngine = SyncEngine.getInstance()
