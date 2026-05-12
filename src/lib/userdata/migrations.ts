/**
 * User-data IndexedDB migrations
 *
 * Two one-time-ish operations that the provider runs before exposing the DB:
 *
 *   A. v2 → v3: copy records from the old `EduskriptUserData_v2` DB into the
 *      current v3 DB, prepending a userId derived from localStorage. The old
 *      schema didn't include userId in keys; the previous wipe-on-user-change
 *      logic guaranteed that whatever's in v2 belongs to the userId stored in
 *      `eduskript-last-user-id`. Idempotent via a localStorage flag.
 *
 *   B. anonymous → real userId: when a previously-anonymous browser logs in
 *      for the first time, re-key all `userId='anonymous'` records under the
 *      new userId. Per-record most-recent-`updatedAt` wins on key collision.
 *      History rows have auto-increment IDs and don't collide; re-key
 *      everything and renumber `versionNumber` so the merged history has no
 *      duplicates per (pageId, componentId).
 */

import { db } from './schema'
import type { UserDataRecord, UserDataVersion, VersionBlob } from './types'

const MIGRATED_V3_FLAG = 'eduskript-userdata-migrated-v3'
const LAST_USER_KEY = 'eduskript-last-user-id'
const V2_DB_NAME = 'EduskriptUserData_v2'

/**
 * Open an existing IndexedDB by name without participating in version
 * upgrades. Resolves to null if the DB doesn't exist.
 */
function openExisting(dbName: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open(dbName)
    req.onsuccess = () => {
      const db = req.result
      // If the DB didn't exist, IndexedDB creates an empty one with version 1
      // and no object stores. Detect that and treat it as "doesn't exist."
      if (db.objectStoreNames.length === 0) {
        db.close()
        resolve(null)
        return
      }
      resolve(db)
    }
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
}

