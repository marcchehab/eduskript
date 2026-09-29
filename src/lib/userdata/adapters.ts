/**
 * Data Adapters for User Data Service
 *
 * Each adapter defines how a specific data type is serialized, deserialized,
 * and merged during sync conflicts.
 */

import type { AnnotationData, CodeEditorData } from './types'
import type { Spacer } from '@/types/spacer'
import type { TextHighlightsData } from '@/lib/text-highlights/types'
import type { StickyNotesData } from '@/components/annotations/sticky-notes-layer'

/**
 * Data adapter interface for type-safe data handling
 */
export interface DataAdapter<T> {
  /** Unique identifier for this data type */
  key: string
  /** Serialize data to JSON string */
  serialize: (data: T) => string
  /** Deserialize JSON string to data */
  deserialize: (raw: string) => T
  /** Merge local and remote data during conflicts (optional) */
  merge?: (local: T, remote: T) => T
  /** Validate data structure (optional) */
  validate?: (data: T) => boolean
  /**
   * For id-keyed collections: the property holding the item array. Enables
   * deletion tracking — see `deletedIds` and `recordDeletions`.
   */
  collectionKey?: string
}

/**
 * Id-keyed collections (snaps, spacers, highlights, sticky notes) merge
 * additively, so without a record of deletions a stale copy — the server
 * before the delete was pushed, another tab, another device — brings a
 * deleted item back on the next merge. `deletedIds` is that record: ids
 * listed there never survive a merge, whichever side still has the item.
 */
export interface DeletionTracked {
  deletedIds?: string[]
}

/** Oldest entries are dropped beyond this; a copy that stale is unlikely. */
export const MAX_DELETED_IDS = 500

function capDeletedIds(ids: Iterable<string>): string[] {
  const unique = [...new Set(ids)]
  return unique.slice(Math.max(0, unique.length - MAX_DELETED_IDS))
}

/**
 * Merge two id-keyed collections. Items on either side survive unless either
 * side has deleted them; `pick` resolves items present on both (default: local).
 */
function mergeCollection<I extends { id: string }>(
  local: I[],
  remote: I[],
  localDeleted: string[] = [],
  remoteDeleted: string[] = [],
  pick: (local: I, remote: I) => I = (l) => l,
): { items: I[]; deletedIds: string[] } {
  const deletedIds = capDeletedIds([...remoteDeleted, ...localDeleted])
  const deleted = new Set([...remoteDeleted, ...localDeleted])
  const remoteById = new Map(remote.map(item => [item.id, item]))
  const localIds = new Set(local.map(item => item.id))
  const items = [
    ...local.map(item => {
      const other = remoteById.get(item.id)
      return other ? pick(item, other) : item
    }),
    ...remote.filter(item => !localIds.has(item.id)),
  ].filter(item => !deleted.has(item.id))
  return { items, deletedIds }
}

/**
 * Carry deletion tracking into a write: ids that were in `previous` (what the
 * writer last saw) but are missing from `next` are recorded as deleted, on top
 * of the deletions already stored on `existing`. Ids present in `next` are
 * dropped from the list, so re-adding an item (undo) works.
 *
 * Returns `next` unchanged for adapters without a collection.
 */
export function recordDeletions<T>(
  componentId: string,
  existing: unknown,
  next: T,
  removedIds: Iterable<string> = [],
): T {
  const key = getAdapter(componentId)?.collectionKey
  if (!key || !next || typeof next !== 'object') return next
  const items = (next as Record<string, unknown>)[key]
  if (!Array.isArray(items)) return next

  const present = new Set(items.map((item: { id: string }) => item.id))
  const deletedIds = capDeletedIds([
    ...((existing as DeletionTracked | null | undefined)?.deletedIds ?? []),
    ...((next as DeletionTracked).deletedIds ?? []),
    ...removedIds,
  ]).filter(id => !present.has(id))

  if (deletedIds.length === 0 && !(next as DeletionTracked).deletedIds) return next
  return { ...next, deletedIds }
}

/** Ids in `previous`'s collection that `next` no longer contains. */
export function removedCollectionIds(componentId: string, previous: unknown, next: unknown): string[] {
  const key = getAdapter(componentId)?.collectionKey
  if (!key || !previous || !next) return []
  const before = (previous as Record<string, unknown>)[key]
  const after = (next as Record<string, unknown>)[key]
  if (!Array.isArray(before) || !Array.isArray(after)) return []
  const kept = new Set(after.map((item: { id: string }) => item.id))
  return before.map((item: { id: string }) => item.id).filter(id => !kept.has(id))
}

