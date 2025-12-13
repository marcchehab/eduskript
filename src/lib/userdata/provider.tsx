'use client'

/**
 * User Data Provider
 *
 * React context that connects the user data service with authentication
 * and provides sync status to the UI.
 *
 * IMPORTANT: IndexedDB keys don't include userId, so we must clear the database
 * when the user changes to prevent cross-user data contamination.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { syncEngine, type SyncStatus } from './sync-engine'
import { userDataService } from './userDataService'
import { db } from './schema'

const LAST_USER_KEY = 'eduskript-last-user-id'
// Increment this to force a one-time IndexedDB clear for all users
// Use when fixing data corruption bugs or schema issues
const CACHE_VERSION = 3
const CACHE_VERSION_KEY = 'eduskript-cache-version'

interface UserDataContextValue {
  /** Current sync status */
  syncStatus: SyncStatus
  /** Force immediate sync */
  forceSync: () => Promise<void>
  /** Whether user is authenticated (sync enabled) */
  isAuthenticated: boolean
  /** User ID if authenticated */
  userId: string | null
  /** Whether the IndexedDB is ready (after user change cleanup) */
  isDbReady: boolean
  /** Annotation version mismatch state */
  annotationVersionMismatch: boolean
  /** Set annotation version mismatch */
  setAnnotationVersionMismatch: (mismatch: boolean) => void
  /** Callback to clear annotations on version mismatch */
  onClearAnnotations: (() => void) | null
  /** Set the clear annotations callback */
  setOnClearAnnotations: (callback: (() => void) | null) => void
}

const UserDataContext = createContext<UserDataContextValue | null>(null)

interface UserDataProviderProps {
  children: React.ReactNode
}

/**
 * Provider component that manages user data sync with authentication
 */
export function UserDataProvider({ children }: UserDataProviderProps) {
  const { data: session, status } = useSession()
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(syncEngine.getStatus())
  const [annotationVersionMismatch, setAnnotationVersionMismatch] = useState(false)
  const [onClearAnnotations, setOnClearAnnotationsState] = useState<(() => void) | null>(null)
  const [isDbReady, setIsDbReady] = useState(false)
  const userChangeHandledRef = useRef(false)

  const userId = session?.user?.id ?? null
  const isAuthenticated = status === 'authenticated' && userId !== null

  // CRITICAL: Clear IndexedDB when user changes OR when cache version is outdated
  // IndexedDB keys don't include userId, so different users on the same browser would
  // share cached data without this cleanup.
  useEffect(() => {
    if (status === 'loading') return // Wait for session to load

    const handleUserChange = async () => {
      // Prevent double handling
      if (userChangeHandledRef.current) return
      userChangeHandledRef.current = true

      try {
        const lastUserId = localStorage.getItem(LAST_USER_KEY)
        const storedVersion = parseInt(localStorage.getItem(CACHE_VERSION_KEY) || '0', 10)
        const currentUserId = userId ?? 'anonymous'

        // Clear if user changed OR if cache version is outdated
        const userChanged = lastUserId && lastUserId !== currentUserId
        const versionOutdated = storedVersion < CACHE_VERSION

        if (userChanged || versionOutdated) {
          console.log('[UserDataProvider] Clearing IndexedDB cache', {
            reason: versionOutdated ? 'version upgrade' : 'user change',
            from: lastUserId ? lastUserId.substring(0, 8) + '...' : 'none',
            to: currentUserId === 'anonymous' ? 'anonymous' : currentUserId.substring(0, 8) + '...',
            storedVersion,
            currentVersion: CACHE_VERSION
          })

          // Clear all tables in IndexedDB
          await db.userData.clear()
          await db.userData_history.clear()
          await db.versionBlobs.clear()

          console.log('[UserDataProvider] IndexedDB cleared successfully')
        }

        // Update last user and version
        if (userId) {
          localStorage.setItem(LAST_USER_KEY, userId)
        } else {
          localStorage.setItem(LAST_USER_KEY, 'anonymous')
        }
        localStorage.setItem(CACHE_VERSION_KEY, String(CACHE_VERSION))
      } catch (error) {
        console.error('[UserDataProvider] Failed to handle user change:', error)
      } finally {
        setIsDbReady(true)
        userChangeHandledRef.current = false
      }
    }

    handleUserChange()
  }, [userId, status])

  // Connect sync engine to auth state (only after DB is ready)
  useEffect(() => {
    if (!isDbReady) return
    syncEngine.setUser(userId)
  }, [userId, isDbReady])

  // Subscribe to sync status changes
  useEffect(() => {
    return syncEngine.subscribe(setSyncStatus)
  }, [])

  const forceSync = useCallback(async () => {
    await syncEngine.sync()
  }, [])

  // Wrapper to handle the callback setter properly
  const setOnClearAnnotations = useCallback((callback: (() => void) | null) => {
    setOnClearAnnotationsState(() => callback)
  }, [])

  const value: UserDataContextValue = {
    syncStatus,
    forceSync,
    isAuthenticated,
    userId,
    isDbReady,
    annotationVersionMismatch,
    setAnnotationVersionMismatch,
    onClearAnnotations,
    setOnClearAnnotations,
  }

  return (
    <UserDataContext.Provider value={value}>
      {children}
    </UserDataContext.Provider>
  )
}

/**
 * Hook to access user data context
 */
