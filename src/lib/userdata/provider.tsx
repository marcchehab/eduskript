'use client'

/**
 * User Data Provider
 *
 * React context that connects the user data service with authentication
 * and provides sync status to the UI.
 *
 * USERID SCOPING: As of v3 the IndexedDB primary keys include userId, so
 * different users on the same browser are isolated without wiping. The old
 * wipe-on-user-change logic (which destroyed local autosave history) is
 * gone. Existing v2 data is migrated forward by `runOneTimeMigrationV2ToV3`,
 * and anonymous-mode work is re-keyed under the logged-in user via
 * `migrateAnonymousIfNeeded` on first login.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { syncEngine, type SyncStatus } from './sync-engine'
import { userDataService, REMOTE_CHANGE_SOURCE } from './userDataService'
import { recordDeletions, removedCollectionIds, getAdapter } from './adapters'
import { runOneTimeMigrationV2ToV3, migrateAnonymousIfNeeded, sweepLegacyTable } from './migrations'
import { createLogger } from '@/lib/logger'
import { useCurrentSite } from '@/contexts/current-site-context'

const log = createLogger('userdata:provider')

const LAST_USER_KEY = 'eduskript-last-user-id'
// See handleUserChange: how long the IndexedDB setup may block user-data loads.
const DB_READY_TIMEOUT_MS = 5000

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
  /** Report the SEB exam-session user up to this root provider. ExamDataSync is
   *  mounted below us (in the exam page), so we can't read the exam-session
   *  React context — it calls this instead so we resolve a real userId, count
   *  as authenticated, and set the sync engine (rather than clobbering null). */
  setExamSessionUser: (userId: string | null) => void
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
  // SEB exam-session user, reported up from ExamDataSync (mounted below us in
  // the exam page). We can't read the exam-session context from this root
  // provider, so the child pushes it here.
  const [examUserId, setExamUserId] = useState<string | null>(null)
  const setExamSessionUser = useCallback((id: string | null) => setExamUserId(id), [])
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(syncEngine.getStatus())
  const [annotationVersionMismatch, setAnnotationVersionMismatch] = useState(false)
  const [onClearAnnotations, setOnClearAnnotationsState] = useState<(() => void) | null>(null)
  const [isDbReady, setIsDbReady] = useState(false)
  const userChangeHandledRef = useRef(false)

  // Use NextAuth session first, fall back to the reported SEB exam-session user.
  const userId = session?.user?.id ?? examUserId ?? null
  const isAuthenticated = (status === 'authenticated' && session?.user?.id != null) || examUserId != null

  // On userId change: run any pending DB migrations, then update the service's
  // active userId, then update the sync engine. No wiping — different users on
  // one browser are isolated by userId in the primary key.
  useEffect(() => {
    if (status === 'loading') return // Wait for session to load

    const handleUserChange = async () => {
      if (userChangeHandledRef.current) return
      userChangeHandledRef.current = true

      // IndexedDB.open can hang without settling (seen in Safari). isDbReady
      // gates every useSyncedUserData load, so a hang left the whole page
      // without user data. After DB_READY_TIMEOUT_MS mark it ready anyway:
      // the hooks then load what they can, the chain below keeps running and
      // finishes later if the database ever answers.
      const readyTimer = setTimeout(() => {
        log.warn(`User data setup did not finish within ${DB_READY_TIMEOUT_MS} ms; continuing without waiting`)
        setIsDbReady(true)
      }, DB_READY_TIMEOUT_MS)

      try {
        const currentUserId = userId ?? 'anonymous'

        // 1. v2 → v3 schema migration (idempotent; gated by localStorage flag).
        await runOneTimeMigrationV2ToV3()

        // 1b. Copy rows written by tabs still on pre-site-scoping code
        // (v1 table) into the site-scoped table as legacy (bughunt #2).
        await sweepLegacyTable()

        // 2. anonymous → real userId re-key. Gated on IndexedDB state, not
        // localStorage — first-render with a cached NextAuth session would
        // skip past 'anonymous' before the provider ever wrote it back, and
        // private-mode browsing drops the localStorage hint entirely. The
        // migration itself is idempotent on an empty anonymous tier.
        if (currentUserId !== 'anonymous') {
          await migrateAnonymousIfNeeded(currentUserId)
        }

        // 3. Service swap. setCurrentUser awaits flush() so debounced saves
        // started under the previous userId land under that userId.
        await userDataService.setCurrentUser(currentUserId)

        // 4. Persist current userId so the v2→v3 migration on a future
        // browser version can still infer the owner of pre-v3 records.
        localStorage.setItem(LAST_USER_KEY, currentUserId)
      } catch (error) {
        log.error('Failed to handle user change:', error)
      } finally {
        clearTimeout(readyTimer)
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
    setExamSessionUser,
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
  /**
   * When true, the record stays on-device only — the sync engine never pushes it.
   * Used for student-uploaded binaries (images, CSVs) that we deliberately keep
   * off the server. Persisted on the record, so it survives reload.
   */
  localOnly?: boolean
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
  // Site scoping: explicit site from this component's CurrentSiteContext for
  // every service call (bughunt #11/#24/#25), not the global current site.
  const siteId = useCurrentSite().siteId ?? ''
  const [data, setData] = useState<T | null>(initialData)
  const [isLoading, setIsLoading] = useState(true)
  const [isSynced, setIsSynced] = useState(true)

  // Latest data this hook handed out or wrote, including its deletion list —
  // the baseline for detecting which collection items a write deletes.
  const dataRef = React.useRef<T | null>(initialData)
  useEffect(() => { dataRef.current = data }, [data])

  // Store initialData in a ref to avoid dependency issues
  // (callers often pass inline objects which would cause infinite loops)
  const initialDataRef = React.useRef(initialData)

  // Stale-writer guard (adapters with itemIds/addItems — annotations only).
  // A consumer may keep writing from its own state after the sync engine
  // replaced the record (annotation-layer ignores new `data` once it holds
  // strokes). `seenIdsRef`: item ids the consumer is known to hold — those it
  // got from the initial load and those it wrote. `deliveredRef`: the last
  // value handed out that the consumer may not have applied (remote change or
  // a guarded write). See guardStaleWrite in updateData.
  const seenIdsRef = React.useRef<Set<string>>(new Set())
  const deliveredRef = React.useRef<T | null>(null)

  // True once this hook wrote since it (re)loaded. A remote delivery then
  // merges into the local state instead of replacing it (see the subscriber).
  const localEditsRef = React.useRef(false)
  // updateData is defined below the load effect; the subscriber calls it via this ref.
  const updateDataRef = React.useRef<((d: T) => Promise<void>) | null>(null)

  // Extract targeting from options
  const { targetType, targetId, localOnly } = options

  // Determine if we're in broadcast mode (targeting is set)
  const isBroadcastMode = Boolean(targetType && targetId)

  // Load data on mount (re-run when pageId, componentId, or targeting changes)
  // IMPORTANT: Wait for isDbReady to ensure user change cleanup is complete
  useEffect(() => {
    // Don't load until DB is ready (after user change cleanup)
    if (!isDbReady) return

    let mounted = true
    // Set once the sync engine delivered a newer record (below): the local
    // read in loadData may predate it and must not override it.
    let gotRemote = false
    const itemIdsOf = getAdapter<T>(componentId)?.itemIds
    const markLoaded = (d: T | null) => {
      seenIdsRef.current = new Set(d && itemIdsOf ? itemIdsOf(d) : [])
    }

    // IMPORTANT: Reset data to initial immediately when targeting changes
    // This ensures we don't show stale data from a previous target
    setData(initialDataRef.current)
    markLoaded(initialDataRef.current)
    deliveredRef.current = null
    localEditsRef.current = false

    // Callers (notably sticky-notes-layer / annotation-layer) pass pageId=''
    // as a sentinel for "this layer is dormant — don't load anything". Without
    // this guard, broadcast-mode would still issue a GET to
    // /api/user-data/{adapter}/?targetType=…&targetId=… which 308→404s and
    // wastes round-trips on every public page load.
    if (!pageId) {
      setIsLoading(false)
      return () => { mounted = false }
    }

    // The sync engine writes server state into IndexedDB itself (initial
    // manifest pass, conflict resolution). In a fresh browser that happens
    // after this hook read an empty store; without this subscription the
    // fetched data stayed invisible until a reload, and the next write
    // replaced the server row with only the new edits.
    const unsubscribe = userDataService.subscribe<T>(pageId, componentId, (remoteData, sourceId) => {
      if (!mounted || sourceId !== REMOTE_CHANGE_SOURCE) return
      gotRemote = true
      // Local edits made before the server state arrived (e.g. a sticky note
      // placed in the first second of a fresh browser) may not be in
      // IndexedDB yet (debounced save), so the delivered record lacks them.
      // Replacing the state would drop them from the UI, and the pending
      // debounced save would then push them without the server items. Merge
      // and save the merged value instead (replaces the pending save).
      // Adapters with itemIds (annotations) are excluded: their stale-writer
      // guard (guardStaleWrite) relies on the delivered value staying "unseen"
      // until the consumer applies it.
      const adapter = getAdapter<T>(componentId)
      if (localEditsRef.current && adapter?.merge && !adapter.itemIds && dataRef.current && remoteData) {
        const merged = adapter.merge(dataRef.current, remoteData)
        setIsLoading(false)
        void updateDataRef.current?.(merged).catch(() => { /* logged in updateData */ })
        return
      }
      deliveredRef.current = remoteData
      setData(remoteData)
      setIsLoading(false)
    }, { targetType, targetId, siteId })

    const loadData = async () => {
      try {
        setIsLoading(true)

        // Always try to load from local IndexedDB first (includes targeting in key)
        const localRecord = await userDataService.get<T>(pageId, componentId, { targetType, targetId, siteId })
        if (gotRemote) return
        if (localRecord) markLoaded(localRecord.data)

        // For broadcast mode (class/student/page), also check server and compare versions
        // This ensures we get the newest data regardless of which device saved it
        // Note: page broadcasts need this too so authors see their own public content
        if (isBroadcastMode) {
          try {
            // Site scoping: broadcasts are per site, like everything else.
            const response = await fetch(
              `/api/user-data/${encodeURIComponent(componentId)}/${encodeURIComponent(pageId)}?targetType=${targetType}&targetId=${targetId}&siteId=${encodeURIComponent(siteId)}`
            )
            if (response.ok) {
              const serverData = await response.json()
              const serverVersion = serverData.version ?? 0
              const localVersion = localRecord?.version ?? 0

              if (mounted) {
                if (serverData.data && serverVersion >= localVersion) {
                  // Server has same or newer version - use server data
                  setData(serverData.data as T)
                  markLoaded(serverData.data as T)
                  setIsSynced(true)
                  // Update local cache with server data if server is newer
                  if (serverVersion > localVersion) {
                    await userDataService.save(pageId, componentId, serverData.data, {
                      siteId,
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
      unsubscribe()
    }
  }, [pageId, componentId, targetType, targetId, isBroadcastMode, isDbReady, siteId]) // Re-run when targeting changes or DB becomes ready

  /**
   * Keep items of the stored record that this consumer never saw (see
   * seenIdsRef). Without it, a consumer that drew before the server state
   * arrived — or ignored the delivered state — overwrote the server row with
   * only its own items. Rules:
   *  - A write containing any not-yet-seen id of the delivered value means the
   *    consumer applied it: all of that value's ids count as seen.
   *  - Stored items neither seen nor in the write are appended to the write;
   *    seen items missing from the write are real deletions (eraser).
   *  - An empty write (clear all / everything erased) is taken as is, even if
   *    the store holds unseen items: clear all must clear.
   * Known gap: a consumer that applied a delivered value and then deleted
   * every one of its new items in one write gets them back once.
   * Cost: one IndexedDB read per write, only for adapters with itemIds.
   */
  const guardStaleWrite = useCallback(async (newData: T): Promise<T> => {
    const adapter = getAdapter<T>(componentId)
    if (!adapter?.itemIds || !adapter.addItems || !pageId) return newData
    const nextIds = adapter.itemIds(newData)
    const seen = seenIdsRef.current
    const delivered = deliveredRef.current
    if (delivered) {
      const unseen = adapter.itemIds(delivered).filter(id => !seen.has(id))
      if (unseen.some(id => nextIds.includes(id))) {
        unseen.forEach(id => seen.add(id))
        deliveredRef.current = null
      }
    }
    let result = newData
    if (nextIds.length > 0) {
      const stored = await userDataService.get<T>(pageId, componentId, { targetType, targetId, siteId })
      if (stored?.data) {
        const next = new Set(nextIds)
        const missing = new Set(adapter.itemIds(stored.data).filter(id => !seen.has(id) && !next.has(id)))
        if (missing.size > 0) {
          result = adapter.addItems(newData, stored.data, missing)
          deliveredRef.current = result
          log('stale write: kept', missing.size, 'stored item(s) the writer never saw', { pageId, componentId })
        }
      }
    }
    nextIds.forEach(id => seen.add(id))
    return result
  }, [componentId, pageId, targetType, targetId, siteId])

  const updateData = useCallback(
    async (newData: T, updateOptions: UpdateDataOptions = {}) => {
      // Record deleted collection items on the data itself (see recordDeletions).
      // Skipped for override saves: dataRef belongs to a different target.
      if (updateOptions.targetTypeOverride === undefined) {
        const previous = dataRef.current
        newData = recordDeletions(componentId, previous, newData, removedCollectionIds(componentId, previous, newData))
        newData = await guardStaleWrite(newData)
        dataRef.current = newData
        localEditsRef.current = true
      }

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
          siteId,
          immediate: shouldSyncImmediately,
          targetType: effectiveTargetType ?? null,
          targetId: effectiveTargetId ?? null,
          localOnly,
        })

        // Queue for cloud sync if authenticated, unless this record is local-only.
        // Local-only records (student-uploaded binaries) must never be pushed.
        if (isAuthenticated && !localOnly) {
          // Same explicit site as the save (bughunt #25), not the global.
          const record = await userDataService.get(pageId, componentId, {
            siteId,
            targetType: effectiveTargetType,
            targetId: effectiveTargetId
          })
          // No record yet = first save of this item: the IndexedDB write
          // above is debounced and has not run. Queue it anyway (version 0,
          // the hook's site), otherwise it reached the server only on the next
          // edit or the next page load's unsynced-items pass.
          syncEngine.queueSync(
            componentId, // adapter
            pageId, // itemId
            JSON.stringify(newData),
            record?.version ?? 0,
            {
              // '' / legacy → not queued (stays local)
              siteId: record ? record.siteId : (siteId === undefined ? userDataService.getCurrentSite() : siteId),
              immediate: shouldSyncImmediately, // Immediate in broadcast mode
              targetType: effectiveTargetType ?? null,
              targetId: effectiveTargetId ?? null,
            }
          )
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
    [pageId, componentId, isAuthenticated, targetType, targetId, localOnly, siteId, guardStaleWrite]
  )

  useEffect(() => { updateDataRef.current = updateData }, [updateData])

  return {
    data,
    updateData,
    isLoading,
    isSynced,
  }
}
