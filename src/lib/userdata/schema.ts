/**
 * User Data Service Database Schema
 *
 * Dexie-based IndexedDB schema for local user data storage
 */

import Dexie, { Table } from 'dexie'
import type { UserDataRecord, UserDataVersion, VersionBlob } from './types'

// Database name includes version suffix to handle primary key changes
// (Dexie doesn't support migrating primary key structure)
// Increment this when primary key changes require a fresh database
const DB_NAME = 'EduskriptUserData_v2'

export class UserDataDatabase extends Dexie {
  // Primary key is [pageId, componentId, targetType, targetId]
  // targetType/targetId use '' for personal data (IndexedDB doesn't support null in compound keys)
  userData!: Table<UserDataRecord, [string, string, string, string]>
  userData_history!: Table<UserDataVersion, number>
  versionBlobs!: Table<VersionBlob, string>

  constructor() {
    super(DB_NAME)

    // Version 1 - Fresh schema with targeting support
    // Primary key: [pageId, componentId, targetType, targetId]
    // This allows storing both personal data (targetType=null) and
    // targeted data (targetType='class'|'student') for the same page/component
    this.version(1).stores({
      // Extended compound primary key for targeting support
      // targetType: null (personal), 'class', or 'student'
      // targetId: null (personal), classId, or studentId
      userData: '[pageId+componentId+targetType+targetId], updatedAt, userId, savedToRemote, targetType',
      // Version history: auto-increment id, compound index for queries
      userData_history: '++id, [pageId+componentId], versionNumber, createdAt, blobId',
      // Version blobs: hash-based deduplication
      versionBlobs: 'blobId, createdAt, refCount'
    })

    // Version 2 - Add localOnly secondary index. Lets sync code identify
    // records that must never be pushed to the server (e.g. student-uploaded
    // binaries) without deserializing their (potentially large) blob payload.
    this.version(2).stores({
      userData: '[pageId+componentId+targetType+targetId], updatedAt, userId, savedToRemote, targetType, localOnly',
      userData_history: '++id, [pageId+componentId], versionNumber, createdAt, blobId',
      versionBlobs: 'blobId, createdAt, refCount'
    })
  }
}

// Delete old database if it exists (one-time cleanup)
if (typeof indexedDB !== 'undefined') {
  indexedDB.deleteDatabase('EduskriptUserData')
}

// Singleton instance
export const db = new UserDataDatabase()