/**
 * Editor settings stored per page
 */
export interface EditorSettings {
  fontSize?: number
  editorWidth?: number
  canvasTransform?: {
    x: number
    y: number
    scale: number
  }
}

/**
 * Global user preferences (stored with itemId='global')
 */
export interface UserPreferences {
  theme?: 'light' | 'dark' | 'system'
  defaultFontSize?: number
  defaultEditorWidth?: number
}

/**
 * Code data adapter
 * Handles code editor state including files and versions
 */
export const codeAdapter: DataAdapter<CodeEditorData> = {
  key: 'code',

  serialize: (data) => JSON.stringify(data),

  deserialize: (raw) => JSON.parse(raw) as CodeEditorData,

  // Last-write-wins for files, but merge version history
  merge: (local, remote) => {
    // Determine which has newer content by checking files
    // For simplicity, use local as primary (user's current device)
    return {
      ...local,
      // Keep local's current files (user's active work)
      files: local.files,
      activeFileIndex: local.activeFileIndex,
      // Preserve settings from local
      fontSize: local.fontSize ?? remote.fontSize,
      editorWidth: local.editorWidth ?? remote.editorWidth,
      canvasTransform: local.canvasTransform ?? remote.canvasTransform,
    }
  },

  validate: (data) => {
    return (
      Array.isArray(data.files) &&
      typeof data.activeFileIndex === 'number' &&
      data.activeFileIndex >= 0 &&
      data.activeFileIndex < data.files.length
    )
  },
}

/**
 * Annotations data adapter
 * Handles canvas drawings and text highlights
 */
export const annotationsAdapter: DataAdapter<AnnotationData> = {
  key: 'annotations',

  serialize: (data) => JSON.stringify(data),

  deserialize: (raw) => JSON.parse(raw) as AnnotationData,

  // Additive merge - keep strokes from both
  merge: (local, remote) => {
    // For annotations, we merge canvas data if possible
    // Since canvasData is a JSON string of strokes, we'd need to parse and dedupe
    // For now, prefer local (user's current device work)
    return {
      canvasData: local.canvasData,
      headingOffsets: { ...remote.headingOffsets, ...local.headingOffsets },
      pageVersion: local.pageVersion,
      paddingLeft: local.paddingLeft ?? remote.paddingLeft,
    }
  },

  validate: (data) => {
    return (
      typeof data.canvasData === 'string' &&
      typeof data.headingOffsets === 'object'
    )
  },
}

/**
 * Editor settings adapter
 * Handles per-page editor configuration
 */
export const settingsAdapter: DataAdapter<EditorSettings> = {
  key: 'settings',

  serialize: (data) => JSON.stringify(data),

  deserialize: (raw) => JSON.parse(raw) as EditorSettings,

  // Local wins - user's current device preferences take precedence
  merge: (local, remote) => ({
    fontSize: local.fontSize ?? remote.fontSize,
    editorWidth: local.editorWidth ?? remote.editorWidth,
    canvasTransform: local.canvasTransform ?? remote.canvasTransform,
  }),
}

/**
 * User preferences adapter
 * Handles global user settings (not page-specific)
 */
export const preferencesAdapter: DataAdapter<UserPreferences> = {
  key: 'preferences',

  serialize: (data) => JSON.stringify(data),

  deserialize: (raw) => JSON.parse(raw) as UserPreferences,

  // Local wins
  merge: (local, remote) => ({
    ...remote,
    ...local,
  }),
}

/**
 * Snap data for screen captures
 * Images are stored in Scaleway bucket, only metadata + URL stored here
 */
export interface SnapData {
  id: string
  name: string
  imageUrl: string  // URL to image in Scaleway bucket (NOT base64)
  top: number
  left: number  // Pixels from left edge of paper
  width: number
  height: number
  sectionId?: string  // Section heading ID for vertical repositioning
  sectionOffsetY?: number  // Y offset of section when snap was created
  color?: string     // Header/border tint color (default: 'blue')
  minimized?: boolean // Collapse to titlebar only
}

/**
 * Snaps collection stored per page
 */
export interface SnapsData extends DeletionTracked {
  snaps: SnapData[]
}

/**
 * Snaps data adapter
 * Handles screen capture snapshots for a page
 */
export const snapsAdapter: DataAdapter<SnapsData> = {
  key: 'snaps',
  collectionKey: 'snaps',

  serialize: (data) => JSON.stringify(data),

  deserialize: (raw) => JSON.parse(raw) as SnapsData,

  // Merge by combining snaps from both, deduping by id, minus deletions
  merge: (local, remote) => {
    const { items, deletedIds } = mergeCollection(local.snaps, remote.snaps, local.deletedIds, remote.deletedIds)
    return { snaps: items, deletedIds }
  },

  validate: (data) => {
    return Array.isArray(data.snaps)
  },
}

