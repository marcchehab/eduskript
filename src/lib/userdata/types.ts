/**
 * User Data Service Types
 *
 * Defines the data structures for local user data persistence
 * with future support for remote sync.
 */

/**
 * Primary key for user data records
 */
export interface UserDataKey {
  pageId: string      // Database ID of the page
  componentId: string // Component identifier (e.g., "code-editor-0", "annotations")
}

/**
 * User data record stored in IndexedDB
 * Note: targetType/targetId use empty strings (not null) for IndexedDB compound key compatibility
 */
export interface UserDataRecord<T = any> {
  userId: string          // Owning user — 'anonymous' for not-logged-in writes. Part of the IndexedDB compound primary key so multiple users on one browser are isolated without wiping.
  pageId: string          // Database ID of the page
  componentId: string     // Component identifier
  data: T                 // Component-specific data
  createdAt: string       // ISO timestamp of creation
  updatedAt: number       // Unix timestamp of last update
  savedToRemote: boolean  // Whether synced to remote (future use)
  version: number         // Version for optimistic concurrency control
  // Targeting for broadcasts (empty string for personal data)
  // Uses '' instead of null because IndexedDB compound keys don't support null
  targetType: 'class' | 'student' | 'page' | ''
  targetId: string  // '' for personal data, classId/studentId/pageId for broadcasts
  // When true, the sync engine never pushes this record to the server.
  // Used for student-uploaded binaries (images, CSVs) that should stay on-device.
  // Future use: flip to false on teacher-graded exam files for sync-back.
  localOnly?: boolean
}

/**
 * Annotation-specific data structure
 */
export interface AnnotationData {
  canvasData: string                      // JSON stringified stroke data
  headingOffsets: Record<string, number>  // Section positioning
  pageVersion: string                     // Content hash for version tracking
  paddingLeft?: number                    // Paper left padding when saved (for horizontal repositioning)
}

/**
 * Code editor-specific data structure
 */
export interface CodeEditorData {
  files: PythonFile[]       // Array of Python files
  activeFileIndex: number   // Currently active file
  fontSize?: number         // Editor font size
  lineWrapping?: boolean    // Enable line wrapping in editor
  editorWidth?: number      // Split percentage
  canvasTransform?: {       // Turtle canvas transform
    x: number
    y: number
    scale: number
  }
  highlights?: CodeHighlight[]  // Code highlights (per-file)
}

/**
 * SQL exercise verification result — latest attempt wins.
 * Students can re-run as many times as they want.
 */
export interface SqlVerificationData {
  isCorrect: boolean    // result of the last run
  hasAttempted: boolean // true once they ran at least one verification
}

/**
 * Python check exercise result — tracks per-assertion pass/fail,
 * submission count, and points earned.
 */
export interface PythonCheckData {
  checksUsed: number
  maxChecks: number | null
  points: number
  earnedPoints: number
  lastResults: PythonCheckResult[]
  lastCheckedAt: number
}

export interface PythonCheckResult {
  index: number
  passed: boolean
  label: string
  error?: string
}

/**
 * Quiz question-specific data structure
 */
export interface QuizData {
  selected?: number[]    // Selected option indices (for single/multiple choice)
  textAnswer?: string    // Free text answer
  numberAnswer?: number  // Numeric answer (for slider/number input)
  rangeAnswer?: { min: number; max: number }  // Range answer (for range slider)
  isSubmitted: boolean   // Whether the question has been submitted
}

/**
 * Stroke telemetry sample (collected every Nth stroke)
 */
export interface StrokeTelemetry {
  timestamp: number         // Unix timestamp of stroke completion
  pointCount: number        // Total points in stroke
  totalLengthPx: number     // Total stroke length in pixels
  durationMs: number        // Total stroke duration in milliseconds
  lengthPerPoint: number    // Average distance between points (px)
  durationPerPoint: number  // Time between points (ms) = ~sampling interval
  sectionId: string         // Which heading section the stroke belongs to
  mode: 'draw' | 'highlight' | 'erase'
}

/**
 * Annotation telemetry data structure
 */
export interface TelemetryData {
  samples: StrokeTelemetry[]  // Sampled stroke telemetry
  totalStrokeCount: number    // All strokes (not just sampled)
  sessionCount: number        // Drawing sessions
  firstSampleAt: number       // Unix timestamp of first sample
}

export interface PythonFile {
  name: string
  content: string
}

/**
 * Global import files available across Python editors.
 * Stored via useSyncedUserData with two scopes:
 * - Skript-scoped: keyed by skriptId, shared across editors in one skript
 * - Global: keyed by '__global__', shared across all skripts
 */
export interface GlobalImportsData {
  files: PythonFile[]
}

/**
 * Binary file (e.g. uploaded image, CSV, sqlite) attached to a Python editor.
 * Stored via useSyncedUserData with localOnly=true so the sync engine never
 * pushes the bytes to the server. Three scope componentIds:
 *   - `code-editor-{editorId}-binaries` — only this editor
 *   - `binaries:skript:{skriptId}`      — all Python editors in this skript
 *   - `binaries:global`                 — all Python editors anywhere
 */
export interface BinaryFile {
  name: string         // Filename as written into Pyodide's FS, e.g. "photo.jpg"
  bytes: Blob          // Raw file content (Dexie stores Blobs natively)
  sizeBytes: number    // Convenience copy of bytes.size for sorting / size checks
  addedAt: number      // Unix timestamp
  source: 'student'    // Future: 'teacher' for exam-graded files synced back for marking
}

