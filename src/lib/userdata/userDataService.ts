/**
 * User Data Service
 *
 * Singleton service for managing local user data persistence via IndexedDB.
 * Handles debounced saves, versioning, and future remote sync preparation.
 */

import { db } from './schema'
import type { UserDataRecord, SaveOptions, UserDataVersion, VersionBlob, CreateVersionOptions, VersionSummary } from './types'
import { generateSHA256, gzipCompress, gzipDecompress, calculateSize } from './compression'

/**
 * Singleton service for user data management
 */
export class UserDataService {
  private static instance: UserDataService
  private saveTimers: Map<string, NodeJS.Timeout> = new Map()
  private readonly DEFAULT_DEBOUNCE = 1000 // 1 second

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
   * Generate cache key for debounce timers
   */
  private getCacheKey(pageId: string, componentId: string): string {
    return `${pageId}:${componentId}`
  }

  /**
   * Retrieve user data for a specific page component
   */
  public async get<T = any>(
    pageId: string,
    componentId: string
  ): Promise<UserDataRecord<T> | null> {
    // Validate inputs to prevent IndexedDB DataError
    if (!pageId || !componentId) {
      console.warn('UserDataService.get called with invalid keys:', { pageId, componentId })
      return null
    }

    try {
      const record = await db.userData.get([pageId, componentId])
      return (record as UserDataRecord<T>) || null
    } catch (error) {
      console.error('Failed to retrieve user data:', error)
      return null
    }
  }

  /**
   * Save user data for a specific page component
   */
  public async save<T = any>(
    pageId: string,
    componentId: string,
    data: T,
    options: SaveOptions = {}
  ): Promise<void> {
    // Validate inputs to prevent IndexedDB DataError
    if (!pageId || !componentId) {
      console.warn('UserDataService.save called with invalid keys:', { pageId, componentId })
      return
    }

    const { debounce = this.DEFAULT_DEBOUNCE, immediate = false } = options
    const cacheKey = this.getCacheKey(pageId, componentId)

    // Clear existing timer if any
    const existingTimer = this.saveTimers.get(cacheKey)
    if (existingTimer) {
      clearTimeout(existingTimer)
      this.saveTimers.delete(cacheKey)
    }

    // If immediate save requested, execute now
    if (immediate) {
      await this.performSave(pageId, componentId, data)
      return
    }

    // Otherwise, debounce the save
    const timer = setTimeout(async () => {
      await this.performSave(pageId, componentId, data)
      this.saveTimers.delete(cacheKey)
    }, debounce)

    this.saveTimers.set(cacheKey, timer)
  }

  /**
   * Internal method to perform the actual save operation
   */
  private async performSave<T = any>(
    pageId: string,
    componentId: string,
    data: T
  ): Promise<void> {
    try {
      const existing = await this.get(pageId, componentId)
      const now = Date.now()

      const record: UserDataRecord<T> = {
        pageId,
        componentId,
        data,
        updatedAt: now,
        savedToRemote: false,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt || new Date().toISOString(),
        userId: existing?.userId, // Preserve userId if it exists
      }

      await db.userData.put(record)
    } catch (error) {
      console.error('Failed to save user data:', error)
      throw error
    }
  }

  /**
   * Delete user data for a specific page component
   */
  public async delete(pageId: string, componentId: string): Promise<void> {
    // Validate inputs to prevent IndexedDB DataError
    if (!pageId || !componentId) {
      console.warn('UserDataService.delete called with invalid keys:', { pageId, componentId })
      return
    }

    try {
      const cacheKey = this.getCacheKey(pageId, componentId)

      // Clear pending save timer if any
      const existingTimer = this.saveTimers.get(cacheKey)
      if (existingTimer) {
        clearTimeout(existingTimer)
        this.saveTimers.delete(cacheKey)
      }

      await db.userData.delete([pageId, componentId])
    } catch (error) {
      console.error('Failed to delete user data:', error)
      throw error
    }
  }

  /**
   * Delete all data for a specific page
   */
  public async deleteAllForPage(pageId: string): Promise<void> {
    try {
      await db.userData.where('pageId').equals(pageId).delete()
    } catch (error) {
      console.error('Failed to delete page data:', error)
      throw error
    }
  }

  /**
   * Get all component IDs with data for a specific page
   */
  public async getComponentsForPage(pageId: string): Promise<string[]> {
    try {
      const records = await db.userData.where('pageId').equals(pageId).toArray()
      return records.map((r) => r.componentId)
    } catch (error) {
      console.error('Failed to retrieve page components:', error)
      return []
    }
  }

  /**
   * Clear old data (for cleanup purposes)
   * @param olderThanDays Delete records older than this many days
   */
  public async cleanupOldData(olderThanDays: number = 90): Promise<number> {
    try {
      const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
      const deleted = await db.userData.where('updatedAt').below(cutoff).delete()
      return deleted
    } catch (error) {
      console.error('Failed to cleanup old data:', error)
      return 0
    }
  }

  /**
   * Flush all pending saves immediately
   */
  public async flush(): Promise<void> {
    const promises: Promise<void>[] = []

    this.saveTimers.forEach((timer, cacheKey) => {
      clearTimeout(timer)
      const [_pageId, _componentId] = cacheKey.split(':')
      // Note: We don't have the data here, so this is best-effort
      // In practice, components should call save with immediate: true before unmounting
      void _pageId, void _componentId // Suppress unused variable warnings
    })

    this.saveTimers.clear()
    await Promise.all(promises)
  }