/**
 * Spacers collection stored per page
 */
export interface SpacersData extends DeletionTracked {
  spacers: Spacer[]
}

/**
 * Spacers data adapter
 * Handles visual spacers injected between content blocks
 */
export const spacersAdapter: DataAdapter<SpacersData> = {
  key: 'spacers',
  collectionKey: 'spacers',

  serialize: (data) => JSON.stringify(data),

  deserialize: (raw) => JSON.parse(raw) as SpacersData,

  // Merge by combining spacers from both, deduping by id, minus deletions
  merge: (local, remote) => {
    const { items, deletedIds } = mergeCollection(local.spacers, remote.spacers, local.deletedIds, remote.deletedIds)
    return { spacers: items, deletedIds }
  },

  validate: (data) => {
    return Array.isArray(data.spacers)
  },
}

/**
 * Text highlights data adapter
 * Handles text passage highlights for study purposes
 */
export const textHighlightsAdapter: DataAdapter<TextHighlightsData & DeletionTracked> = {
  key: 'text-highlights',
  collectionKey: 'highlights',

  serialize: (data) => JSON.stringify(data),

  deserialize: (raw) => JSON.parse(raw) as TextHighlightsData & DeletionTracked,

  // Merge by combining highlights from both, deduping by id, minus deletions
  merge: (local, remote) => {
    const { items, deletedIds } = mergeCollection(local.highlights, remote.highlights, local.deletedIds, remote.deletedIds)
    return { highlights: items, deletedIds }
  },

  validate: (data) => Array.isArray(data.highlights),
}

/**
 * Sticky notes data adapter
 * Merges by note ID, keeping the version with the newer updatedAt timestamp.
 * Notes that exist on only one side are preserved (additive) unless deleted.
 */
export const stickyNotesAdapter: DataAdapter<StickyNotesData & DeletionTracked> = {
  key: 'sticky-notes',
  collectionKey: 'notes',

  serialize: (data) => JSON.stringify(data),

  deserialize: (raw) => JSON.parse(raw) as StickyNotesData & DeletionTracked,

  merge: (local, remote) => {
    // Local notes win if updatedAt >= remote, otherwise take remote version
    const { items, deletedIds } = mergeCollection(
      local.notes, remote.notes, local.deletedIds, remote.deletedIds,
      (l, r) => (r.updatedAt > l.updatedAt ? r : l),
    )
    return { notes: items, deletedIds }
  },

  validate: (data) => Array.isArray(data.notes),
}

/**
 * Plugin data adapter
 * Stores opaque plugin state — the host never interprets it, just persists and relays.
 * Last-write-wins merge since plugins define their own data semantics.
 */
export interface PluginData {
  /** Opaque state defined by the plugin */
  state: unknown
  /** Timestamp for last-write-wins merge */
  updatedAt: number
}

export const pluginAdapter: DataAdapter<PluginData> = {
  key: 'plugin',

  serialize: (data) => JSON.stringify(data),

  deserialize: (raw) => JSON.parse(raw) as PluginData,

  merge: (local, remote) => {
    // Last-write-wins by timestamp
    return (local.updatedAt || 0) >= (remote.updatedAt || 0) ? local : remote
  },

  validate: (data) => {
    if (!data || typeof data !== 'object') return false
    const serialized = JSON.stringify(data.state)
    // 1MB size cap
    return serialized.length < 1_000_000
  },
}

/**
 * Registry of all adapters by key
 */
export const adapterRegistry: Record<string, DataAdapter<unknown>> = {
  code: codeAdapter as DataAdapter<unknown>,
  annotations: annotationsAdapter as DataAdapter<unknown>,
  settings: settingsAdapter as DataAdapter<unknown>,
  preferences: preferencesAdapter as DataAdapter<unknown>,
  snaps: snapsAdapter as DataAdapter<unknown>,
  spacers: spacersAdapter as DataAdapter<unknown>,
  'text-highlights': textHighlightsAdapter as DataAdapter<unknown>,
  'sticky-notes': stickyNotesAdapter as DataAdapter<unknown>,
  plugin: pluginAdapter as DataAdapter<unknown>,
}

/**
 * Get adapter by key with type safety
 */
export function getAdapter<T>(key: string): DataAdapter<T> | undefined {
  return adapterRegistry[key] as DataAdapter<T> | undefined
}
