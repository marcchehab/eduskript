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
  pageId: string          // Database ID of the page
  componentId: string     // Component identifier
  userId?: string         // Optional: user ID for future remote sync
  data: T                 // Component-specific data
  createdAt: string       // ISO timestamp of creation
  updatedAt: number       // Unix timestamp of last update
  savedToRemote: boolean  // Whether synced to remote (future use)
  version: number         // Version for optimistic concurrency control
  // Targeting for broadcasts (empty string for personal data)
  // Uses '' instead of null because IndexedDB compound keys don't support null
  targetType: 'class' | 'student' | 'page' | ''
  targetId: string  // '' for personal data, classId/studentId/pageId for broadcasts
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
export interface UserDataVersion {
  id?: number                    // Auto-increment primary key
  pageId: string                 // Foreign key to main record
  componentId: string            // Foreign key to main record
  versionNumber: number          // Sequential version number
  dataHash: string               // SHA-256 hash of data for deduplication
  blobId: string                 // Reference to versionBlobs table
  createdAt: number              // Unix timestamp
  label?: string                 // Optional user label ("checkpoint", "before clear")
  sizeBytes: number              // Uncompressed size for metrics
  isManualSave?: boolean         // True if manually saved by user, false for autosaves
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
  isManualSave?: boolean         // True if manually saved by user
}

/**
 * Version history summary for UI
 */
export interface VersionSummary {
  versionNumber: number
  createdAt: number
  label?: string
  sizeBytes: number
  canRestore: boolean
  isManualSave?: boolean
}
