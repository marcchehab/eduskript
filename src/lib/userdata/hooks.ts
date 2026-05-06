/**
 * User Data React Hooks
 *
 * Provides React hooks for components to interact with the user data service.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { userDataService } from './userDataService'
import { useUserDataContext } from './provider'
import type { UseUserDataResult, SaveOptions, VersionSummary, CreateVersionOptions, UserDataVersion } from './types'

/**
 * Hook for managing user data for a specific page component
 *
 * @param pageId - Database ID of the page
 * @param componentId - Component identifier (e.g., "code-editor-0", "annotations")
 * @param initialData - Default data if no saved data exists
 * @returns User data management interface
 *
 * @example
 * ```tsx
 * const { data, updateData, isLoading } = useUserData<CodeEditorData>(
 *   pageId,
 *   'code-editor-0',
 *   { files: [{ name: 'main.py', content: '' }], activeFileIndex: 0 }
 * )
 * ```
 */
export function useUserData<T>(
  pageId: string,
  componentId: string,
  initialData: T | null = null
): UseUserDataResult<T> {
  const { isDbReady } = useUserDataContext()
  const [data, setData] = useState<T | null>(initialData)
  const [isLoading, setIsLoading] = useState(true)
  const [isSynced, setIsSynced] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  // Use ref to track if component is mounted
  const isMountedRef = useRef(true)

  // Load data on mount. Wait for isDbReady so we don't read mid-migration
  // (the v2→v3 copy and the anonymous re-key both run inside the provider
  // before isDbReady flips true).
  useEffect(() => {
    isMountedRef.current = true
    if (!isDbReady) return

    const loadData = async () => {
      try {
        setIsLoading(true)
        const record = await userDataService.get<T>(pageId, componentId)

        if (isMountedRef.current) {
          if (record) {
            setData(record.data)
            setLastUpdated(record.updatedAt)
            setIsSynced(record.savedToRemote)
          } else {
            setData(initialData)
            setLastUpdated(null)
            setIsSynced(true)
          }
        }
      } catch (error) {
        console.error('Failed to load user data:', error)
        if (isMountedRef.current) {
          setData(initialData)
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false)
        }
      }
    }

    loadData()

    return () => {
      isMountedRef.current = false
    }
  }, [pageId, componentId, initialData, isDbReady])

  /**
   * Update user data with optional debouncing
   */
  const updateData = useCallback(
    async (newData: T, options: SaveOptions = {}) => {
      try {
        // Optimistically update local state
        setData(newData)
        setIsSynced(false)

        // Save to IndexedDB (debounced by default)
        await userDataService.save(pageId, componentId, newData, options)

        if (isMountedRef.current) {
          setLastUpdated(Date.now())
          setIsSynced(true)
        }
      } catch (error) {
        console.error('Failed to update user data:', error)
        throw error
      }
    },
    [pageId, componentId]
  )

  /**
   * Delete user data
   */
  const deleteData = useCallback(async () => {
    try {
      await userDataService.delete(pageId, componentId)

      if (isMountedRef.current) {
        setData(initialData)
        setLastUpdated(null)
        setIsSynced(true)
      }
    } catch (error) {
      console.error('Failed to delete user data:', error)
      throw error
    }
  }, [pageId, componentId, initialData])

  return {
    data,
    updateData,
    deleteData,
    isLoading,
    isSynced,
    lastUpdated,
  }
}

/**
 * Hook for checking if user data exists for a component
 *
 * @param pageId - Database ID of the page
 * @param componentId - Component identifier
 * @returns Whether data exists and the last updated timestamp
 */
