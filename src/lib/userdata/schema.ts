/**
 * User Data Service Database Schema
 *
 * Dexie-based IndexedDB schema for local user data storage.
 *
 * v3 (current): primary keys include userId so multiple users on one browser
 * are naturally isolated. The previous "wipe-on-user-change" cleanup in
 * provider.tsx is gone — see migrations.ts for the v2→v3 data migration that
 * preserves existing records by inferring their owner from localStorage.
 */

import Dexie, { Table } from 'dexie'
import type { UserDataRecord, UserDataVersion, VersionBlob } from './types'

// Database name includes a version suffix because Dexie can't migrate primary
// key shape changes in place. Bump this only when the primary key changes.
const DB_NAME = 'EduskriptUserData_v3'

export class UserDataDatabase extends Dexie {
  // Primary key is [userId, pageId, componentId, targetType, targetId]
  // userId is 'anonymous' for not-logged-in writes; targetType/targetId use
  // '' for personal data (IndexedDB compound keys don't accept null).
  userData!: Table<UserDataRecord, [string, string, string, string, string]>
  userData_history!: Table<UserDataVersion, number>
  versionBlobs!: Table<VersionBlob, string>

  constructor() {
    super(DB_NAME)

    // v1 — fresh schema for v3 DB. Existing v2 data is migrated by the
    // one-time copy in migrations.ts before this DB is read from.
    this.version(1).stores({
      userData: '[userId+pageId+componentId+targetType+targetId], updatedAt, savedToRemote, targetType, localOnly, [userId+pageId], userId',
      userData_history: '++id, [userId+pageId+componentId], versionNumber, createdAt, blobId',
      versionBlobs: 'blobId, createdAt, refCount'
    })
  }
}

// Singleton instance
export const db = new UserDataDatabase()
