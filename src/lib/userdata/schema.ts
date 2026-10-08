/**
 * User Data Service Database Schema
 *
 * Dexie-based IndexedDB schema for local user data storage.
 *
 * v3 DB (EduskriptUserData_v3): primary keys include userId so multiple users
 * on one browser are naturally isolated. See migrations.ts for the v2→v3 copy.
 *
 * Dexie version 2 (site scoping, 2026-10): presentation data belongs to the
 * SITE it was produced on (src/lib/site-access.ts). Dexie can't change a
 * table's primary key in place, so version 2 adds a NEW table `siteUserData`
 * whose key includes `siteId`, and the upgrade copies every existing
 * `userData` row into it with `siteId = LEGACY_SITE_ID` — nothing is deleted:
 * the old `userData` table stays declared and untouched as a fallback copy.
 * Legacy rows are adopted by the first site that reads them (see
 * userDataService.adoptLegacy), which mirrors the server data migration
 * (each row → the one site its skript is placed on).
 */

import Dexie, { Table } from 'dexie'
import type { UserDataRecord, UserDataVersion, VersionBlob } from './types'

// Database name includes a version suffix because Dexie can't migrate primary
// key shape changes in place. Bump this only when the primary key changes.
const DB_NAME = 'EduskriptUserData_v3'

/** siteId stamped on rows copied from the pre-site-scoping table. Never sent
 *  to the server; adopted into a real site on first read under that site. */
export const LEGACY_SITE_ID = '__legacy__'

/** siteId for writes outside any site context (dashboard preview, auth
 *  pages). Kept local: the sync engine never pushes these. */
export const NO_SITE_ID = ''

export type SiteUserDataKey = [string, string, string, string, string, string]

/** Pre-site-scoping record shape (Dexie v1 `userData` table). */
export type LegacyUserDataRecord = Omit<UserDataRecord, 'siteId'>

export class UserDataDatabase extends Dexie {
  /**
   * Current table. Primary key:
   *   [userId, siteId, pageId, componentId, targetType, targetId]
   * userId is 'anonymous' for not-logged-in writes; targetType/targetId use
   * '' for personal data (IndexedDB compound keys don't accept null).
   */
  siteUserData!: Table<UserDataRecord, SiteUserDataKey>
  /** Pre-site-scoping table. Read-only since Dexie version 2; kept as a
   *  safety copy, never written or deleted by app code. */
  userData!: Table<LegacyUserDataRecord, [string, string, string, string, string]>
  userData_history!: Table<UserDataVersion, number>
  versionBlobs!: Table<VersionBlob, string>

  constructor(name: string = DB_NAME) {
    super(name)

    // v1 — fresh schema for v3 DB. Existing v2 data is migrated by the
    // one-time copy in migrations.ts before this DB is read from.
    this.version(1).stores({
      userData: '[userId+pageId+componentId+targetType+targetId], updatedAt, savedToRemote, targetType, localOnly, [userId+pageId], userId',
      userData_history: '++id, [userId+pageId+componentId], versionNumber, createdAt, blobId',
      versionBlobs: 'blobId, createdAt, refCount'
    })

    // v2 — site scoping. New table with siteId in the key; history gets a
    // siteId-aware index. The upgrade runs inside one versionchange
    // transaction: it either copies everything or aborts and leaves v1 as is.
    this.version(2).stores({
      siteUserData: '[userId+siteId+pageId+componentId+targetType+targetId], updatedAt, savedToRemote, targetType, localOnly, [userId+siteId+pageId], [userId+pageId], userId, siteId',
      userData_history: '++id, [userId+pageId+componentId], [userId+siteId+pageId+componentId], versionNumber, createdAt, blobId, siteId',
    }).upgrade(async (tx) => {
      const legacy = await tx.table('userData').toArray() as LegacyUserDataRecord[]
      const target = tx.table('siteUserData')
      for (const r of legacy) {
        // savedToRemote is preserved: an unsynced row stays unsynced and is
        // pushed once a site adopts it.
        await target.put({ ...r, siteId: LEGACY_SITE_ID })
      }
      await tx.table('userData_history').toCollection().modify((v: UserDataVersion) => {
        if (!v.siteId) v.siteId = LEGACY_SITE_ID
      })
    })
  }
}

// Singleton instance
export const db = new UserDataDatabase()