function readAll<T>(idb: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    if (!idb.objectStoreNames.contains(storeName)) {
      resolve([])
      return
    }
    const tx = idb.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

/**
 * v2 → v3 one-time migration. Safe to call on every mount; gated by a
 * localStorage flag so it only runs once per browser. Resolves once the
 * v3 DB is in a usable state for the caller.
 */
export async function runOneTimeMigrationV2ToV3(): Promise<void> {
  // Some Node environments (Next.js SSR) define `localStorage` as a stub
  // global without methods, so check `typeof window` first.
  if (typeof window === 'undefined') return
  if (typeof indexedDB === 'undefined') return
  if (window.localStorage.getItem(MIGRATED_V3_FLAG) === 'true') return

  let v2: IDBDatabase | null = null
  try {
    v2 = await openExisting(V2_DB_NAME)
    if (!v2) {
      // Nothing to migrate (fresh browser or v2 already cleaned up).
      window.localStorage.setItem(MIGRATED_V3_FLAG, 'true')
      return
    }

    const lastUserId = window.localStorage.getItem(LAST_USER_KEY) || 'anonymous'

    // The wipe-on-change invariant in older provider.tsx guarantees every
    // existing v2 record was written under `lastUserId`.
    const v2UserData = await readAll<Omit<UserDataRecord, 'userId'> & { userId?: string }>(v2, 'userData')
    const v2History = await readAll<Omit<UserDataVersion, 'userId'> & { userId?: string; id?: number }>(v2, 'userData_history')
    const v2Blobs = await readAll<VersionBlob>(v2, 'versionBlobs')

    v2.close()
    v2 = null

    if (v2UserData.length === 0 && v2History.length === 0 && v2Blobs.length === 0) {
      window.localStorage.setItem(MIGRATED_V3_FLAG, 'true')
      // Drop the now-empty v2 DB.
      indexedDB.deleteDatabase(V2_DB_NAME)
      return
    }

    await db.transaction('rw', db.userData, db.userData_history, db.versionBlobs, async () => {
      for (const r of v2UserData) {
        await db.userData.put({ ...r, userId: lastUserId } as UserDataRecord)
      }
      for (const v of v2History) {
        // Drop the v2 auto-increment id so v3 assigns a fresh one.
        const { id: _ignore, ...rest } = v
        await db.userData_history.add({ ...rest, userId: lastUserId } as UserDataVersion)
      }
      for (const b of v2Blobs) {
        // Blobs are content-addressed; if the same blob is somehow already in
        // v3 (shouldn't happen on first-mount migration, but defensive), the
        // put is idempotent.
        await db.versionBlobs.put(b)
      }
    })

    window.localStorage.setItem(MIGRATED_V3_FLAG, 'true')
    indexedDB.deleteDatabase(V2_DB_NAME)
  } catch (error) {
    // Leave the flag unset — next mount retries against the still-intact v2.
    console.error('[userdata:migrations] v2→v3 migration failed:', error)
    if (v2) {
      try { v2.close() } catch { /* ignore */ }
    }
  }
}

/**
 * Re-key all `userId='anonymous'` records under `currentUserId`. Per-record
 * most-recent-`updatedAt` wins when a target record already exists. History
 * rows are always re-keyed and then renumbered to avoid duplicate
 * `versionNumber` per (pageId, componentId).
 *
 * Gated on the IndexedDB state, not on a localStorage hint about the previous
 * userId. Earlier versions skipped migration unless `previousUserId` was the
 * literal string 'anonymous', which lost data whenever localStorage didn't
 * agree with IndexedDB (private mode, first-render race where NextAuth had
 * already auto-logged the user in before the provider could write 'anonymous'
 * back to localStorage, etc.). Idempotent: returns early when there's nothing
 * to claim, so the provider can call this on every real-userId activation.
 */
export async function migrateAnonymousIfNeeded(
  currentUserId: string
): Promise<void> {
  if (!currentUserId || currentUserId === 'anonymous') return

  try {
    const anonRows = await db.userData.where('userId').equals('anonymous').toArray()
    const anonHistory = await db.userData_history.where('userId').equals('anonymous').toArray()

    if (anonRows.length === 0 && anonHistory.length === 0) return

    await db.transaction('rw', db.userData, db.userData_history, async () => {
      for (const r of anonRows) {
        const targetKey: [string, string, string, string, string] = [
          currentUserId, r.pageId, r.componentId, r.targetType, r.targetId
        ]
        const existing = await db.userData.get(targetKey)

        // Always remove the anonymous row — either we replaced it with a
        // re-keyed copy, or the destination is newer and we drop the anon copy.
        await db.userData.delete([
          r.userId, r.pageId, r.componentId, r.targetType, r.targetId
        ])

        if (existing && existing.updatedAt >= r.updatedAt) {
          // Existing logged-in record is newer or equal — keep it.
          continue
        }

        // Anonymous record is newer (or destination is empty) — claim it.
        // savedToRemote: false ensures the unsynced sweep pushes it next time.
        await db.userData.put({ ...r, userId: currentUserId, savedToRemote: false })
      }

      for (const v of anonHistory) {
        if (v.id !== undefined) {
          await db.userData_history.update(v.id, { userId: currentUserId })
        }
      }

      // Renumber versionNumber per (pageId, componentId) — anon and existing
      // both started at 1, so a naive merge has duplicates that confuse the
      // history UI. Sort by createdAt (true ordering) and reassign 1..n.
      const touchedKeys = new Set(anonHistory.map(v => `${v.pageId}\u0000${v.componentId}`))
      for (const key of touchedKeys) {
        const [pageId, componentId] = key.split('\u0000')
        const versions = await db.userData_history
          .where('[userId+pageId+componentId]')
          .equals([currentUserId, pageId, componentId])
          .sortBy('createdAt')
        for (let i = 0; i < versions.length; i++) {
          if (versions[i].versionNumber !== i + 1 && versions[i].id !== undefined) {
            await db.userData_history.update(versions[i].id!, { versionNumber: i + 1 })
          }
        }
      }
    })
  } catch (error) {
    console.error('[userdata:migrations] anonymous re-key failed:', error)
    // Don't rethrow — the user can still use the app under their new userId
    // even if we failed to migrate anonymous data. They keep the anonymous
    // records as a separate tier instead of losing them.
  }
}