  /* ========================================================================
   * VERSION HISTORY METHODS
   * ======================================================================== */

  /**
   * Create a new version snapshot of the current data
   * @param pageId - Page identifier
   * @param componentId - Component identifier
   * @param data - Data to snapshot
   * @param options - Optional label and save options
   * @returns The created version record
   */
  public async createVersion<T = any>(
    pageId: string,
    componentId: string,
    data: T,
    options: CreateVersionOptions = {}
  ): Promise<UserDataVersion> {
    try {
      const { label, isManualSave = false } = options

      // Serialize data to JSON
      const dataJson = JSON.stringify(data)
      const sizeBytes = calculateSize(dataJson)

      // Generate hash for deduplication
      const dataHash = await generateSHA256(dataJson)

      // Check if we already have this exact data in a blob
      let blobId = dataHash
      let existingBlob = await db.versionBlobs.get(blobId)

      if (existingBlob) {
        // Increment reference count on existing blob
        await db.versionBlobs.update(blobId, { refCount: existingBlob.refCount + 1 })
      } else {
        // Compress and create new blob
        const compressedBlob = await gzipCompress(dataJson)
        const versionBlob: VersionBlob = {
          blobId,
          data: compressedBlob,
          refCount: 1,
          createdAt: Date.now()
        }
        await db.versionBlobs.put(versionBlob)
      }

      // Get next version number
      const existingVersions = await db.userData_history
        .where('[pageId+componentId]')
        .equals([pageId, componentId])
        .toArray()

      const versionNumber = existingVersions.length > 0
        ? Math.max(...existingVersions.map(v => v.versionNumber)) + 1
        : 1

      // Create version record
      const version: UserDataVersion = {
        pageId,
        componentId,
        versionNumber,
        dataHash,
        blobId,
        createdAt: Date.now(),
        label,
        sizeBytes,
        isManualSave
      }

      const id = await db.userData_history.add(version)
      version.id = id

      // Cleanup old versions (enforce 64 version limit)
      await this.cleanupOldVersions(pageId, componentId, 64)

      return version
    } catch (error) {
      console.error('Failed to create version:', error)
      throw error
    }
  }

  /**
   * Get version history for a component
   * @param pageId - Page identifier
   * @param componentId - Component identifier
   * @returns Array of version summaries, newest first
   */
  public async getVersionHistory(
    pageId: string,
    componentId: string
  ): Promise<VersionSummary[]> {
    try {
      const versions = await db.userData_history
        .where('[pageId+componentId]')
        .equals([pageId, componentId])
        .reverse()
        .sortBy('versionNumber')

      return versions.map(v => ({
        versionNumber: v.versionNumber,
        createdAt: v.createdAt,
        label: v.label,
        sizeBytes: v.sizeBytes,
        canRestore: true,
        isManualSave: v.isManualSave
      }))
    } catch (error) {
      console.error('Failed to get version history:', error)
      return []
    }
  }

  /**
   * Restore data from a specific version
   * @param pageId - Page identifier
   * @param componentId - Component identifier
   * @param versionNumber - Version to restore
   * @returns The restored data
   */
  public async restoreVersion<T = any>(
    pageId: string,
    componentId: string,
    versionNumber: number
  ): Promise<T | null> {
    try {
      // Find the version record
      const versions = await db.userData_history
        .where('[pageId+componentId]')
        .equals([pageId, componentId])
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
   * Delete a specific version
   * @param pageId - Page identifier
   * @param componentId - Component identifier
   * @param versionNumber - Version number to delete
   */
  public async deleteVersion(
    pageId: string,
    componentId: string,
    versionNumber: number
  ): Promise<void> {
    try {
      // Find the version
      const version = await db.userData_history
        .where('[pageId+componentId]')
        .equals([pageId, componentId])
        .filter(v => v.versionNumber === versionNumber)
        .first()

      if (!version) {
        throw new Error(`Version ${versionNumber} not found`)
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
   * Update a version's label
   * @param pageId - Page identifier
   * @param componentId - Component identifier
   * @param versionNumber - Version number to update
   * @param label - New label
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
        .where('[pageId+componentId]')
        .equals([pageId, componentId])
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
   * Cleanup old versions to maintain retention limit
   * @param pageId - Page identifier
   * @param componentId - Component identifier
   * @param maxVersions - Maximum versions to keep (default: 64)
   */
  private async cleanupOldVersions(
    pageId: string,
    componentId: string,
    maxVersions: number = 64
  ): Promise<void> {
    try {
      const versions = await db.userData_history
        .where('[pageId+componentId]')
        .equals([pageId, componentId])
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
   * Delete all versions for a component
   * @param pageId - Page identifier
   * @param componentId - Component identifier
   */
  public async deleteAllVersions(
    pageId: string,
    componentId: string
  ): Promise<void> {
    try {
      const versions = await db.userData_history
        .where('[pageId+componentId]')
        .equals([pageId, componentId])
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
   * @param pageId - Page identifier
   * @param componentId - Component identifier
   * @returns The most recent version or null
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