export interface BinaryFileData {
  files: BinaryFile[]
}

/**
 * Code highlight color options
 */
export type HighlightColor = 'red' | 'yellow' | 'green' | 'blue'

/**
 * Comment on a code highlight
 *
 * MULTI-USER COMMENTS:
 * Each user can add one comment per highlight. authorId identifies the commenter.
 * In local-only mode, authorId may be undefined (all comments "belong" to local user).
 *
 * LIMITATION: Students cannot comment on teacher highlights.
 * Comments are stored WITH the highlight record. Teacher highlights live in broadcast
 * records that students can only read. To enable student comments on teacher highlights,
 * we'd need a separate storage mechanism (student comments referencing highlight IDs).
 *
 * NOTE: If a highlight is deleted, all its comments are lost.
 * This is intentional - comments are highlight-specific context.
 */
export interface HighlightComment {
  id: string                // Unique identifier (nanoid)
  text: string              // Comment content
  authorId?: string         // User ID (empty in local mode, filled when broadcast)
  createdAt: number         // Timestamp
}

/**
 * Individual code highlight
 *
 * POSITION TRACKING:
 * `from` and `to` are character offsets in the file content. These are updated
 * automatically by CodeMirror when the document is edited (see highlight-extension.ts).
 *
 * OWNERSHIP MODEL:
 * - authorId identifies who created the highlight
 * - In local mode (no server sync), authorId may be undefined
 * - In broadcast mode, authorId is the teacher's user ID
 * - Students can only delete their own highlights (authorId === currentUserId)
 *
 * BROADCAST vs LOCAL:
 * Same structure is used for both. The difference is WHERE it's stored:
 * - Personal: adapter="code-editor-{id}", no targeting
 * - Broadcast: adapter="code-highlights-{id}", targetType/targetId set
 * See code-editor/index.tsx for the dual-write pattern.
 */
export interface CodeHighlight {
  id: string                // Unique identifier (nanoid)
  fileIndex: number         // Which file in multi-file editor
  from: number              // Start character offset
  to: number                // End character offset
  color: HighlightColor     // Highlight color
  createdAt: number         // Timestamp for ordering
  authorId?: string         // User ID who created this (empty in local mode)
  comments?: HighlightComment[]  // Multiple comments from different users
  isTeacher?: boolean       // Runtime flag set when merging displays (not persisted)
}

/**
 * Options for saving user data
 */
export interface SaveOptions {
  debounce?: number  // Milliseconds to debounce saves (default: 1000)
  immediate?: boolean // Skip debounce and save immediately
}

/**
 * Hook return value
 */
export interface UseUserDataResult<T> {
  data: T | null
  updateData: (data: T, options?: SaveOptions) => Promise<void>
  deleteData: () => Promise<void>
  isLoading: boolean
  isSynced: boolean
  lastUpdated: number | null
}

/**
 * Version history record
 */
/**
 * Type of trigger that produced a version row. Used for per-kind labeling
 * in the history UI ("auto1", "manual2", "check3"). Legacy rows without
 * `kind` are derived from `isManualSave` at read time.
 */
export type VersionKind = 'auto' | 'manual' | 'check'

export interface UserDataVersion {
  id?: number                    // Auto-increment primary key
  userId: string                 // Owning user — part of the [userId+pageId+componentId] secondary index so histories are isolated per user
  pageId: string                 // Foreign key to main record
  componentId: string            // Foreign key to main record
  versionNumber: number          // Sequential version number
  dataHash: string               // SHA-256 hash of data for deduplication
  blobId: string                 // Reference to versionBlobs table
  createdAt: number              // Unix timestamp
  label?: string                 // Optional user label ("checkpoint", "before clear")
  sizeBytes: number              // Uncompressed size for metrics
  isManualSave?: boolean         // Legacy: true if manually saved. New code should use `kind` instead.
  kind?: VersionKind             // 'auto' | 'manual' | 'check' — drives default labeling in the UI
  // Set after a successful checkpoint POST to /api/user-data/checkpoints.
  // Presence of this id is the "synced" badge in the version-history UI.
  // Stays undefined for purely local rows (autosaves, manual saves that
  // failed to POST, manual saves while on the 402-gated free tier).
  serverCheckpointId?: string
}

/**
 * Deduplicated version blob storage
 */
export interface VersionBlob {
  blobId: string                 // SHA-256 hash (primary key)
  data: Blob                     // gzip compressed data
  refCount: number               // How many versions reference this
  createdAt: number              // For cleanup
}

/**
 * Options for creating a version
 */
export interface CreateVersionOptions extends SaveOptions {
  label?: string                 // Optional label for this version
  isManualSave?: boolean         // Legacy. Equivalent to kind: 'manual'.
  kind?: VersionKind             // Preferred over isManualSave for new code.
}

/**
 * Version history summary for UI
 */
export interface VersionSummary {
  id?: number                    // IndexedDB auto-increment id — stable unique key for React lists
  versionNumber: number
  createdAt: number
  label?: string
  sizeBytes: number
  canRestore: boolean
  isManualSave?: boolean
  kind: VersionKind              // Always set in summaries (derived from `kind` or `isManualSave` for legacy rows)
  // True when this version has a corresponding row in the server-side
  // user_data_checkpoints table. Currently only manual saves can be synced.
  synced?: boolean
}