export function useUserDataContext(): UserDataContextValue {
  const context = useContext(UserDataContext)
  if (!context) {
    throw new Error('useUserDataContext must be used within a UserDataProvider')
  }
  return context
}

/**
 * Hook to get sync status
 */
export function useSyncStatus(): SyncStatus {
  const { syncStatus } = useUserDataContext()
  return syncStatus
}

/**
 * Options for useSyncedUserData hook
 */
export interface SyncedUserDataOptions {
  /** For teacher broadcasts: target type */
  targetType?: 'class' | 'student' | null
  /** For teacher broadcasts: target ID (classId or studentId) */
  targetId?: string | null
}

/**
 * Hook for synced user data
 *
 * This is an enhanced version of useUserData that integrates with the sync engine.
 * When data is saved, it's stored locally and queued for cloud sync.
 *
 * @param pageId - Page identifier
 * @param componentId - Component identifier (acts as adapter type)
 * @param initialData - Default data if nothing saved
 * @param options - Optional targeting for teacher broadcasts
 */
export function useSyncedUserData<T>(
  pageId: string,
  componentId: string,
  initialData: T | null = null,
  options: SyncedUserDataOptions = {}
): {
  data: T | null
  updateData: (data: T, updateOptions?: { immediate?: boolean }) => Promise<void>
  isLoading: boolean
  isSynced: boolean
} {
  const { isAuthenticated, isDbReady } = useUserDataContext()
  const [data, setData] = useState<T | null>(initialData)
  const [isLoading, setIsLoading] = useState(true)
  const [isSynced, setIsSynced] = useState(true)

  // Store initialData in a ref to avoid dependency issues
  // (callers often pass inline objects which would cause infinite loops)
  const initialDataRef = React.useRef(initialData)

  // Extract targeting from options
  const { targetType, targetId } = options

  // Determine if we're in broadcast mode (targeting is set)
  const isBroadcastMode = Boolean(targetType && targetId)

  // Load data on mount (re-run when pageId, componentId, or targeting changes)
  // IMPORTANT: Wait for isDbReady to ensure user change cleanup is complete
  useEffect(() => {
    // Don't load until DB is ready (after user change cleanup)
    if (!isDbReady) return

    let mounted = true

    // IMPORTANT: Reset data to initial immediately when targeting changes
    // This ensures we don't show stale data from a previous target
    setData(initialDataRef.current)

    const loadData = async () => {
      try {
        setIsLoading(true)

        // Always try to load from local IndexedDB first (includes targeting in key)
        const record = await userDataService.get<T>(pageId, componentId, { targetType, targetId })

        if (mounted) {
          if (record) {
            setData(record.data)
            setIsSynced(record.savedToRemote)
          } else if (isBroadcastMode) {
            // In broadcast mode, also try server if no local data
            // (in case teacher synced from another device)
            try {
              const response = await fetch(
                `/api/user-data/${componentId}/${encodeURIComponent(pageId)}?targetType=${targetType}&targetId=${targetId}`
              )
              if (response.ok) {
                const serverData = await response.json()
                if (mounted && serverData.data) {
                  setData(serverData.data as T)
                  setIsSynced(true)
                } else if (mounted) {
                  setData(initialDataRef.current)
                  setIsSynced(true)
                }
              } else if (mounted) {
                setData(initialDataRef.current)
                setIsSynced(true)
              }
            } catch {
              if (mounted) {
                setData(initialDataRef.current)
                setIsSynced(true)
              }
            }
          } else {
            setData(initialDataRef.current)
            setIsSynced(true)
          }
        }
      } catch (error) {
        console.error('Failed to load user data:', error)
        if (mounted) {
          setData(initialDataRef.current)
        }
      } finally {
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    loadData()

    return () => {
      mounted = false
    }
  }, [pageId, componentId, targetType, targetId, isBroadcastMode, isDbReady]) // Re-run when targeting changes or DB becomes ready

  const updateData = useCallback(
    async (newData: T, updateOptions: { immediate?: boolean } = {}) => {
      // Debug: log targeting info
      console.log('[useSyncedUserData.updateData]', {
        pageId,
        componentId,
        targetType,
        targetId,
        isBroadcastMode,
        dataPreview: JSON.stringify(newData).slice(0, 100)
      })

      try {
        // Optimistic local update
        setData(newData)
        setIsSynced(false)

        // In broadcast mode, always sync immediately (teachers want real-time updates)
        const shouldSyncImmediately = isBroadcastMode || updateOptions.immediate

        // Save to IndexedDB (with targeting in key)
        await userDataService.save(pageId, componentId, newData, {
          immediate: shouldSyncImmediately,
          targetType: targetType ?? null,
          targetId: targetId ?? null,
        })

        // Queue for cloud sync if authenticated
        if (isAuthenticated) {
          const record = await userDataService.get(pageId, componentId, { targetType, targetId })
          if (record) {
            syncEngine.queueSync(
              componentId, // adapter
              pageId, // itemId
              JSON.stringify(newData),
              record.version,
              {
                immediate: shouldSyncImmediately, // Immediate in broadcast mode
                targetType: targetType ?? null,
                targetId: targetId ?? null,
              }
            )
          }
        }

        setIsSynced(true)
      } catch (error) {
        console.error('Failed to update user data:', error)
        throw error
      }
    },
    [pageId, componentId, isAuthenticated, targetType, targetId, isBroadcastMode]
  )

  return {
    data,
    updateData,
    isLoading,
    isSynced,
  }
}
