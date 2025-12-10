'use client'

/**
 * User Data Provider
 *
 * React context that connects the user data service with authentication
 * and provides sync status to the UI.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { syncEngine, type SyncStatus } from './sync-engine'
import { userDataService } from './userDataService'

interface UserDataContextValue {
  /** Current sync status */
  syncStatus: SyncStatus
  /** Force immediate sync */
  forceSync: () => Promise<void>
  /** Whether user is authenticated (sync enabled) */
  isAuthenticated: boolean
  /** User ID if authenticated */
  userId: string | null
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

  const userId = session?.user?.id ?? null
  const isAuthenticated = status === 'authenticated' && userId !== null

  // Connect sync engine to auth state
  useEffect(() => {
    syncEngine.setUser(userId)
  }, [userId])

  // Subscribe to sync status changes
  useEffect(() => {
    return syncEngine.subscribe(setSyncStatus)
  }, [])

  const forceSync = useCallback(async () => {
    await syncEngine.sync()
  }, [])

  const value: UserDataContextValue = {
    syncStatus,
    forceSync,
    isAuthenticated,
    userId,
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
  const { isAuthenticated } = useUserDataContext()
  const [data, setData] = useState<T | null>(initialData)
  const [isLoading, setIsLoading] = useState(true)
  const [isSynced, setIsSynced] = useState(true)

  // Store initialData in a ref to avoid dependency issues
  // (callers often pass inline objects which would cause infinite loops)
  const initialDataRef = React.useRef(initialData)

  // Load data on mount (only re-run when pageId or componentId changes)
  useEffect(() => {
    let mounted = true

    const loadData = async () => {
      try {
        setIsLoading(true)
        const record = await userDataService.get<T>(pageId, componentId)

        if (mounted) {
          if (record) {
            setData(record.data)
            setIsSynced(record.savedToRemote)
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
  }, [pageId, componentId]) // Note: initialData NOT in deps - we use ref instead

  // Extract targeting from options
  const { targetType, targetId } = options

  const updateData = useCallback(
    async (newData: T, updateOptions: { immediate?: boolean } = {}) => {
      try {
        // Optimistic local update
        setData(newData)
        setIsSynced(false)

        // Save to IndexedDB
        await userDataService.save(pageId, componentId, newData, {
          immediate: updateOptions.immediate,
        })

        // Queue for cloud sync if authenticated
        if (isAuthenticated) {
          const record = await userDataService.get(pageId, componentId)
          if (record) {
            syncEngine.queueSync(
              componentId, // adapter
              pageId, // itemId
              JSON.stringify(newData),
              record.version,
              {
                immediate: updateOptions.immediate, // Pass immediate flag to bypass debounce
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
    [pageId, componentId, isAuthenticated, targetType, targetId]
  )

  return {
    data,
    updateData,
    isLoading,
    isSynced,
  }
}