export function useUserDataExists(
  pageId: string,
  componentId: string
): { exists: boolean; lastUpdated: number | null; isLoading: boolean } {
  const { isDbReady } = useUserDataContext()
  const [exists, setExists] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true
    if (!isDbReady) return

    const checkExists = async () => {
      try {
        setIsLoading(true)
        const record = await userDataService.get(pageId, componentId)

        if (isMounted) {
          setExists(!!record)
          setLastUpdated(record?.updatedAt || null)
        }
      } catch (error) {
        console.error('Failed to check user data:', error)
        if (isMounted) {
          setExists(false)
          setLastUpdated(null)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    checkExists()

    return () => {
      isMounted = false
    }
  }, [pageId, componentId, isDbReady])

  return { exists, lastUpdated, isLoading }
}

/* ========================================================================
 * VERSION HISTORY HOOKS
 * ======================================================================== */

/**
 * Hook for managing version history for a component
 *
 * @param pageId - Database ID of the page
 * @param componentId - Component identifier
 * @returns Version history and loading state
 *
 * @example
 * ```tsx
 * const { versions, isLoading, refresh } = useVersionHistory(pageId, 'code-editor-0')
 * ```
 */
export function useVersionHistory(
  pageId: string,
  componentId: string
): {
  versions: VersionSummary[]
  isLoading: boolean
  refresh: () => Promise<void>
} {
  const { isDbReady } = useUserDataContext()
  const [versions, setVersions] = useState<VersionSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadVersions = useCallback(async () => {
    try {
      setIsLoading(true)
      const history = await userDataService.getVersionHistory(pageId, componentId)
      setVersions(history)
    } catch (error) {
      console.error('Failed to load version history:', error)
      setVersions([])
    } finally {
      setIsLoading(false)
    }
  }, [pageId, componentId])

  useEffect(() => {
    if (!isDbReady) return
    loadVersions()
  }, [loadVersions, isDbReady])

  return {
    versions,
    isLoading,
    refresh: loadVersions
  }
}

/**
 * Hook for creating version snapshots
 *
 * @param pageId - Database ID of the page
 * @param componentId - Component identifier
 * @returns Function to create a version snapshot
 *
 * @example
 * ```tsx
 * const createVersion = useCreateVersion(pageId, 'code-editor-0')
 * await createVersion(data, { label: 'Before major refactor' })
 * ```
 */
export function useCreateVersion<T = any>(
  pageId: string,
  componentId: string
): (data: T, options?: CreateVersionOptions) => Promise<UserDataVersion> {
  return useCallback(
    async (data: T, options?: CreateVersionOptions): Promise<UserDataVersion> => {
      try {
        const version = await userDataService.createVersion(pageId, componentId, data, options)
        return version
      } catch (error) {
        console.error('Failed to create version:', error)
        throw error
      }
    },
    [pageId, componentId]
  )
}

/**
 * Hook for restoring versions. `restore` takes the row's IndexedDB
 * auto-increment id; the version's stored componentId/pageId determine
 * where the snapshot lands, so this works for both native and orphaned
 * rows. `restorePrevious` still resolves the most-recent row for this
 * pageId+componentId, then restores it by id.
 */
export function useRestoreVersion<T = any>(
  pageId: string,
  componentId: string
): {
  restore: (versionId: number) => Promise<T | null>
  restorePrevious: () => Promise<T | null>
  isRestoring: boolean
} {
  const [isRestoring, setIsRestoring] = useState(false)

  const restore = useCallback(
    async (versionId: number): Promise<T | null> => {
      try {
        setIsRestoring(true)
        const data = await userDataService.restoreVersion<T>(versionId)
        return data
      } catch (error) {
        console.error('Failed to restore version:', error)
        throw error
      } finally {
        setIsRestoring(false)
      }
    },
    []
  )

  const restorePrevious = useCallback(async (): Promise<T | null> => {
    try {
      setIsRestoring(true)
      const previousVersion = await userDataService.getPreviousVersion(pageId, componentId)
      if (!previousVersion || previousVersion.id == null) {
        console.warn('No previous version available')
        return null
      }
      const data = await userDataService.restoreVersion<T>(previousVersion.id)
      return data
    } catch (error) {
      console.error('Failed to restore previous version:', error)
      throw error
    } finally {
      setIsRestoring(false)
    }
  }, [pageId, componentId])

  return {
    restore,
    restorePrevious,
    isRestoring
  }
}

/**
 * Hook for deleting versions
 *
 * @param pageId - Database ID of the page
 * @param componentId - Component identifier
 * @returns Function to delete a version and loading state
 *
 * @example
 * ```tsx
 * const { deleteVersion, isDeleting } = useDeleteVersion(pageId, 'code-editor-0')
 * await deleteVersion(5) // Delete version 5
 * ```
 */
export function useDeleteVersion(
  pageId: string,
  componentId: string
): {
  deleteVersion: (target: { id?: number; versionNumber: number }) => Promise<void>
  isDeleting: boolean
} {
  const [isDeleting, setIsDeleting] = useState(false)

  // Prefer the row's unique IndexedDB id when available — versionNumber alone
  // can match multiple rows if any duplicates exist from before the
  // createVersion race fix. id-based deletes are always unambiguous.
  const deleteVersion = useCallback(
    async (target: { id?: number; versionNumber: number }): Promise<void> => {
      try {
        setIsDeleting(true)
        if (typeof target.id === 'number') {
          await userDataService.deleteVersion(pageId, componentId, target.id, { byId: true })
        } else {
          await userDataService.deleteVersion(pageId, componentId, target.versionNumber)
        }
      } catch (error) {
        console.error('Failed to delete version:', error)
        throw error
      } finally {
        setIsDeleting(false)
      }
    },
    [pageId, componentId]
  )

  return {
    deleteVersion,
    isDeleting
  }
}

/**
 * Hook for updating version labels. id-based: caller passes the row's
 * IndexedDB auto-increment id. Avoids the duplicate-versionNumber
 * ambiguity the prior signature had.
 */
export function useUpdateVersionLabel(): (versionId: number, label: string) => Promise<void> {
  return useCallback(
    async (versionId: number, label: string): Promise<void> => {
      try {
        await userDataService.updateVersionLabel(versionId, label)
      } catch (error) {
        console.error('Failed to update version label:', error)
        throw error
      }
    },
    []
  )
}

/**
 * Hook for orphaned-version discovery on a page. Returns code-editor
 * componentIds whose IndexedDB version-history rows exist but no
 * currently-mounted CodeEditor claims them. Re-runs the diff whenever the
 * mounted set changes.
 */
export function useOrphanedComponentIds(
  pageId: string,
  mountedIds: Set<string>
): { orphans: string[]; isLoading: boolean; refresh: () => Promise<void> } {
  const { isDbReady } = useUserDataContext()
  const [orphans, setOrphans] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!pageId) {
      setOrphans([])
      setIsLoading(false)
      return
    }
    try {
      setIsLoading(true)
      const all = await userDataService.getCodeEditorComponentIdsWithHistory(pageId)
      setOrphans(all.filter((id) => !mountedIds.has(id)))
    } catch (error) {
      console.error('Failed to load orphaned componentIds:', error)
      setOrphans([])
    } finally {
      setIsLoading(false)
    }
  }, [pageId, mountedIds])

  useEffect(() => {
    if (!isDbReady) return
    refresh()
  }, [refresh, isDbReady])

  return { orphans, isLoading, refresh }
}

/**
 * Hook returning a function that moves all version-history rows from a
 * given orphan componentId onto the editor identified by `toComponentId`.
 * See `userDataService.reassignVersionHistory` for safety details.
 */
export function useReassignVersionHistory(
  pageId: string,
  toComponentId: string
): (fromComponentId: string) => Promise<number> {
  return useCallback(
    (fromComponentId: string) =>
      userDataService.reassignVersionHistory(pageId, fromComponentId, toComponentId),
    [pageId, toComponentId]
  )
}
