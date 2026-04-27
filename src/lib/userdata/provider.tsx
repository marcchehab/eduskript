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
import { useExamSession } from '@/contexts/exam-session-context'
import { syncEngine, type SyncStatus } from './sync-engine'
import { userDataService } from './userDataService'
import { db } from './schema'
import { createLogger } from '@/lib/logger'

const log = createLogger('userdata:provider')

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
 *
 * Supports two authentication methods:
 * 1. NextAuth session (regular browser login)
 * 2. Exam session context (SEB mode, where NextAuth isn't available)
 */
export function UserDataProvider({ children }: UserDataProviderProps) {
  const { data: session, status } = useSession()
  const examSession = useExamSession()
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(syncEngine.getStatus())
  const [annotationVersionMismatch, setAnnotationVersionMismatch] = useState(false)
  const [onClearAnnotations, setOnClearAnnotationsState] = useState<(() => void) | null>(null)
  const [isDbReady, setIsDbReady] = useState(false)
  const userChangeHandledRef = useRef(false)

  // Use NextAuth session first, fall back to exam session
  const userId = session?.user?.id ?? examSession.user?.id ?? null
  const isAuthenticated = (status === 'authenticated' && session?.user?.id !== null) || examSession.isInExamSession

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
          log('Clearing IndexedDB cache', {
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

          log('IndexedDB cleared successfully')
        }

        // Update last user and version
        if (userId) {
          localStorage.setItem(LAST_USER_KEY, userId)
        } else {
          localStorage.setItem(LAST_USER_KEY, 'anonymous')
        }
        localStorage.setItem(CACHE_VERSION_KEY, String(CACHE_VERSION))
      } catch (error) {
        log.error('Failed to handle user change:', error)
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
  /** For broadcasts: target type */
  targetType?: 'class' | 'student' | 'page' | null
  /** For broadcasts: target ID (classId, studentId, or pageId for public) */
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
export interface UpdateDataOptions {
  immediate?: boolean
  // Optional targeting overrides - used when saving before switching targets
  targetTypeOverride?: 'class' | 'student' | 'page' | null
  targetIdOverride?: string | null
}

export function useSyncedUserData<T>(
  pageId: string,
  componentId: string,
  initialData: T | null = null,
  options: SyncedUserDataOptions = {}
): {
  data: T | null
  updateData: (data: T, updateOptions?: UpdateDataOptions) => Promise<void>
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
        const localRecord = await userDataService.get<T>(pageId, componentId, { targetType, targetId })

        // For broadcast mode (class/student/page), also check server and compare versions
        // This ensures we get the newest data regardless of which device saved it
        // Note: page broadcasts need this too so authors see their own public content
        if (isBroadcastMode) {
          try {
            const response = await fetch(
              `/api/user-data/${encodeURIComponent(componentId)}/${encodeURIComponent(pageId)}?targetType=${targetType}&targetId=${targetId}`
            )
            if (response.ok) {
              const serverData = await response.json()
              const serverVersion = serverData.version ?? 0
              const localVersion = localRecord?.version ?? 0

              if (mounted) {
                if (serverData.data && serverVersion >= localVersion) {
                  // Server has same or newer version - use server data
                  setData(serverData.data as T)
                  setIsSynced(true)
                  // Update local cache with server data if server is newer
                  if (serverVersion > localVersion) {
                    await userDataService.save(pageId, componentId, serverData.data, {
                      immediate: true,
                      targetType,
                      targetId
                    })
                  }
                } else if (localRecord) {
                  // Local has newer version - use local data
                  setData(localRecord.data)
                  setIsSynced(localRecord.savedToRemote)
                } else {
                  setData(initialDataRef.current)
                  setIsSynced(true)
                }
              }
            } else if (mounted) {
              // Server fetch failed - fall back to local data
              if (localRecord) {
                setData(localRecord.data)
                setIsSynced(localRecord.savedToRemote)
              } else {
                setData(initialDataRef.current)
                setIsSynced(true)
              }
            }
          } catch {
            // Network error - fall back to local data
            if (mounted) {
              if (localRecord) {
                setData(localRecord.data)
                setIsSynced(localRecord.savedToRemote)
              } else {
                setData(initialDataRef.current)
                setIsSynced(true)
              }
            }
          }
        } else if (mounted) {
          // Non-broadcast mode (personal data) - just use local
          if (localRecord) {
            setData(localRecord.data)
            setIsSynced(localRecord.savedToRemote)
          } else {
            setData(initialDataRef.current)
            setIsSynced(true)
          }
        }
      } catch (error) {
        log.error('Failed to load user data:', error)
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
    async (newData: T, updateOptions: UpdateDataOptions = {}) => {
      // Use overrides if provided, otherwise use hook's targeting
      const effectiveTargetType = updateOptions.targetTypeOverride !== undefined
        ? updateOptions.targetTypeOverride
        : targetType
      const effectiveTargetId = updateOptions.targetIdOverride !== undefined
        ? updateOptions.targetIdOverride
        : targetId
      const effectiveIsBroadcastMode = Boolean(effectiveTargetType && effectiveTargetId)

      // Debug: log targeting info
      log('updateData', {
        pageId,
        componentId,
        targetType: effectiveTargetType,
        targetId: effectiveTargetId,
        isBroadcastMode: effectiveIsBroadcastMode,
        hasOverride: updateOptions.targetTypeOverride !== undefined,
        dataPreview: JSON.stringify(newData).slice(0, 100)
      })

      try {
        // Optimistic local update (only if not using overrides - overrides are for saving old data)
        if (updateOptions.targetTypeOverride === undefined) {
          setData(newData)
          setIsSynced(false)
        }

        // In broadcast mode, always sync immediately (teachers want real-time updates)
        const shouldSyncImmediately = effectiveIsBroadcastMode || updateOptions.immediate

        // Save to IndexedDB (with targeting in key)
        await userDataService.save(pageId, componentId, newData, {
          immediate: shouldSyncImmediately,
          targetType: effectiveTargetType ?? null,
          targetId: effectiveTargetId ?? null,
        })

        // Queue for cloud sync if authenticated
        if (isAuthenticated) {
          const record = await userDataService.get(pageId, componentId, {
            targetType: effectiveTargetType,
            targetId: effectiveTargetId
          })
          if (record) {
            syncEngine.queueSync(
              componentId, // adapter
              pageId, // itemId
              JSON.stringify(newData),
              record.version,
              {
                immediate: shouldSyncImmediately, // Immediate in broadcast mode
                targetType: effectiveTargetType ?? null,
                targetId: effectiveTargetId ?? null,
              }
            )
          }
        }

        if (updateOptions.targetTypeOverride === undefined) {
          setIsSynced(true)
        }
      } catch (error) {
        log.error('Failed to update user data:', error)
        throw error
      }
    },
    // Note: isBroadcastMode is derived from targetType && targetId, so not needed in deps
    [pageId, componentId, isAuthenticated, targetType, targetId]
  )

  return {
    data,
    updateData,
    isLoading,
    isSynced,
  }
}
