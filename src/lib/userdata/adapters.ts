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
}

/**
 * Snaps collection stored per page
 */
export interface SnapsData {
  snaps: SnapData[]
}

/**
 * Snaps data adapter
 * Handles screen capture snapshots for a page
 */
export const snapsAdapter: DataAdapter<SnapsData> = {
  key: 'snaps',

  serialize: (data) => JSON.stringify(data),

  deserialize: (raw) => JSON.parse(raw) as SnapsData,

  // Merge by combining snaps from both, deduping by id
  merge: (local, remote) => {
    const localIds = new Set(local.snaps.map(s => s.id))
    const mergedSnaps = [
      ...local.snaps,
      ...remote.snaps.filter(s => !localIds.has(s.id))
    ]
    return { snaps: mergedSnaps }
  },

  validate: (data) => {
    return Array.isArray(data.snaps)
  },
}

/**
 * Spacers collection stored per page
 */
export interface SpacersData {
  spacers: Spacer[]
}

/**
 * Spacers data adapter
 * Handles visual spacers injected between content blocks
 */
export const spacersAdapter: DataAdapter<SpacersData> = {
  key: 'spacers',

  serialize: (data) => JSON.stringify(data),

  deserialize: (raw) => JSON.parse(raw) as SpacersData,

  // Merge by combining spacers from both, deduping by id
  merge: (local, remote) => {
    const localIds = new Set(local.spacers.map(s => s.id))
    const mergedSpacers = [
      ...local.spacers,
      ...remote.spacers.filter(s => !localIds.has(s.id))
    ]
    return { spacers: mergedSpacers }
  },

  validate: (data) => {
    return Array.isArray(data.spacers)
  },
}

/**
 * Text highlights data adapter
 * Handles text passage highlights for study purposes
 */
export const textHighlightsAdapter: DataAdapter<TextHighlightsData> = {
  key: 'text-highlights',

  serialize: (data) => JSON.stringify(data),

  deserialize: (raw) => JSON.parse(raw) as TextHighlightsData,

  // Merge by combining highlights from both, deduping by id
  merge: (local, remote) => {
    const localIds = new Set(local.highlights.map(h => h.id))
    return {
      highlights: [
        ...local.highlights,
        ...remote.highlights.filter(h => !localIds.has(h.id)),
      ],
    }
  },

  validate: (data) => Array.isArray(data.highlights),
}

/**
 * Sticky notes data adapter
 * Merges by note ID, keeping the version with the newer updatedAt timestamp.
 * Notes that exist on only one side are preserved (additive).
 */
export const stickyNotesAdapter: DataAdapter<StickyNotesData> = {
  key: 'sticky-notes',

  serialize: (data) => JSON.stringify(data),

  deserialize: (raw) => JSON.parse(raw) as StickyNotesData,

  merge: (local, remote) => {
    const remoteById = new Map(remote.notes.map(n => [n.id, n]))
    const mergedIds = new Set<string>()
    const merged = []

    // Local notes win if updatedAt >= remote, otherwise take remote version
    for (const note of local.notes) {
      mergedIds.add(note.id)
      const remoteNote = remoteById.get(note.id)
      if (remoteNote && remoteNote.updatedAt > note.updatedAt) {
        merged.push(remoteNote)
      } else {
        merged.push(note)
      }
    }

    // Add remote-only notes
    for (const note of remote.notes) {
      if (!mergedIds.has(note.id)) {
        merged.push(note)
      }
    }

    return { notes: merged }
  },

  validate: (data) => Array.isArray(data.notes),
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
}

/**
 * Get adapter by key with type safety
 */
export function getAdapter<T>(key: string): DataAdapter<T> | undefined {
  return adapterRegistry[key] as DataAdapter<T> | undefined
}
