"use client"

import { useEffect, useLayoutEffect, useRef, useState, useCallback, memo, useMemo, useSyncExternalStore } from 'react'
import { nanoid } from 'nanoid'
import { createPortal } from 'react-dom'
import { useTheme } from 'next-themes'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Annotation, Compartment } from '@codemirror/state'
import { indentUnit } from '@codemirror/language'
import { indentWithTab, undo } from '@codemirror/commands'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { sql } from '@codemirror/lang-sql'
import { vsCodeDark } from '@fsegurai/codemirror-theme-vscode-dark'
import { vsCodeLight } from '@fsegurai/codemirror-theme-vscode-light'
import { basicSetup } from 'codemirror'
import { autocompletion } from '@codemirror/autocomplete'
import { createPythonCompletions } from './python-completions'
import { Button } from '@/components/ui/button'
import { Play, Square, RotateCcw, Maximize2, Minimize2, Scan, X, Plus, FileText, ZoomIn, ZoomOut, Save, History, Highlighter, MessageSquare, WrapText, Circle, CheckCircle2, Package, Trash2, Paperclip, Upload, Pencil, Cloud, HardDrive } from 'lucide-react'
import { useZoom } from '@/contexts/zoom-context'
import { useUserData, useCreateVersion, useVersionHistory, useRestoreVersion, useDeleteVersion, useUpdateVersionLabel, useOrphanedComponentIds, useReassignVersionHistory } from '@/lib/userdata/hooks'
import { userDataService, syncEngine } from '@/lib/userdata'
import { registerEditor, getMountedIds, subscribeToMounted } from './mounted-registry'
import { OrphanRow } from './orphan-row'
import { postCheckpoint } from '@/lib/userdata/checkpoints'
import { useSyncedUserData, type SyncedUserDataOptions } from '@/lib/userdata/provider'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { useStudentSnapshot } from '@/contexts/student-snapshot-context'
import { GradeBadge } from '@/components/exam/grade-badge'
import { cn } from '@/lib/utils'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useSession } from 'next-auth/react'
import type { CodeEditorData, CodeHighlight, HighlightColor, HighlightComment, SqlVerificationData, GlobalImportsData, PythonCheckData, BinaryFile, BinaryFileData } from '@/lib/userdata/types'

/** Data structure for broadcast highlights (separate from personal code data) */
interface BroadcastHighlightsData {
  highlights: CodeHighlight[]
}
import {
  codeHighlighting,
  addHighlight,
  removeHighlight,
  setHighlights as setHighlightsEffect,
  replaceTeacherHighlights,
  extractHighlights,
  highlightField,
} from './highlight-extension'
import {
  RunState,
  OutputLevel,
  OutputEntry,
  PythonFile,
  SkulptError,
  SkulptConfig,
  SqlResultSet
} from './types'
import { SqlProgressBar } from './sql-progress-bar'
import { PythonProgressBar } from './python-progress-bar'
import { PythonTestResults } from './python-test-results'
import { useCoupledVideo, parseTimecode } from '@/components/markdown/coupled-video-context'
import type { PythonCheckResult } from './types'
import { deferUntilIdle } from '@/lib/defer-until-idle'
import {
  runPython,
  runChecks,
  terminatePyodideWorker,
  warmPyodideWorker,
} from '@/lib/pyodide-worker.client'

/**
 * Hard wall-clock cap on a single Pyodide run from the Run / Check buttons.
 * On expiry the worker is terminated (kills any C-call hangs) and respawns
 * on the next call. 30 s is comfortable for legitimate matplotlib / numpy /
 * sklearn workloads; runaway `while True:` loops surface as a friendly stop
 * via the Stop button (which aborts immediately) or by hitting this cap.
 */
const STUDENT_PYODIDE_TIMEOUT_MS = 30_000

/**
 * Strip Pyodide/internal traceback frames from Python errors, keeping only
 * the error type + message and the relevant `File "<exec>"` frame.
 */
function cleanPythonError(msg: string): string {
  const lines = msg.split('\n')

  // Keep lines from `File "<exec>"` onwards, plus the final error line.
  // Pyodide tracebacks start with "Traceback (most recent call last):" followed
  // by internal frames (File "/lib/python3…") that students can't act on.
  const kept: string[] = []
  let inUserFrame = false
  for (const line of lines) {
    if (/^\s*File "<exec>"/.test(line)) {
      inUserFrame = true
    }
    if (inUserFrame) {
      kept.push(line)
    }
  }

  // If we captured user-relevant lines, return them; otherwise fall back to
  // just the last non-empty line (the actual error) to avoid showing nothing.
  if (kept.length > 0) return kept.join('\n')

  const last = lines.filter(l => l.trim()).pop()
  return last ?? msg
}

interface CodeEditorProps {
  id?: string
  pageId?: string
  skriptId?: string  // For Python global imports (shared across editors in a skript)
  language?: 'python' | 'javascript' | 'sql'
  initialCode?: string
  initialFiles?: PythonFile[] // Pre-populated multi-file content from markdown
  showCanvas?: boolean
  db?: string // Path to SQL database for SQL language
  schemaImage?: string // Optional schema image for SQL (light theme)
  schemaImageDark?: string // Optional schema image for SQL (dark theme)
  singleFile?: boolean // Hide file tabs for simple single-file examples
  solution?: string // Expected SQL solution for automatic pass/fail verification
  exam?: boolean // Exam mode: verification runs silently but no feedback or solution shown to student
  checkCode?: string // Hidden assert statements for Python checking
  // Staged checks: multiple <python-check> blocks for one editor become an
  // ordered sequence the student clears one at a time. When present (length
  // ≥ 1) it supersedes checkCode. A single stage behaves exactly like the
  // legacy single-check path.
  checkStages?: CheckStage[]
  checkPoints?: number // Total points for this exercise
  maxChecks?: number // Max submission attempts (undefined = unlimited)
  // Teacher-attached binary files (Python only). Resolved from skript storage in
  // markdown-components and fetched on demand. Read-only from the student's POV.
  attachedFiles?: Array<{ name: string; url: string }>
  // Show the "Upload file" button so students can bring their own local files
  // (images, CSVs, etc.) into the Pyodide FS. Files stay on-device only.
  allowUpload?: boolean
  // Optional `accept` attribute hint for the file picker (e.g. "image/*,.csv").
  acceptUploads?: string
  // Explicit editor-area height in pixels (from markdown ` height="500"`).
  // Overrides the line-count auto-height. The user's manual splitter drag still
  // wins over this. Output panel adds to the total below the splitter.
  height?: number
}

/** One stage of a staged Python check (see CodeEditorProps.checkStages). */
export interface CheckStage {
  code: string
  points?: number
  maxChecks?: number
  /** Coupled-video mark this stage releases when cleared ("90" | "1:30"). */
  gateAt?: string
  /** Optional short label shown in the "Stage X of N" header. */
  label?: string
}

// Custom annotation to mark programmatic changes (defined once outside component)
const programmaticChange = Annotation.define<boolean>()

// Highlight colors for cursor (URL-encoded hex values)
const highlightColorHex: Record<HighlightColor, string> = {
  red: '%23ef4444', yellow: '%23eab308', green: '%2322c55e', blue: '%233b82f6'
}

// Static preload functions (no component state, safe to call from IntersectionObserver)

/**
 * Preload Pyodide in background by spawning the worker (the worker boot script
 * starts loading Pyodide immediately). Safe to call multiple times.
 */
function preloadPyodide(): Promise<unknown> {
  warmPyodideWorker()
  return Promise.resolve()
}

/**
 * Preload Skulpt runtime in background. Safe to call multiple times.
 * Returns a promise that resolves when Skulpt is ready.
 */
function preloadSkulpt(): Promise<void> {
  if (window.Sk) {
    return Promise.resolve()
  }

  const scriptPromises = (window as any).__skulptPromises || {}
  if (!(window as any).__skulptPromises) {
    (window as any).__skulptPromises = scriptPromises
  }

  const loadScript = (src: string): Promise<void> => {
    if (scriptPromises[src]) return scriptPromises[src]

    scriptPromises[src] = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`)
      if (existing) {
        setTimeout(() => resolve(), 10)
        return
      }

      const script = document.createElement('script')
      script.src = src
      script.onload = () => resolve()
      script.onerror = () => {
        delete scriptPromises[src]
        reject(new Error(`Failed to load ${src}`))
      }
      document.body.appendChild(script)
    })

    return scriptPromises[src]
  }

  return loadScript('/js/skulpt.min.js').then(() => loadScript('/js/skulpt-stdlib.js'))
}

/**
 * Bounding box (CSS px, relative to the canvas element's top-left) of the
 * actually-painted pixels on a canvas. Skulpt's turtle canvas is a fixed
 * 2000×2000, almost all of it blank — framing the element would shrink the
 * real drawing to a dot, so we scan for non-transparent pixels instead.
 * Returns null for an empty/unreadable canvas (caller falls back to the
 * element's own bounds).
 */
function getCanvasDrawnBounds(
  cv: HTMLCanvasElement,
): { left: number; top: number; width: number; height: number } | null {
  const w = cv.width
  const h = cv.height
  if (w === 0 || h === 0) return null
  let data: Uint8ClampedArray
  try {
    const ctx = cv.getContext('2d')
    if (!ctx) return null
    data = ctx.getImageData(0, 0, w, h).data
  } catch {
    return null // tainted canvas — can't read pixels
  }
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] !== 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX) return null // nothing painted
  // The canvas may be displayed at a different size than its backing-store
  // resolution — convert pixel coords to CSS px.
  const sx = cv.offsetWidth / w
  const sy = cv.offsetHeight / h
  return {
    left: minX * sx,
    top: minY * sy,
    width: (maxX - minX + 1) * sx,
    height: (maxY - minY + 1) * sy,
  }
}

/**
 * Preload SQL.js and optionally a specific database.
 * Returns a promise that resolves when SQL.js is ready.
 */
function preloadSqlJs(dbPath?: string): Promise<void> {
  return import('@/lib/sql-executor.client').then(({ loadDatabase }) => {
    if (dbPath) {
      return loadDatabase(dbPath).then(() => {})
    }
    return Promise.resolve()
  })
}

/** Compact byte-size formatter for the Files panel ("245 B", "12 KB", "3.4 MB"). */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Compare two SQL result sets for equality.
 * Row-order sensitive, string-coerced values.
 */
function compareResultSets(a: SqlResultSet[], b: SqlResultSet[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].columns.length !== b[i].columns.length) return false
    if (a[i].values.length !== b[i].values.length) return false
    for (let j = 0; j < a[i].values.length; j++) {
      const aRow = a[i].values[j].map(String)
      const bRow = b[i].values[j].map(String)
      if (aRow.length !== bRow.length) return false
      if (aRow.some((v, k) => v !== bRow[k])) return false
    }
  }
  return true
}

export const CodeEditor = memo(function CodeEditor({
  id = 'code-editor',
  pageId,
  skriptId,
  language = 'python',
  initialCode = '# Write your code here\nprint("Hello, World!")',
  initialFiles,
  showCanvas = true,
  db = '/sql/netflixdb.sqlite',
  schemaImage,
  schemaImageDark,
  singleFile = false,
  solution,
  exam = false,
  checkCode,
  checkStages,
  checkPoints,
  maxChecks,
  attachedFiles,
  allowUpload = false,
  acceptUploads,
  height: explicitHeight,
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme()
  const { data: session } = useSession()
  const { selectedClass, selectedStudent, isTeacher } = useTeacherClass()
  const dialog = useAlertDialog()
  const [mounted, setMounted] = useState(false)
  const [runState, setRunState] = useState<RunState>(RunState.STOPPED)
  const [output, setOutput] = useState<OutputEntry[]>([])
  const [verificationResult, setVerificationResult] = useState<{ isCorrect: boolean; showSolution: boolean } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [editorReady, setEditorReady] = useState(false)

  // Python check state
  const [checkResults, setCheckResults] = useState<PythonCheckResult[] | null>(null)
  const [checksUsed, setChecksUsed] = useState(0)
  const [isChecking, setIsChecking] = useState(false)
  // Celebration trigger: bumped only when a fresh check transitions from
  // not-all-passing to all-passing. `prevAllPassedRef` tracks the previous
  // outcome (including state restored from save) so we don't re-celebrate
  // on reload or when the student re-clicks Test while already passing.
  const [celebrationToken, setCelebrationToken] = useState(0)
  const prevAllPassedRef = useRef(false)

  // ── Staged checks ─────────────────────────────────────────────────────────
  // Normalize to a stages array: explicit checkStages wins; otherwise wrap the
  // legacy single checkCode as one stage; otherwise no checks.
  const stages: CheckStage[] = useMemo(() => {
    if (checkStages && checkStages.length > 0) return checkStages
    if (checkCode) return [{ code: checkCode, points: checkPoints, maxChecks }]
    return []
  }, [checkStages, checkCode, checkPoints, maxChecks])
  const hasChecks = stages.length > 0
  const isStaged = stages.length > 1
  const [currentStage, setCurrentStage] = useState(0)
  const activeStage: CheckStage | undefined = stages[Math.min(currentStage, stages.length - 1)]
  const effectiveCheckCode = activeStage?.code
  const effectiveCheckPoints = activeStage?.points ?? checkPoints
  const effectiveMaxChecks = activeStage?.maxChecks ?? maxChecks
  const coupledVideo = useCoupledVideo()

  const debugTag = `[CodeEditor:${id}]`
  const dbName = db ? db.split('/').pop() || db : 'Database'

  // User data persistence - only if pageId is provided
  const componentId = `code-editor-${id}`
  const highlightsComponentId = `code-highlights-${id}` // Separate adapter for broadcast highlights
  const verificationComponentId = `sql-verification-${id}`

  // Teacher's "view this student's submission" mode. When a snapshot exists
  // for this componentId, the editor swaps to a read-only view of that
  // checkpoint payload instead of the teacher's own IndexedDB record. The
  // StudentSnapshotProvider above this tree batches the fetch; we just look
  // up our slice here. `isViewingSnapshot` short-circuits the save paths
  // below so teacher state isn't clobbered while viewing.
  const {
    isViewing: isViewingSnapshot,
    isLoading: snapshotLoading,
    snapshot: studentSnapshot,
  } = useStudentSnapshot(componentId)
  // Code editor's main data is intentionally LOCAL-ONLY. The keystroke-level
  // save path stays in IndexedDB; the server only sees explicit user actions
  // via checkpoints (manual save, "Check" press, exam hand-in). This keeps
  // server volume bounded and matches the agreed model (manual + check +
  // handin), avoiding a keystroke-level firehose.
  const { data: savedData, updateData: savePersistentData, isLoading } = useUserData<CodeEditorData>(
    pageId || 'no-page', // Fallback if no pageId
    componentId,
    null
  )

  // Persist SQL verification result so teachers can see class progress.
  // Only active when this editor has a solution and a pageId to key the record.
  const { updateData: saveVerification } = useSyncedUserData<SqlVerificationData>(
    pageId && solution ? pageId : '',
    verificationComponentId,
    null
  )

  // Persist Python check results for teacher dashboard
  const pythonCheckComponentId = `python-check-${id}`
  const { data: savedCheckData, updateData: savePythonCheck } = useSyncedUserData<PythonCheckData>(
    pageId && hasChecks ? pageId : '',
    pythonCheckComponentId,
    null
  )

  // Restore checksUsed + cleared stage from persisted data on mount
  useEffect(() => {
    if (!savedCheckData) return
    if (typeof savedCheckData.currentStage === 'number') {
      setCurrentStage(Math.min(savedCheckData.currentStage, Math.max(stages.length - 1, 0)))
    }
    if (savedCheckData.checksUsed > 0) {
      setChecksUsed(savedCheckData.checksUsed)
      setCheckResults(savedCheckData.lastResults)
      // Seed prev-allPassed so a restored passing state doesn't re-celebrate
      // when the student clicks Test once more with the same passing code.
      const restored = savedCheckData.lastResults
      prevAllPassedRef.current = restored.length > 0 && restored.every(r => r.passed)
    }
  }, [savedCheckData, stages.length])

  // Register each stage's gate with the coupled-video context so the video
  // pauses at that mark. Cleared when the editor unmounts or stages change.
  useEffect(() => {
    if (!coupledVideo) return
    const keys: string[] = []
    stages.forEach((s, i) => {
      const t = s.gateAt != null ? parseTimecode(s.gateAt) : NaN
      if (!Number.isNaN(t)) {
        const key = `${pythonCheckComponentId}-stage-${i}`
        coupledVideo.registerGate(key, t)
        keys.push(key)
      }
    })
    return () => keys.forEach((k) => coupledVideo.unregisterGate(k))
    // registerGate/unregisterGate are stable; re-run only when stages change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stages, pythonCheckComponentId, coupledVideo?.registerGate, coupledVideo?.unregisterGate])

  // Mark gates for already-cleared stages as passed (e.g. on reload after the
  // student advanced in a prior session) so a coupled video doesn't get stuck
  // at a mark the student already earned. Gate state is per-mount.
  useEffect(() => {
    if (!coupledVideo) return
    for (let i = 0; i < currentStage; i++) {
      coupledVideo.markPassed(`${pythonCheckComponentId}-stage-${i}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStage, pythonCheckComponentId, coupledVideo?.markPassed])

  // Code-editor highlights are always personal — never broadcast.
  // Why: teacher and student have different code in the same editor, so
  // character-offset highlights (from/to) would land on the wrong text on
  // the student's side. Page-level highlights/drawings are still broadcast
  // by the annotation layer; only code-editor highlights are local.
  // The broadcast plumbing below is intentionally left in place but inert
  // (syncOptions = {} → isBroadcastMode = false everywhere downstream).
  const syncOptions: SyncedUserDataOptions = useMemo(() => ({}), [])

  // Whether we're in broadcast mode (targeting is set)
  const isBroadcastMode = Boolean(syncOptions.targetType && syncOptions.targetId)

  // Broadcast highlights hook - stores ONLY highlights for targeted audience
  // DESIGN DECISION: Highlights are stored separately from CodeEditorData because:
  // - Code/settings should stay personal (students write their own code)
  // - Only highlights should be broadcastable
  // LIMITATION: This means two separate IndexedDB records per editor when broadcasting.
  // See: highlightsComponentId = `code-highlights-${id}` vs componentId = `code-editor-${id}`
  const { data: broadcastHighlightsData, updateData: updateBroadcastHighlights, isLoading: broadcastIsLoading } = useSyncedUserData<BroadcastHighlightsData>(
    isBroadcastMode && pageId ? pageId : '',
    highlightsComponentId,
    null,
    syncOptions
  )

  // Current user's author ID for highlights/comments ownership
  // Used to determine if user can delete a highlight or edit a comment
  const currentAuthorId: string | undefined = session?.user?.id

  // Students no longer receive teacher highlights inside code editors —
  // see the syncOptions comment above. Any pre-existing class/individual
  // code-highlight broadcast records in the DB are intentionally ignored
  // here so old data doesn't ghost into the new behavior.
  const teacherHighlightsForEditor = useMemo<CodeHighlight[]>(() => [], [])

  // Version history hooks
  const createVersion = useCreateVersion<CodeEditorData>(pageId || 'no-page', componentId)
  const { versions, isLoading: versionsLoading, refresh: refreshVersions } = useVersionHistory(pageId || 'no-page', componentId)
  const { restore, isRestoring } = useRestoreVersion<CodeEditorData>(pageId || 'no-page', componentId)
  const { deleteVersion, isDeleting } = useDeleteVersion(pageId || 'no-page', componentId)
  const updateLabel = useUpdateVersionLabel()

  // Orphaned-versions feature: track currently-mounted code editors on this
  // page and surface IndexedDB componentIds whose history rows exist but no
  // editor on the page claims them. Happens when teachers edit markdown:
  // the deterministic id-hash flips, the editor remounts under a new
  // componentId, and the previous saves are stranded.
  useEffect(() => {
    if (!pageId) return
    return registerEditor(pageId, componentId)
  }, [pageId, componentId])
  // useSyncExternalStore is the right primitive here: it handles the
  // subscribe-vs-first-notify race that a useEffect+setState pair has
  // (the registerEditor effect fires the registry listener before a
  // separate subscribe effect can attach, and that first notification
  // gets dropped, leaving mountedIds permanently stale).
  const getMountedSnapshot = useCallback(() => getMountedIds(pageId || ''), [pageId])
  const mountedIds = useSyncExternalStore(subscribeToMounted, getMountedSnapshot, getMountedSnapshot)
  const { orphans, refresh: refreshOrphans } = useOrphanedComponentIds(pageId || '', mountedIds)
  const reassignHistory = useReassignVersionHistory(pageId || '', componentId)
  // Tracks whether we've already taken a "safety" autosave during this
  // editor instance's lifetime. The orphan-preview flow autosaves the
  // current state before clobbering the editor with the orphan's content,
  // but only ONCE — subsequent previews would just snapshot already-
  // previewed content, which adds nothing.
  const safetyAutosaveDoneRef = useRef(false)

  // Per-kind sequential default labels: auto1/auto2/…, manual1/manual2/…,
  // check1/check2/…, run1/run2/… Computed in chronological (oldest-first)
  // order so the user-visible numbering matches the order events actually
  // happened. Keyed by the row's IndexedDB id when present (stable across
  // renders), falling back to versionNumber for legacy/unmigrated rows.
  const defaultVersionLabels = useMemo(() => {
    const sortedAsc = [...versions].sort((a, b) => a.createdAt - b.createdAt)
    const counters: Record<string, number> = { auto: 0, manual: 0, check: 0, run: 0 }
    const labelMap = new Map<number | string, string>()
    for (const v of sortedAsc) {
      const k = v.kind ?? (v.isManualSave ? 'manual' : 'auto')
      counters[k] = (counters[k] ?? 0) + 1
      const key = v.id ?? `v-${v.versionNumber}`
      labelMap.set(key, `${k}${counters[k]}`)
    }
    return labelMap
  }, [versions])

  // Pending input() state for Skulpt interactive programs
  const [pendingInput, setPendingInput] = useState<{
    prompt: string
    resolve: (value: string) => void
    reject: (reason: Error) => void
  } | null>(null)
  const pendingInputRef = useRef<typeof pendingInput>(null)
  // Aborts the in-flight JS Worker run (Stop button → worker.terminate()).
  const jsAbortControllerRef = useRef<AbortController | null>(null)
  // Aborts the in-flight Pyodide Worker run / check (Stop button → terminatePyodideWorker()).
  const pyodideAbortControllerRef = useRef<AbortController | null>(null)

  // Output/History panel state
  const [activePanel, setActivePanel] = useState<'output' | 'history' | 'orphans'>('output')
  const [panelVisible, setPanelVisible] = useState(false)
  const [highlightedVersion, setHighlightedVersion] = useState<number | null>(null)
  const [editingVersion, setEditingVersion] = useState<number | null>(null)
  const [editingLabel, setEditingLabel] = useState<string>('')
  const [confirmDeletion, setConfirmDeletion] = useState(false)
  const [showAutosaves, setShowAutosaves] = useState(false)

  // Keystroke counter for version creation. Resets synchronously when an
  // autosave fires (before the async createVersion settles) so a burst of
  // keystrokes during the await doesn't re-fire the trigger over and over.
  const keystrokeCountRef = useRef(0)
  // Idle-based autosave: fires after the student stops typing for a moment,
  // even if they haven't hit the 100-keystroke threshold. Without this,
  // short edits (a one-line tweak, a few-word change) never create a
  // version snapshot until the next 100-keystroke milestone.
  const autosaveIdleTimerRef = useRef<NodeJS.Timeout | null>(null)
  const AUTOSAVE_IDLE_MS = 3000

  // Helper to get file extension based on language.
  // Default case guards the template-literal call sites (`main${getFileExtension(language)}`)
  // from emitting "mainundefined" if `language` ever arrives as anything outside
  // the declared union — which a past bug did, leaving "mainundefined" files in
  // some students' IndexedDB. The load-time repair below renames those.
  const getFileExtension = (lang: 'python' | 'javascript' | 'sql'): string => {
    switch (lang) {
      case 'python': return '.py'
      case 'javascript': return '.js'
      case 'sql': return '.sql'
      default: return '.py'
    }
  }

  // Initialize default data
  const defaultData: CodeEditorData = {
    files: initialFiles && initialFiles.length > 0
      ? initialFiles
      : [{ name: `main${getFileExtension(language)}`, content: initialCode }],
    activeFileIndex: 0,
    fontSize: 14,
    lineWrapping: true,
    editorWidth: 50,
  }

  // Resizable panel state (horizontal splitter between editor and graphics)
  const [editorWidth, setEditorWidth] = useState<number>(defaultData.editorWidth ?? 50)
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const MIN_VISIBLE_WIDTH = 100 // pixels

  // Resizable output panel state (vertical splitter between main content and output)
  const [outputPanelHeight, setOutputPanelHeight] = useState(220) // default height in pixels
  const [isDraggingHorizontalSplitter, setIsDraggingHorizontalSplitter] = useState(false)
  const MIN_OUTPUT_HEIGHT = 0 // allow collapsing completely
  const MAX_OUTPUT_HEIGHT = 800 // maximum output panel height (generous to allow large result sets)
  const SPLITTER_HEIGHT = 8 // actual rendered height of horizontal splitter (minHeight: 8px)
  // Drag start state for splitter/resize — delta-based to avoid scroll-induced feedback loops.
  // `zoom` captures any ancestor `transform: scale()` (e.g. annotation-layer page zoom)
  // so cursor-pixel deltas can be converted to logical-pixel heights.
  const splitterDragStartRef = useRef<{ startY: number; startEditor: number; startOutput: number; zoom: number } | null>(null)
  const resizeDragStartRef = useRef<{ startY: number; startHeight: number; zoom: number } | null>(null)

  // Live ancestor zoom (annotation-layer page zoom). Read at mousedown only.
  const getZoom = useZoom()

  // Run button success flash state
  const [showSuccessFlash, setShowSuccessFlash] = useState(false)

  // Database loading status (SQL editors with a db only)
  const [dbStatus, setDbStatus] = useState<'idle' | 'loading' | 'ready'>('idle')

  // Python kernel state
  const [activeKernel, setActiveKernel] = useState<'skulpt' | 'pyodide' | null>(null)
  const [kernelLoading, setKernelLoading] = useState(false)
  const [showKernelMenu, setShowKernelMenu] = useState(false)
  const [kernelMenuPosition, setKernelMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const kernelButtonRef = useRef<HTMLButtonElement>(null)
  const kernelMenuRef = useRef<HTMLDivElement>(null)

  // Close kernel menu when clicking outside
  useEffect(() => {
    if (!showKernelMenu) return

    const handleClickOutside = (e: MouseEvent) => {
      if (kernelMenuRef.current && !kernelMenuRef.current.contains(e.target as Node)) {
        setShowKernelMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showKernelMenu])

  // Manual resize handle state (bottom-right corner)
  const [manualHeight, setManualHeight] = useState<number | null>(null) // null = use auto-height
  const [isDraggingResize, setIsDraggingResize] = useState(false)

  // Auto-height constants
  const LINE_HEIGHT = 20 // approximate line height in pixels
  const MIN_EDITOR_HEIGHT = 200 // minimum height for the editor component
  const MAX_EDITOR_HEIGHT = 600 // maximum height before scrolling

  // Multi-file support
  const [files, setFiles] = useState<PythonFile[]>(defaultData.files)
  const [activeFileIndex, setActiveFileIndex] = useState(defaultData.activeFileIndex)
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Python global imports — shared files available across editors
  // Skript-scoped: shared across all Python editors in this skript
  // Global: shared across all Python editors in all skripts
  //
  // Uses userDataService directly instead of useSyncedUserData to avoid
  // React state updates that cause CodeMirror focus loss (see commit 5d673d7).
  // The sync engine picks up dirty records automatically.
  const isPython = language === 'python'
  const [skriptImports, setSkriptImports] = useState<GlobalImportsData>({ files: [] })
  const [globalImports, setGlobalImports] = useState<GlobalImportsData>({ files: [] })

  // Stable per-instance ID for pub/sub self-filtering
  const editorInstanceId = useRef(crypto.randomUUID()).current

  // Load import files from IndexedDB on mount + subscribe for cross-editor sync
  useEffect(() => {
    if (!isPython) return
    const loadImports = async () => {
      if (skriptId) {
        const record = await userDataService.get<GlobalImportsData>(skriptId, 'python-imports')
        if (record?.data) setSkriptImports(record.data)
      }
      const globalRecord = await userDataService.get<GlobalImportsData>('__global__', 'python-imports')
      if (globalRecord?.data) setGlobalImports(globalRecord.data)
    }
    loadImports()

    // Subscribe to changes from other editors
    const unsubs: Array<() => void> = []

    if (skriptId) {
      unsubs.push(
        userDataService.subscribe<GlobalImportsData>(skriptId, 'python-imports', (data, sourceId) => {
          if (sourceId === editorInstanceId) return // ignore self
          setSkriptImports(data)
        }, { id: editorInstanceId })
      )
    }

    unsubs.push(
      userDataService.subscribe<GlobalImportsData>('__global__', 'python-imports', (data, sourceId) => {
        if (sourceId === editorInstanceId) return
        setGlobalImports(data)
      }, { id: editorInstanceId })
    )

    return () => { unsubs.forEach(fn => fn()) }
  }, [isPython, skriptId, editorInstanceId])

  // Save helpers that write to IndexedDB directly (no React state update during typing)
  const saveSkriptImports = useCallback((data: GlobalImportsData) => {
    setSkriptImports(data)
    if (skriptId) {
      userDataService.save(skriptId, 'python-imports', data, { immediate: true, sourceId: editorInstanceId })
    }
  }, [skriptId, editorInstanceId])

  const saveGlobalImports = useCallback((data: GlobalImportsData) => {
    setGlobalImports(data)
    userDataService.save('__global__', 'python-imports', data, { immediate: true, sourceId: editorInstanceId })
  }, [editorInstanceId])

  // ====================================================================
  // Binary files (uploaded by students or attached by teacher in markdown).
  // Three scopes mirror the python-imports tiers.
  // All scope records persist in IndexedDB with localOnly: true so the sync
  // engine never pushes them to the server. See provider.tsx + sync-engine.ts.
  // ====================================================================
  const editorBinariesPageId = pageId || 'no-page'
  const editorBinariesComponentId = `code-editor-${id}-binaries`
  const skriptBinariesComponentId = 'python-binaries'
  const globalBinariesComponentId = 'python-binaries'

  type BinaryScope = 'editor' | 'skript' | 'global'
  const [editorBinaries, setEditorBinaries] = useState<BinaryFileData>({ files: [] })
  const [skriptBinaries, setSkriptBinaries] = useState<BinaryFileData>({ files: [] })
  const [globalBinaries, setGlobalBinaries] = useState<BinaryFileData>({ files: [] })
  // Pending scope-change confirmation. Lives at this level (not inside the dropdown
  // block lower down) because applyScopeChange — defined right after the binary save
  // helpers — needs to read it.
  const [pendingScopeChange, setPendingScopeChange] = useState<{
    name: string
    sizeBytes: number
    fromScope: BinaryScope
    toScope: BinaryScope
  } | null>(null)
  // Inline rename state for the binaries list.
  const [renamingBinary, setRenamingBinary] = useState<{ scope: BinaryScope; oldName: string } | null>(null)
  const [renameBinaryValue, setRenameBinaryValue] = useState('')

  useEffect(() => {
    if (!isPython) return

    const loadBinaries = async () => {
      const editorRec = await userDataService.get<BinaryFileData>(editorBinariesPageId, editorBinariesComponentId)
      if (editorRec?.data) setEditorBinaries(editorRec.data)
      if (skriptId) {
        const skriptRec = await userDataService.get<BinaryFileData>(skriptId, skriptBinariesComponentId)
        if (skriptRec?.data) setSkriptBinaries(skriptRec.data)
      }
      const globalRec = await userDataService.get<BinaryFileData>('__global__', globalBinariesComponentId)
      if (globalRec?.data) setGlobalBinaries(globalRec.data)
    }
    loadBinaries()

    // Cross-editor sync: when the user uploads/promotes/removes in editor A,
    // editor B in the same scope picks up the change without a reload.
    const unsubs: Array<() => void> = []

    if (skriptId) {
      unsubs.push(
        userDataService.subscribe<BinaryFileData>(skriptId, skriptBinariesComponentId, (data, sourceId) => {
          if (sourceId === editorInstanceId) return
          setSkriptBinaries(data)
        }, { id: editorInstanceId })
      )
    }

    unsubs.push(
      userDataService.subscribe<BinaryFileData>('__global__', globalBinariesComponentId, (data, sourceId) => {
        if (sourceId === editorInstanceId) return
        setGlobalBinaries(data)
      }, { id: editorInstanceId })
    )

    return () => { unsubs.forEach(fn => fn()) }
  }, [isPython, skriptId, editorInstanceId, editorBinariesPageId, editorBinariesComponentId])

  const saveEditorBinaries = useCallback((data: BinaryFileData) => {
    setEditorBinaries(data)
    userDataService.save(editorBinariesPageId, editorBinariesComponentId, data, {
      immediate: true,
      sourceId: editorInstanceId,
      localOnly: true,
    })
  }, [editorBinariesPageId, editorBinariesComponentId, editorInstanceId])

  const saveSkriptBinaries = useCallback((data: BinaryFileData) => {
    setSkriptBinaries(data)
    if (skriptId) {
      userDataService.save(skriptId, skriptBinariesComponentId, data, {
        immediate: true,
        sourceId: editorInstanceId,
        localOnly: true,
      })
    }
  }, [skriptId, skriptBinariesComponentId, editorInstanceId])

  const saveGlobalBinaries = useCallback((data: BinaryFileData) => {
    setGlobalBinaries(data)
    userDataService.save('__global__', globalBinariesComponentId, data, {
      immediate: true,
      sourceId: editorInstanceId,
      localOnly: true,
    })
  }, [globalBinariesComponentId, editorInstanceId])

  // Binary helpers (upload, remove, change scope). All work in-memory + IndexedDB
  // — none of these ever hit the network.
  const writeBinariesForScope = useCallback((scope: 'editor' | 'skript' | 'global', data: BinaryFileData) => {
    if (scope === 'editor') saveEditorBinaries(data)
    else if (scope === 'skript') saveSkriptBinaries(data)
    else saveGlobalBinaries(data)
  }, [saveEditorBinaries, saveSkriptBinaries, saveGlobalBinaries])

  const readBinariesForScope = useCallback((scope: 'editor' | 'skript' | 'global'): BinaryFileData => {
    if (scope === 'editor') return editorBinaries
    if (scope === 'skript') return skriptBinaries
    return globalBinaries
  }, [editorBinaries, skriptBinaries, globalBinaries])

  // Default upload destination is the editor scope. Students can promote later.
  const handleBinaryUpload = useCallback(async (filesList: FileList | null) => {
    if (!filesList || filesList.length === 0) return
    const incoming: BinaryFile[] = []
    for (let i = 0; i < filesList.length; i++) {
      const f = filesList[i]
      incoming.push({
        name: f.name,
        bytes: f,                  // a File is a Blob — Dexie stores it natively
        sizeBytes: f.size,
        addedAt: Date.now(),
        source: 'student',
      })
    }
    // Replace any existing entries with the same name (latest upload wins).
    const existing = editorBinariesRef.current.files.filter(f => !incoming.some(n => n.name === f.name))
    saveEditorBinaries({ files: [...existing, ...incoming] })
  }, [saveEditorBinaries])

  const removeBinary = useCallback((scope: 'editor' | 'skript' | 'global', name: string) => {
    const current = readBinariesForScope(scope)
    writeBinariesForScope(scope, { files: current.files.filter(f => f.name !== name) })
  }, [readBinariesForScope, writeBinariesForScope])

  // Rename a binary in place. If the new name collides with an existing file in
  // the same scope, the older entry is replaced (matches upload semantics).
  const renameBinary = useCallback((scope: 'editor' | 'skript' | 'global', oldName: string, newName: string) => {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) return
    const current = readBinariesForScope(scope)
    const target = current.files.find(f => f.name === oldName)
    if (!target) return
    const renamed: BinaryFile = { ...target, name: trimmed }
    writeBinariesForScope(scope, {
      files: [...current.files.filter(f => f.name !== oldName && f.name !== trimmed), renamed],
    })
  }, [readBinariesForScope, writeBinariesForScope])

  // Apply a scope change after the user confirms the modal.
  const applyScopeChange = useCallback(() => {
    if (!pendingScopeChange) return
    const { name, fromScope, toScope } = pendingScopeChange
    const fromData = readBinariesForScope(fromScope)
    const file = fromData.files.find(f => f.name === name)
    if (!file) {
      setPendingScopeChange(null)
      return
    }
    // Remove from source scope.
    writeBinariesForScope(fromScope, { files: fromData.files.filter(f => f.name !== name) })
    // Add to target scope (replacing any same-name entry).
    const toData = readBinariesForScope(toScope)
    writeBinariesForScope(toScope, {
      files: [...toData.files.filter(f => f.name !== name), file],
    })
    setPendingScopeChange(null)
  }, [pendingScopeChange, readBinariesForScope, writeBinariesForScope])

  // Which import files are currently open as tabs
  const [openImports, setOpenImports] = useState<Array<{ name: string; scope: 'skript' | 'global' }>>([])
  // Active tab: either a local file or an import file
  const [activeTab, setActiveTab] = useState<
    | { type: 'local'; index: number }
    | { type: 'import'; scope: 'skript' | 'global'; name: string }
  >({ type: 'local', index: 0 })
  // Whether the imports dropdown is open
  const [showImportsDropdown, setShowImportsDropdown] = useState(false)
  const [importsDropdownPosition, setImportsDropdownPosition] = useState<{ top: number; left: number } | null>(null)
  const importsDropdownRef = useRef<HTMLDivElement>(null)
  const importsDropdownPortalRef = useRef<HTMLDivElement>(null)

  // Close imports dropdown on outside click
  useEffect(() => {
    if (!showImportsDropdown) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (importsDropdownRef.current?.contains(target)) return
      if (importsDropdownPortalRef.current?.contains(target)) return
      if (importContextMenuRef.current?.contains(target)) return
      setShowImportsDropdown(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showImportsDropdown])

  // Binary files dropdown (the unified Files panel for teacher-attached + student uploads).
  // The pending-scope state itself is declared earlier (see above) because applyScopeChange
  // depends on it and is hoisted higher in the component.
  const [showBinariesDropdown, setShowBinariesDropdown] = useState(false)
  const [binariesDropdownPosition, setBinariesDropdownPosition] = useState<{ top: number; left: number } | null>(null)
  const binariesDropdownRef = useRef<HTMLDivElement>(null)
  const binariesDropdownPortalRef = useRef<HTMLDivElement>(null)
  const binariesFileInputRef = useRef<HTMLInputElement>(null)

  // Close binaries dropdown on outside click
  useEffect(() => {
    if (!showBinariesDropdown) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (binariesDropdownRef.current?.contains(target)) return
      if (binariesDropdownPortalRef.current?.contains(target)) return
      // Don't close while the scope-change modal is open — the modal lives outside the portal.
      if (pendingScopeChange) return
      setShowBinariesDropdown(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showBinariesDropdown, pendingScopeChange])

  // Tab context menu (right-click / long-press)
  const [tabContextMenu, setTabContextMenu] = useState<{ index: number; x: number; y: number } | null>(null)
  const tabContextMenuRef = useRef<HTMLDivElement>(null)
  const tabLongPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Import file context menu (right-click on import tabs and dropdown items)
  const [importContextMenu, setImportContextMenu] = useState<{ scope: 'skript' | 'global'; name: string; x: number; y: number } | null>(null)
  const importContextMenuRef = useRef<HTMLDivElement>(null)
  const [renamingImport, setRenamingImport] = useState<{ scope: 'skript' | 'global'; name: string } | null>(null)

  // Close tab context menu on outside click
  useEffect(() => {
    if (!tabContextMenu && !importContextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (tabContextMenuRef.current?.contains(e.target as Node)) {
        return
      }
      if (importContextMenuRef.current?.contains(e.target as Node)) {
        return
      }
      setTabContextMenu(null)
      setImportContextMenu(null)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [tabContextMenu, importContextMenu])

  // Highlighter state
  const [highlighterMode, setHighlighterMode] = useState(false)
  const [highlightColor, setHighlightColor] = useState<HighlightColor>('yellow')

  // Generate cursor SVG data URI based on highlight color
  const highlighterCursor = useMemo(() => {
    const color = highlightColorHex[highlightColor]
    return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='${color}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 11-6 6v3h9l3-3'/%3E%3Cpath d='m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'/%3E%3C/svg%3E") 3 21, crosshair`
  }, [highlightColor])
  const [showColorPicker, setShowColorPicker] = useState(false)
  // `highlights` contains ONLY the user's own highlights (for persistence)
  // For teachers: either personal or broadcast highlights depending on mode
  // For students: only their personal highlights (teacher highlights come from teacherHighlightsForEditor)
  const [highlights, setHighlights] = useState<CodeHighlight[]>([])

  // Merge user's highlights with teacher highlights for rendering
  // IMPORTANT: This is for DISPLAY only - don't use for persistence!
  // - `highlights` state is persisted (user's own)
  // - `teacherHighlightsForEditor` is read-only from API
  // The isTeacher flag controls visual styling (dashed border) and interaction (no delete/comment buttons)
  // See: highlight-extension.ts createHighlightMark() and cm-highlight-teacher CSS class
  //
  // LIMITATION: Students cannot comment on teacher highlights.
  // Teacher highlights are stored in broadcast records that students can only read.
  // To enable student comments on teacher highlights, we'd need a separate storage
  // mechanism (e.g., student comments referencing teacher highlight IDs by foreign key).
  const displayHighlights = useMemo(() => {
    const studentHighlights = highlights.map(h => ({ ...h, isTeacher: false }))
    const teacherHighlights = teacherHighlightsForEditor.map(h => ({
      ...h,
      isTeacher: true as const
    }))
    return [...studentHighlights, ...teacherHighlights]
  }, [highlights, teacherHighlightsForEditor])

  const [hoveredHighlightId, setHoveredHighlightId] = useState<string | null>(null)
  const [deleteButtonPosition, setDeleteButtonPosition] = useState<{ x: number; y: number } | null>(null)

  // Comment popover state
  const [commentingHighlightId, setCommentingHighlightId] = useState<string | null>(null)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null) // null = adding new comment
  const [commentPopoverPosition, setCommentPopoverPosition] = useState<{ x: number; y: number } | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const commentInputRef = useRef<HTMLTextAreaElement>(null)

  // Comment indicator positions (for highlights with comments, shown even when not hovering)
  const [commentIndicators, setCommentIndicators] = useState<Array<{ id: string; x: number; y: number }>>([])
  const updateCommentIndicatorsRef = useRef<() => void>(() => {})

  // Calculate visibility based on width and detect graphics modules (turtle or matplotlib) or SQL schema
  const currentCode = activeTab.type === 'local'
    ? (files[activeFileIndex]?.content || initialCode)
    : (activeTab.type === 'import'
      ? ((activeTab.scope === 'skript' ? skriptImports : globalImports)?.files.find(f => f.name === activeTab.name)?.content || '')
      : initialCode)
  const hasTurtleModule = language === 'python' && /import\s+turtle|from\s+turtle/.test(currentCode)
  const hasMatplotlib = language === 'python' && /import\s+matplotlib|from\s+matplotlib/.test(currentCode)
  // PIL: any usage hints that the code may produce images (display(), Image.show(), etc.).
  // Matches `import PIL`, `from PIL`, `from PIL.Image` — same lightweight heuristic as matplotlib.
  const hasPil = language === 'python' && /import\s+PIL|from\s+PIL/.test(currentCode)
  // SQL schema: provided via schemaImage/schemaImageDark props (auto-detected in markdown renderer)
  const hasSqlSchema = language === 'sql' && !!(schemaImage || schemaImageDark)
  const hasGraphics = hasTurtleModule || hasMatplotlib || hasPil || hasSqlSchema
  const showEditor = containerRef.current ? (editorWidth / 100) * containerRef.current.offsetWidth >= MIN_VISIBLE_WIDTH : true
  const showGraphics = containerRef.current ? ((100 - editorWidth) / 100) * containerRef.current.offsetWidth >= MIN_VISIBLE_WIDTH : true
  const [canvasVisible, setCanvasVisible] = useState(false) // Start hidden, show only when graphics detected

  // The floating toolbar (highlighter / zoom / kernel indicator) is absolutely
  // positioned over the editor's top-right corner — in multi-file mode it sits
  // over the file-tabs row. Reserve its measured width as padding-right on that
  // row so the tab scrollbar stops before it. Width is dynamic (kernel label
  // text, conditional file buttons), so a fixed `pr-*` would let the scrollbar
  // run underneath the toolbar. `showEditor` is a dep because the toolbar
  // mounts/unmounts as the user resizes the editor/graphics split.
  const [toolbarWidth, setToolbarWidth] = useState(96)
  useEffect(() => {
    const el = kernelMenuRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setToolbarWidth(el.offsetWidth))
    ro.observe(el)
    setToolbarWidth(el.offsetWidth)
    return () => ro.disconnect()
  }, [showEditor])

  // Calculate auto-height based on number of lines in the code (editor area only, output adds separately)
  const lineCount = currentCode.split('\n').length
  const fileTabsHeight = singleFile ? 0 : 36 // height of file tabs row
  const calculatedEditorHeight = Math.max(
    MIN_EDITOR_HEIGHT,
    Math.min(MAX_EDITOR_HEIGHT, lineCount * LINE_HEIGHT + fileTabsHeight + 60) // 60px for controls
  )
  // User-adjusted editor height (set when dragging horizontal splitter, keeps total constant)
  const [userEditorHeight, setUserEditorHeight] = useState<number | null>(null)
  // Resolution order: manual splitter drag > explicit markdown `height="..."` > auto from line count.
  const editorHeight = userEditorHeight ?? explicitHeight ?? calculatedEditorHeight
  // Output panel adds to total height when visible
  const totalHeight = editorHeight + (panelVisible ? outputPanelHeight + SPLITTER_HEIGHT : 0)

  // Font size state
  const [fontSize, setFontSize] = useState<number>(defaultData.fontSize ?? 14)

  // Line wrapping state
  const [lineWrapping, setLineWrapping] = useState<boolean>(defaultData.lineWrapping ?? false)

  // Canvas pan and zoom state
  const [canvasTransform, setCanvasTransform] = useState(defaultData.canvasTransform ?? { x: 0, y: 0, scale: 1 })

  // Store the original initial files for reset functionality
  // This is the source of truth from the markdown and should never change
  const originalInitialFiles = useRef<PythonFile[]>(
    initialFiles && initialFiles.length > 0
      ? initialFiles
      : [{ name: `main${getFileExtension(language)}`, content: initialCode }]
  )
  const hasLoadedData = useRef(false)

  // Update original files when props change (markdown was edited)
  useEffect(() => {
    originalInitialFiles.current = initialFiles && initialFiles.length > 0
      ? initialFiles
      : [{ name: `main${getFileExtension(language)}`, content: initialCode }]
  }, [initialCode, initialFiles, language])

  useEffect(() => {
    // Only restore once when data first loads.
    // The editor id is a hash of the markdown content, so if the teacher edits
    // the markdown the componentId changes and no saved data will be found.
    if (!isLoading && !hasLoadedData.current) {
      console.debug(debugTag, 'userData loaded', !!savedData)
    }
    // In snapshot-view mode the teacher is looking at a student's checkpoint,
    // not their own. Skip the IndexedDB merge so we don't paint teacher state
    // over the snapshot. The snapshot-hydration effect further below applies
    // the student's payload via applyDataToEditor.
    if (isViewingSnapshot) {
      return
    }
    if (!isLoading && savedData && !hasLoadedData.current) {
      hasLoadedData.current = true

      if (savedData.files) {
        // LEGACY REPAIR: a past bug emitted file names like "mainundefined"
        // when getFileExtension fell off the switch. Rename them to the
        // correct extension so the student's content surfaces in the right
        // tab and merges with the markdown default. If the corrected name
        // collides with another already-saved file, suffix _recovered so we
        // never silently drop content (students have lost versions before).
        const correctExt = getFileExtension(language)
        const taken = new Set(
          savedData.files.filter(f => !f.name.endsWith('undefined')).map(f => f.name)
        )
        const repairedSavedFiles = savedData.files.map((f: PythonFile) => {
          if (!f.name.endsWith('undefined')) return f
          const base = f.name.slice(0, -'undefined'.length)
          let candidate = `${base}${correctExt}`
          let n = 1
          while (taken.has(candidate)) {
            candidate = `${base}_recovered${n}${correctExt}`
            n++
          }
          taken.add(candidate)
          return { ...f, name: candidate }
        })

        // Merge saved files with default files by name: saved content wins per-file,
        // but new files from markdown (e.g. a newly added caesar.py stub) are preserved.
        const savedByName = new Map(repairedSavedFiles.map((f: PythonFile) => [f.name, f]))
        const merged = defaultData.files.map(f => savedByName.get(f.name) || f)
        // Also append any saved files not in the default set (student-created files)
        for (const f of repairedSavedFiles) {
          if (!merged.some(m => m.name === f.name)) merged.push(f)
        }
        setFiles(merged)
      }
      if (savedData.activeFileIndex !== undefined) setActiveFileIndex(savedData.activeFileIndex)
      if (savedData.fontSize !== undefined) setFontSize(savedData.fontSize)
      if (savedData.lineWrapping !== undefined) setLineWrapping(savedData.lineWrapping)
      if (savedData.editorWidth !== undefined) setEditorWidth(savedData.editorWidth)
      if (savedData.canvasTransform) setCanvasTransform(savedData.canvasTransform)
      if (savedData.highlights && !isBroadcastMode) {
        setHighlights(savedData.highlights)
      }
    }
  }, [isLoading, savedData, isBroadcastMode, debugTag, isViewingSnapshot])

  // Track previous broadcast mode to detect mode switches
  // MODE SWITCHING BEHAVIOR:
  // When teacher toggles between my-view/class-broadcast/student-view,
  // we swap the entire highlights array rather than merging.
  // This keeps the editing experience simple but means:
  // - Unsaved changes in one mode are lost when switching
  // - Teacher can't see their personal + broadcast highlights at once
  // TRADE-OFF: Simplicity over feature richness. Could add "compare" mode later.
  // Load highlights from appropriate source when data finishes loading
  // Track which source we've loaded to avoid re-loading on every render,
  // but reset when page/target changes
  const loadedForKeyRef = useRef('')
  const currentKey = `${pageId}-${syncOptions.targetType ?? ''}-${syncOptions.targetId ?? ''}`

  useEffect(() => {
    if (loadedForKeyRef.current === currentKey) return

    // Wait for the appropriate hook to finish loading
    const stillLoading = isBroadcastMode ? broadcastIsLoading : isLoading
    if (stillLoading) return

    loadedForKeyRef.current = currentKey
    const sourceHighlights = isBroadcastMode
      ? (broadcastHighlightsData?.highlights || [])
      : (savedData?.highlights || [])
    setHighlights(sourceHighlights)
  }, [currentKey, isBroadcastMode, isLoading, broadcastIsLoading, broadcastHighlightsData, savedData])
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })

  // Refs
  const editorRef = useRef<HTMLDivElement>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const createVersionSnapshotRef = useRef<(isManualSave?: boolean) => Promise<void>>(() => Promise.resolve())

  // CodeMirror compartments for dynamic reconfiguration without destroying the editor
  const themeCompartment = useRef(new Compartment())
  const fontSizeCompartment = useRef(new Compartment())
  const lineWrappingCompartment = useRef(new Compartment())
  const readOnlyCompartment = useRef(new Compartment())

  const canvasRef = useRef<HTMLDivElement>(null)
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const outputPanelRef = useRef<HTMLDivElement>(null)

  // Update canvas visibility based on graphics module detection
  useEffect(() => {
    setCanvasVisible(hasGraphics)
  }, [hasGraphics])

  // Debounced auto-save for code content changes
  const contentSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Exam-only: signature of the last code state pushed to the SERVER, so the
  // crash-safety stream below skips no-op saves (avoids version churn).
  const lastStreamedSigRef = useRef<string | null>(null)

  const debouncedSaveContent = useCallback(() => {
    if (!editorViewRef.current || !pageId) return
    // In snapshot-view mode every write would clobber the teacher's own
    // record with the student's code. Read-only CodeMirror should prevent
    // user-driven calls in the first place, but keep this guard for any
    // programmatic path that might still reach in.
    if (isViewingSnapshot) return

    const content = editorViewRef.current.state.doc.toString()
    const currentTab = activeTabRef.current

    // If editing an import file, save to the import store
    if (currentTab.type === 'import') {
      const { scope, name } = currentTab
      const store = scope === 'skript' ? skriptImportsRef.current : globalImportsRef.current
      const updatedFiles = store.files.map(f => f.name === name ? { ...f, content } : f)
      // Update only the ref during typing to avoid re-renders,
      // persist directly to IndexedDB
      if (scope === 'skript') {
        skriptImportsRef.current = { files: updatedFiles }
        if (skriptId) userDataService.save(skriptId, 'python-imports', { files: updatedFiles }, { immediate: true, sourceId: editorInstanceId })
      } else {
        globalImportsRef.current = { files: updatedFiles }
        userDataService.save('__global__', 'python-imports', { files: updatedFiles }, { immediate: true, sourceId: editorInstanceId })
      }
      return
    }

    // Update the ref (not state!) so persistence reads the latest content.
    // We deliberately avoid setFiles() here — updating React state triggers a re-render
    // which causes DOM reconciliation that makes CodeMirror lose focus.
    filesRef.current = filesRef.current.map((file, idx) =>
      idx === activeFileIndex ? { ...file, content } : file
    )

    // Persist directly to IndexedDB via the service singleton, bypassing the
    // hook's updateData which calls setData and triggers a re-render. Outside
    // an exam the server only sees explicit user actions (manual save / Check /
    // hand-in) — checkpoint-only. INSIDE an exam we ALSO stream the live record
    // to the server (below) so a crash before hand-in doesn't lose code.
    const data = {
      files: filesRef.current,
      activeFileIndex,
      fontSize,
      lineWrapping,
      editorWidth,
      canvasTransform,
      highlights,
    }
    const savePromise = userDataService.save(pageId, componentId, data)

    // Exam crash-safety stream: push the just-saved record to the server via the
    // sync engine (the same debounced path useSyncedUserData/quiz answers use —
    // ~2s debounce + per-component coalescing, so this is one small POST per
    // typing pause, not per keystroke). check-inputs prefers the handin
    // checkpoint and falls back to this live userData, so a student who never
    // hands in (crash) still grades off their last stream. Deduped; best-effort.
    if (exam) {
      const sig = JSON.stringify(data)
      if (sig !== lastStreamedSigRef.current) {
        lastStreamedSigRef.current = sig
        void savePromise
          .then(async () => {
            const record = await userDataService.get(pageId, componentId)
            if (record) {
              syncEngine.queueSync(componentId, pageId, sig, record.version, { immediate: false })
            }
          })
          .catch((e) => console.error('[code-editor] exam autosave stream failed:', e))
      }
    }
  }, [activeFileIndex, pageId, componentId, fontSize, lineWrapping, editorWidth, canvasTransform, highlights, skriptId, editorInstanceId, isViewingSnapshot, exam])

  // Ref to avoid debouncedSaveContent as a dependency in the editor effect
  const debouncedSaveContentRef = useRef(debouncedSaveContent)

  // Save data to IndexedDB when anything changes
  // Files changes are debounced via the update listener, settings changes are immediate
  //
  // DUAL-WRITE PATTERN (broadcast mode):
  // When broadcasting, we write to TWO records simultaneously:
  // 1. code-highlights-{id} (targetType=class|student) - contains only highlights
  // 2. code-editor-{id} (no targeting) - contains code, settings, AND personal highlights
  //
  // This is intentional: personal code/settings shouldn't be overwritten when broadcasting.
  // COMPLEXITY NOTE: This means savedData?.highlights must be preserved during broadcast saves.
  // If this gets confusing, consider using a separate state variable for personal highlights.
  // Track the highlights payload last sent to the broadcast endpoint so we can
  // skip redundant network calls when this effect fires for unrelated reasons
  // (e.g. canvasTransform pan, font size). Without this, dragging the canvas in
  // broadcast mode floods /api/user-data/sync with an unchanged `{highlights:[]}`.
  const lastSyncedBroadcastHighlightsRef = useRef<string | null>(null)

  useEffect(() => {
    // Only save if pageId is provided (not in fallback mode)
    if (!pageId) return

    // Don't save during initial load - wait until data has been loaded/restored
    if (isLoading) {
      return
    }

    // Snapshot-view mode: the on-screen `files` are the student's checkpoint
    // payload, not the teacher's own work. Persisting would overwrite the
    // teacher's IndexedDB record with the student's code.
    if (isViewingSnapshot) return

    // In broadcast mode: save highlights to broadcast record, personal data keeps other settings
    // In personal mode: save everything to personal record
    if (isBroadcastMode) {
      // Only push to broadcast if highlights actually changed since last push.
      // Compared as JSON for a quick deep-equality check (highlights arrays are tiny).
      const serialized = JSON.stringify(highlights)
      if (serialized !== lastSyncedBroadcastHighlightsRef.current) {
        lastSyncedBroadcastHighlightsRef.current = serialized
        updateBroadcastHighlights({ highlights }, { immediate: true })
      }

      // Save personal data WITHOUT highlights (keep them separate).
      // useUserData under the hood — IndexedDB only, no network.
      const personalData: CodeEditorData = {
        files,
        activeFileIndex,
        fontSize,
        lineWrapping,
        editorWidth,
        canvasTransform,
        highlights: savedData?.highlights || [], // Preserve personal highlights
      }
      savePersistentData(personalData, { immediate: true })
    } else {
      // Personal mode: save everything including highlights
      const dataToSave: CodeEditorData = {
        files,
        activeFileIndex,
        fontSize,
        lineWrapping,
        editorWidth,
        canvasTransform,
        highlights,
      }
      savePersistentData(dataToSave, { immediate: true })
    }
  }, [activeFileIndex, fontSize, lineWrapping, editorWidth, canvasTransform, pageId, savePersistentData, files, componentId, isLoading, highlights, isBroadcastMode, updateBroadcastHighlights, savedData?.highlights, isViewingSnapshot])

  // Helper function to create a version snapshot
  const createVersionSnapshot = useCallback(async (isManualSave = false) => {
    if (!pageId) return

    // Read from filesRef (kept in sync with editor) instead of files state,
    // which lags behind because debouncedSaveContent writes to the ref, not state.
    const liveFiles = editorViewRef.current
      ? filesRef.current.map((file, idx) =>
          idx === activeFileIndex
            ? { ...file, content: editorViewRef.current!.state.doc.toString() }
            : file
        )
      : filesRef.current

    const dataToVersion: CodeEditorData = {
      files: liveFiles,
      activeFileIndex,
      fontSize,
      lineWrapping,
      editorWidth,
      canvasTransform,
      highlights,
    }

    // Don't create version if content matches initial/default code
    const currentContent = liveFiles.map(f => f.content).join('\n')
    const isDefaultContent = currentContent === initialCode || currentContent.trim() === ''
    if (isDefaultContent) {
      keystrokeCountRef.current = 0
      return
    }

    // The service layer dedupes unlabeled autosaves whose content hash
    // matches the most recent row (no new history entry, no refCount bump).
    // Blob storage is also shared via SHA-256 across all rows. Manual/check
    // saves and labeled autosaves always insert.
    // Pass an explicit `kind` so the history UI can render auto/manual labels.
    const version = await createVersion(dataToVersion, {
      isManualSave,
      kind: isManualSave ? 'manual' : 'auto',
    })
    await refreshVersions()
    keystrokeCountRef.current = 0 // Reset counter after creating version

    // Only open history tab for manual saves; also push a server checkpoint so
    // the teacher's timeline gets the snapshot. Fire-and-forget for the UX
    // path, but if the POST succeeds we stamp the local row with the server
    // id so the history overview can render a "synced" badge that survives
    // reloads. Checkpoint failures (incl. 402 free-tier gate) leave the row
    // unsynced — local save still succeeded.
    if (isManualSave) {
      setActivePanel('history')
      setHighlightedVersion(version.versionNumber)
      // Clear highlight after 2 seconds
      setTimeout(() => setHighlightedVersion(null), 2000)
      void (async () => {
        const result = await postCheckpoint({
          pageId,
          componentId,
          kind: 'manual',
          payload: dataToVersion,
          label: version.label,
        })
        if (result.id && version.id) {
          await userDataService.markVersionSynced(version.id, result.id)
          await refreshVersions()
        }
      })()
    }
  }, [pageId, componentId, activeFileIndex, fontSize, lineWrapping, editorWidth, canvasTransform, highlights, createVersion, refreshVersions, initialCode])

  // Create a "check" version row alongside the server checkpoint POST.
  // Local row gives the student a history entry like `check1`, `check2`, …;
  // synced badge appears when the POST succeeds.
  const createCheckVersion = useCallback(async (label?: string) => {
    if (!pageId) return
    if (isViewingSnapshot) return // teacher scratch-checking a student's snapshot: never persist
    const liveFiles = editorViewRef.current
      ? filesRef.current.map((file, idx) =>
          idx === activeFileIndex
            ? { ...file, content: editorViewRef.current!.state.doc.toString() }
            : file
        )
      : filesRef.current
    const payload: CodeEditorData = {
      files: liveFiles,
      activeFileIndex,
      fontSize,
      lineWrapping,
      editorWidth,
      canvasTransform,
      highlights,
    }
    try {
      const version = await createVersion(payload, { kind: 'check', label })
      const result = await postCheckpoint({
        pageId,
        componentId,
        kind: 'check',
        payload,
        label,
      })
      if (result.id && version.id) {
        await userDataService.markVersionSynced(version.id, result.id)
      }
      await refreshVersions()
    } catch (e) {
      console.error('createCheckVersion failed:', e)
    }
  }, [pageId, componentId, activeFileIndex, fontSize, lineWrapping, editorWidth, canvasTransform, highlights, createVersion, refreshVersions, isViewingSnapshot])

  // Create a "run" version row alongside the server checkpoint POST when
  // the student presses Run. Identical consecutive runs (no edits between
  // presses) are deduped at the service layer: createVersion returns the
  // existing row flagged with `isDuplicate`, and we skip the server POST
  // so the teacher's timeline doesn't fill with redundant Run events.
  const createRunVersion = useCallback(async () => {
    if (!pageId) return
    if (isViewingSnapshot) return // teacher scratch-running a student's snapshot: never persist
    const liveFiles = editorViewRef.current
      ? filesRef.current.map((file, idx) =>
          idx === activeFileIndex
            ? { ...file, content: editorViewRef.current!.state.doc.toString() }
            : file
        )
      : filesRef.current
    const payload: CodeEditorData = {
      files: liveFiles,
      activeFileIndex,
      fontSize,
      lineWrapping,
      editorWidth,
      canvasTransform,
      highlights,
    }
    try {
      const version = await createVersion(payload, { kind: 'run' })
      if (version.isDuplicate) {
        // Same content as the previous run — no new local row, no POST.
        return
      }
      const result = await postCheckpoint({
        pageId,
        componentId,
        kind: 'run',
        payload,
      })
      if (result.id && version.id) {
        await userDataService.markVersionSynced(version.id, result.id)
      }
      await refreshVersions()
    } catch (e) {
      console.error('createRunVersion failed:', e)
    }
  }, [pageId, componentId, activeFileIndex, fontSize, lineWrapping, editorWidth, canvasTransform, highlights, createVersion, refreshVersions, isViewingSnapshot])

  // Promote a local autosave to a synced manual save. The original payload
  // is read from the version's blob, the row's `kind` flips to 'manual', and
  // a checkpoint POST stamps the row with serverCheckpointId so the icon
  // turns into the synced cloud. The user-facing display name is preserved
  // (frozen as an explicit `label`) so what was "auto3" stays "auto3"
  // visually instead of jumping to "manualN".
  const promoteVersion = useCallback(async (
    version: { id?: number; versionNumber: number; label?: string }
  ) => {
    if (!pageId || !version.id) return
    try {
      const payload = await userDataService.getVersionPayload<CodeEditorData>(version.id)
      if (!payload) return
      const preservedLabel = version.label || defaultVersionLabels.get(version.id) || `v${version.versionNumber}`
      await userDataService.updateVersion(version.id, {
        kind: 'manual',
        isManualSave: true,
        label: preservedLabel,
      })
      await refreshVersions()
      const result = await postCheckpoint({
        pageId,
        componentId,
        kind: 'manual',
        payload,
        label: preservedLabel,
      })
      if (result.id) {
        await userDataService.markVersionSynced(version.id, result.id)
        await refreshVersions()
      }
    } catch (e) {
      console.error('promoteVersion failed:', e)
    }
  }, [pageId, componentId, defaultVersionLabels, refreshVersions])

  // Keep refs in sync with callbacks (avoids dependencies in CodeMirror effect)
  useEffect(() => {
    createVersionSnapshotRef.current = createVersionSnapshot
  }, [createVersionSnapshot])

  useEffect(() => {
    debouncedSaveContentRef.current = debouncedSaveContent
  }, [debouncedSaveContent])

  // Highlight handlers
  const handleApplyHighlight = useCallback((color?: HighlightColor) => {
    const view = editorViewRef.current
    if (!view) return

    const { from, to } = view.state.selection.main
    if (from === to) return // No selection

    const colorToUse = color || highlightColor

    // Generate ID upfront, add to both CodeMirror and state
    const id = nanoid()
    view.dispatch({
      effects: addHighlight.of({ from, to, color: colorToUse, id }),
      selection: { anchor: to }
    })

    setHighlights(prev => [...prev, {
      id,
      fileIndex: activeFileIndex,
      from,
      to,
      color: colorToUse,
      createdAt: Date.now(),
      authorId: currentAuthorId
    }])
  }, [activeFileIndex, highlightColor, currentAuthorId])

  // Handle highlight button click
  const handleHighlightButtonClick = useCallback(() => {
    const view = editorViewRef.current
    if (!view) return

    const { from, to } = view.state.selection.main
    if (from !== to) {
      // Text is selected - highlight it immediately
      handleApplyHighlight()
    } else {
      // No selection - toggle highlighter mode
      setHighlighterMode(prev => !prev)
    }
  }, [handleApplyHighlight])

  // Refs for highlighter mode and highlights (so event handlers can access current state)
  const highlighterModeRef = useRef(highlighterMode)
  const highlightColorRef = useRef(highlightColor)
  const highlightsRef = useRef(highlights)
  const displayHighlightsRef = useRef(displayHighlights)

  // Keep refs in sync
  useEffect(() => {
    highlighterModeRef.current = highlighterMode
  }, [highlighterMode])

  useEffect(() => {
    highlightColorRef.current = highlightColor
  }, [highlightColor])

  // Use layoutEffect to sync ref BEFORE other effects run
  // This prevents race condition where editor effect reads stale ref
  useLayoutEffect(() => {
    highlightsRef.current = highlights
  }, [highlights])

  // Keep display highlights ref in sync
  useLayoutEffect(() => {
    displayHighlightsRef.current = displayHighlights
  }, [displayHighlights])

  // Long press state for color picker
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const colorPickerRef = useRef<HTMLDivElement>(null)

  const handleHighlightButtonMouseDown = useCallback(() => {
    longPressTimerRef.current = setTimeout(() => {
      setShowColorPicker(true)
    }, 500) // 500ms for long press
  }, [])

  const handleHighlightButtonMouseUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const handleHighlightButtonMouseLeave = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  // Close color picker when clicking outside
  useEffect(() => {
    if (!showColorPicker) return

    const handleClickOutside = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showColorPicker])

  // Auto-highlight on mouseup when in highlighter mode
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const handleMouseUp = () => {
      if (!highlighterModeRef.current) return

      const view = editorViewRef.current
      if (!view) return

      const { from, to } = view.state.selection.main
      if (from === to) return // No selection

      // Generate ID upfront, add to both CodeMirror and state
      const id = nanoid()
      view.dispatch({
        effects: addHighlight.of({ from, to, color: highlightColorRef.current, id }),
        selection: { anchor: to }
      })

      setHighlights(prev => [...prev, {
        id,
        fileIndex: activeFileIndex,
        from,
        to,
        color: highlightColorRef.current,
        createdAt: Date.now(),
        authorId: currentAuthorId
      }])
    }

    editor.addEventListener('mouseup', handleMouseUp)
    return () => editor.removeEventListener('mouseup', handleMouseUp)
  }, [activeFileIndex, currentAuthorId])

  // Handle delete highlight - only delete your own highlights
  const handleDeleteHighlight = useCallback((highlightId: string) => {
    const view = editorViewRef.current
    if (!view) return

    // Check ownership before deleting
    const highlight = highlights.find(h => h.id === highlightId)
    if (highlight?.authorId !== currentAuthorId) return

    view.dispatch({
      effects: removeHighlight.of(highlightId)
    })

    // Update state - removes highlight and all its comments
    setHighlights(prev => prev.filter(h => h.id !== highlightId))
    setHoveredHighlightId(null)
    setDeleteButtonPosition(null)
  }, [highlights, currentAuthorId])

  // Handle open comment popover
  const handleOpenComment = useCallback((highlightId: string) => {
    const highlight = highlights.find(h => h.id === highlightId)
    // Find YOUR comment (matching authorId, or undefined in local mode)
    const myComment = highlight?.comments?.find(c => c.authorId === currentAuthorId)
    setCommentDraft(myComment?.text || '')
    setEditingCommentId(myComment?.id || null)
    setCommentingHighlightId(highlightId)
    // Position popover below the action buttons
    if (deleteButtonPosition) {
      setCommentPopoverPosition({
        x: deleteButtonPosition.x - 100,
        y: deleteButtonPosition.y + 28
      })
    }
    // Focus input after render
    setTimeout(() => commentInputRef.current?.focus(), 50)
  }, [highlights, deleteButtonPosition, currentAuthorId])

  // Handle save comment
  const handleSaveComment = useCallback(() => {
    if (!commentingHighlightId) return
    const trimmedText = commentDraft.trim()

    setHighlights(prev => prev.map(h => {
      if (h.id !== commentingHighlightId) return h

      const existingComments = h.comments || []
      const myCommentIndex = existingComments.findIndex(c => c.authorId === currentAuthorId)

      if (!trimmedText) {
        // Delete my comment if empty
        if (myCommentIndex >= 0) {
          return { ...h, comments: existingComments.filter((_, i) => i !== myCommentIndex) }
        }
        return h
      }

      if (myCommentIndex >= 0) {
        // Update my existing comment
        return {
          ...h,
          comments: existingComments.map((c, i) =>
            i === myCommentIndex ? { ...c, text: trimmedText } : c
          )
        }
      } else {
        // Add new comment
        const newComment: HighlightComment = {
          id: nanoid(),
          text: trimmedText,
          authorId: currentAuthorId,
          createdAt: Date.now()
        }
        return { ...h, comments: [...existingComments, newComment] }
      }
    }))

    setCommentingHighlightId(null)
    setEditingCommentId(null)
    setCommentPopoverPosition(null)
    setCommentDraft('')
  }, [commentingHighlightId, commentDraft, currentAuthorId])

  // Handle cancel comment
  const handleCancelComment = useCallback(() => {
    setCommentingHighlightId(null)
    setEditingCommentId(null)
    setCommentPopoverPosition(null)
    setCommentDraft('')
  }, [])

  // Close comment popover on click outside
  useEffect(() => {
    if (!commentingHighlightId) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Check if click is inside the popover
      if (target.closest('.fixed.z-\\[10000\\]')) return
      handleCancelComment()
    }

    // Delay adding listener to avoid immediate trigger
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 100)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [commentingHighlightId, handleCancelComment])

  // Track hover over highlight spans for delete button
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement

      // Check if we're over a highlight span
      const highlightSpan = target.closest('[data-highlight-id]') as HTMLElement | null

      if (highlightSpan) {
        const highlightId = highlightSpan.getAttribute('data-highlight-id')
        if (highlightId && highlightId !== hoveredHighlightId) {
          setHoveredHighlightId(highlightId)

          // Find all spans with the same highlight ID
          // Note: CodeMirror can fragment spans when other decorations (like bracket matching) are applied
          const allSpans = editor.querySelectorAll(`[data-highlight-id="${highlightId}"]`)
          if (allSpans.length > 0) {
            // Get bounding rects of all spans
            const rects = Array.from(allSpans).map(span => span.getBoundingClientRect())

            // Find the minimum top (first line)
            const minTop = Math.min(...rects.map(r => r.top))

            // Find spans on the first line (within 5px tolerance for line height variations)
            const firstLineRects = rects.filter(r => Math.abs(r.top - minTop) < 5)

            // Get the rightmost point on the first line
            const maxRight = Math.max(...firstLineRects.map(r => r.right))

            // Position the delete button at top-right corner of the first line
            setDeleteButtonPosition({
              x: maxRight - 8, // Offset to center on corner
              y: minTop - 8
            })
          }
        }
      } else if (hoveredHighlightId) {
        // Check if we're over the delete button (don't hide it if hovering the button)
        const deleteBtn = (e.target as HTMLElement).closest('.highlight-actions')
        if (!deleteBtn) {
          setHoveredHighlightId(null)
          setDeleteButtonPosition(null)
        }
      }
    }

    const handleMouseLeave = () => {
      // Small delay to allow moving to delete button
      setTimeout(() => {
        const deleteBtn = document.querySelector('.highlight-actions:hover')
        if (!deleteBtn) {
          setHoveredHighlightId(null)
          setDeleteButtonPosition(null)
        }
      }, 50)
    }

    editor.addEventListener('mousemove', handleMouseMove)
    editor.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      editor.removeEventListener('mousemove', handleMouseMove)
      editor.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [hoveredHighlightId])

  // Update comment indicator positions for highlights with comments
  // Uses displayHighlights to include both student and teacher highlights
  // TIMING: Runs after CodeMirror sync effect via requestAnimationFrame to ensure
  // decorations are rendered in DOM before querying for highlight spans
  // POSITIONING: Calculates positions relative to the editor container (not viewport)
  // so indicators can be rendered inline and captured in snaps
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const updateIndicatorPositions = () => {
      // Include both student and teacher highlights with comments
      const highlightsWithComments = displayHighlights.filter(h => h.comments && h.comments.length > 0)
      const indicators: Array<{ id: string; x: number; y: number }> = []

      // Get wrapper position - indicators are rendered inside wrapperRef, not editorRef
      const wrapper = wrapperRef.current
      if (!wrapper) return
      const wrapperRect = wrapper.getBoundingClientRect()

      for (const highlight of highlightsWithComments) {
        // Find all spans for this highlight
        const allSpans = editor.querySelectorAll(`[data-highlight-id="${highlight.id}"]`)
        if (allSpans.length > 0) {
          const rects = Array.from(allSpans).map(span => span.getBoundingClientRect())
          const minTop = Math.min(...rects.map(r => r.top))
          const firstLineRects = rects.filter(r => Math.abs(r.top - minTop) < 5)
          const maxRight = Math.max(...firstLineRects.map(r => r.right))

          // Position relative to wrapper (where indicators are rendered)
          // Visual offset handled via CSS transform on the element
          indicators.push({
            id: highlight.id,
            x: maxRight - wrapperRect.left,
            y: minTop - wrapperRect.top
          })
        }
      }

      setCommentIndicators(indicators)
    }

    // Store update function in ref so it can be called from document change listener
    updateCommentIndicatorsRef.current = updateIndicatorPositions

    // Delay update to allow CodeMirror to render decorations first
    // Double RAF ensures layout is complete after font size changes
    let innerRafId: number
    const rafId = requestAnimationFrame(() => {
      innerRafId = requestAnimationFrame(() => {
        updateIndicatorPositions()
      })
    })

    const scrollContainer = editor.querySelector('.cm-scroller')
    scrollContainer?.addEventListener('scroll', updateIndicatorPositions)

    // Also update on window resize
    window.addEventListener('resize', updateIndicatorPositions)

    return () => {
      cancelAnimationFrame(rafId)
      cancelAnimationFrame(innerRafId)
      scrollContainer?.removeEventListener('scroll', updateIndicatorPositions)
      window.removeEventListener('resize', updateIndicatorPositions)
    }
  }, [displayHighlights, fontSize])

  // Sync teacher highlights to CodeMirror - wholesale replacement when teacher broadcasts
  // This is the authoritative source - just replace all teacher highlights with fresh data
  useEffect(() => {
    const view = editorViewRef.current
    if (!view) return

    const docLength = view.state.doc.length
    const teacherFileHighlights = teacherHighlightsForEditor
      .filter(h => h.fileIndex === activeFileIndex)
      .filter(h => h.from >= 0 && h.to >= 0 && h.from < docLength && h.to <= docLength && h.to > h.from)
      .map(h => ({ from: h.from, to: h.to, color: h.color, id: h.id }))

    view.dispatch({
      effects: replaceTeacherHighlights.of(teacherFileHighlights)
    })
  }, [activeFileIndex, teacherHighlightsForEditor])

  // Sync student highlights on initial load or file switch
  // Track what we've synced to avoid redundant dispatches when positions update
  const studentHighlightsSyncedRef = useRef<string>('')
  useEffect(() => {
    const view = editorViewRef.current
    if (!view) return

    const docLength = view.state.doc.length
    const studentFileHighlights = highlights
      .filter(h => h.fileIndex === activeFileIndex)
      .filter(h => h.from >= 0 && h.to >= 0 && h.from < docLength && h.to <= docLength && h.to > h.from)
      .map(h => ({ from: h.from, to: h.to, color: h.color, id: h.id, isTeacher: false }))

    // Only sync if IDs changed (not just positions) - positions are handled by CodeMirror
    const syncKey = `${activeFileIndex}:${studentFileHighlights.map(h => h.id).sort().join(',')}`
    if (studentHighlightsSyncedRef.current === syncKey) return
    studentHighlightsSyncedRef.current = syncKey

    view.dispatch({
      effects: setHighlightsEffect.of(studentFileHighlights)
    })
  }, [activeFileIndex, highlights])

  // Handle splitter dragging (vertical splitter between editor and graphics)
  const handleSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDraggingSplitter(true)
  }

  const handleSplitterTouchStart = (e: React.TouchEvent) => {
    e.preventDefault()
    setIsDraggingSplitter(true)
  }

  useEffect(() => {
    if (!isDraggingSplitter) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return

      const containerRect = containerRef.current.getBoundingClientRect()
      const newEditorWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100

      // Clamp between 5% and 95%
      setEditorWidth(Math.max(5, Math.min(95, newEditorWidth)))
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!containerRef.current || !e.touches[0]) return

      const containerRect = containerRef.current.getBoundingClientRect()
      const newEditorWidth = ((e.touches[0].clientX - containerRect.left) / containerRect.width) * 100

      // Clamp between 5% and 95%
      setEditorWidth(Math.max(5, Math.min(95, newEditorWidth)))
    }

    const handleMouseUp = () => {
      setIsDraggingSplitter(false)
    }

    const handleTouchEnd = () => {
      setIsDraggingSplitter(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)
    document.addEventListener('touchcancel', handleTouchEnd)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [isDraggingSplitter])

  // Handle horizontal splitter dragging (between main content and output panel)
  // Delta-based: capture start state on mousedown, compute cursor-delta on move.
  // Avoids the feedback loop where re-measuring wrapperRect each frame compounds
  // with page auto-scroll as the wrapper grows.
  const handleHorizontalSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    splitterDragStartRef.current = {
      startY: e.clientY,
      startEditor: editorHeight,
      startOutput: outputPanelHeight,
      zoom: getZoom(),
    }
    setIsDraggingHorizontalSplitter(true)
  }

  const handleHorizontalSplitterTouchStart = (e: React.TouchEvent) => {
    e.preventDefault()
    if (!e.touches[0]) return
    splitterDragStartRef.current = {
      startY: e.touches[0].clientY,
      startEditor: editorHeight,
      startOutput: outputPanelHeight,
      zoom: getZoom(),
    }
    setIsDraggingHorizontalSplitter(true)
  }

  useEffect(() => {
    if (!isDraggingHorizontalSplitter) return

    const applyDelta = (clientY: number) => {
      const start = splitterDragStartRef.current
      if (!start) return
      // Cursor delta is in viewport pixels; wrapper heights are logical CSS
      // pixels. Divide by the captured zoom so the bar tracks the cursor 1:1
      // visually under any ancestor `transform: scale()`.
      const delta = (clientY - start.startY) / start.zoom
      const newEditorHeight = start.startEditor + delta
      const newOutputHeight = start.startOutput - delta

      // Clamp: both ends must stay within bounds simultaneously
      if (
        newEditorHeight >= MIN_EDITOR_HEIGHT &&
        newOutputHeight >= MIN_OUTPUT_HEIGHT &&
        newOutputHeight <= MAX_OUTPUT_HEIGHT
      ) {
        setUserEditorHeight(newEditorHeight)
        setOutputPanelHeight(newOutputHeight)
      }
    }

    const handleMouseMove = (e: MouseEvent) => applyDelta(e.clientY)
    const handleTouchMove = (e: TouchEvent) => {
      if (!e.touches[0]) return
      applyDelta(e.touches[0].clientY)
    }

    const handleEnd = () => {
      splitterDragStartRef.current = null
      setIsDraggingHorizontalSplitter(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleEnd)
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleEnd)
    document.addEventListener('touchcancel', handleEnd)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleEnd)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleEnd)
      document.removeEventListener('touchcancel', handleEnd)
    }
  }, [isDraggingHorizontalSplitter])

  // Handle resize handle dragging (bottom-right corner)
  // Delta-based: avoid re-reading wrapperRect each frame. If the page auto-scrolls
  // as the wrapper grows, wrapperRect.top shifts and re-reading would compound into
  // a runaway growth loop even without cursor movement.
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    // Read logical (layout) height — clientHeight is unaffected by ancestor
    // CSS transforms, unlike getBoundingClientRect which returns visual size.
    const logicalHeight = wrapperRef.current?.clientHeight ?? (manualHeight ?? totalHeight)
    resizeDragStartRef.current = {
      startY: e.clientY,
      startHeight: logicalHeight,
      zoom: getZoom(),
    }
    setIsDraggingResize(true)
  }

  useEffect(() => {
    if (!isDraggingResize) return

    const handleMouseMove = (e: MouseEvent) => {
      const start = resizeDragStartRef.current
      if (!start) return
      // Convert viewport-pixel cursor delta into the wrapper's logical-pixel
      // space; otherwise zoom > 1 over-shoots the height by factor `zoom`.
      const deltaLogical = (e.clientY - start.startY) / start.zoom
      const newHeight = start.startHeight + deltaLogical
      setManualHeight(Math.max(MIN_EDITOR_HEIGHT, Math.min(800, newHeight)))
    }

    const handleMouseUp = () => {
      resizeDragStartRef.current = null
      setIsDraggingResize(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingResize])

  // Wait for theme to hydrate
  useEffect(() => {
    console.debug(debugTag, 'mounted')
    setMounted(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only effect, debugTag is stable
  }, [])

  // Preload runtime in background — deferred until after `window.load` and
  // an idle frame, so the multi-MB Pyodide / Skulpt downloads don't compete
  // with above-the-fold network traffic (sticky-notes, public annotations,
  // fonts, etc.) during the critical-path window. By the time the user
  // scrolls down to a code editor and clicks Run, the preload has typically
  // already finished; cold-start cost is only paid in the rare case the
  // user runs code within the first ~1s after navigation.
  useEffect(() => {
    if (language !== 'python') return
    const hasTurtle = /import\s+turtle|from\s+turtle/.test(initialCode)
    return deferUntilIdle(() => {
      if (hasTurtle) {
        preloadSkulpt().catch(() => {})
      } else {
        preloadPyodide().catch(() => {})
      }
    })
  }, [language, initialCode])

  // Load SQL database when in SQL mode — deferred via `load + idle` (same
  // reasoning as the Python preload above). `setDbStatus('loading')` still
  // fires immediately so the UI can show the right indicator; the actual
  // network fetch waits until the page is past its critical-path window.
  useEffect(() => {
    if (language !== 'sql' || !db || !mounted) return
    setDbStatus('loading')
    return deferUntilIdle(() => {
      console.debug(debugTag, 'loading database', db)
      // Dynamic import to avoid SSR issues
      import('@/lib/sql-executor.client').then(({ loadDatabase }) => {
        loadDatabase(db).then(() => {
          console.debug(debugTag, 'database ready', db)
          setDbStatus('ready')
        }).catch((error) => {
          console.debug(debugTag, 'database error', db, error.message)
          setDbStatus('idle')
          addOutput(`Failed to load database: ${error.message}`, OutputLevel.ERROR)
        })
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- debugTag is stable (derived from id prop)
  }, [language, db, mounted])

  // Poll for cross-editor database cache hits (another editor may have loaded the same DB)
  useEffect(() => {
    if (language !== 'sql' || !db || dbStatus === 'ready') return
    const interval = setInterval(() => {
      import('@/lib/sql-executor.client').then(({ isDatabaseCached }) => {
        if (isDatabaseCached(db)) {
          setDbStatus('ready')
        }
      })
    }, 2000)
    return () => clearInterval(interval)
  }, [language, db, dbStatus])

  // Display schema image in graphics pane for SQL mode (if provided)
  // Note: Schemas are now Excalidraw drawings stored with databases in the file system
  // Users create schemas via the "Create Schema" button in the file browser
  // Supports theme-aware rendering with light/dark variants
  useEffect(() => {
    const hasSchema = schemaImage || schemaImageDark
    if (language === 'sql' && mounted && canvasRef.current && hasSchema) {
      // Check if at least one schema image exists
      const testSrc = schemaImage || schemaImageDark
      const img = new Image()
      img.onload = () => {
        const canvas = canvasRef.current
        if (!canvas) return

        canvas.innerHTML = '' // Clear any existing content

        // Create light theme image (visible in light mode, hidden in dark)
        if (schemaImage) {
          const lightImg = document.createElement('img')
          lightImg.src = schemaImage
          lightImg.alt = 'Database Schema'
          lightImg.style.width = '100%'
          lightImg.style.height = 'auto'
          lightImg.style.pointerEvents = 'none'
          lightImg.draggable = false
          lightImg.className = 'sql-schema-image sql-schema-light'
          canvas.appendChild(lightImg)
        }

        // Create dark theme image (hidden in light mode, visible in dark)
        if (schemaImageDark) {
          const darkImg = document.createElement('img')
          darkImg.src = schemaImageDark
          darkImg.alt = 'Database Schema'
          darkImg.style.width = '100%'
          darkImg.style.height = 'auto'
          darkImg.style.pointerEvents = 'none'
          darkImg.draggable = false
          darkImg.className = 'sql-schema-image sql-schema-dark'
          canvas.appendChild(darkImg)
        }

        // Make the graphics pane visible (only set width on first show)
        setCanvasVisible(prev => {
          if (!prev) {
            // First time showing canvas - set 50/50 split
            setEditorWidth(50)
          }
          return true
        })
      }

      img.onerror = () => {
        // Schema image doesn't exist, hide graphics pane
        setCanvasVisible(false)
      }

      img.src = testSrc!
    }
  }, [language, schemaImage, schemaImageDark, mounted])

  /**
   * Mark the pyodide kernel as active and spawn the worker if needed. The
   * worker loads Pyodide lazily on its first message — the first run / check
   * pays the cold-start cost (~3 s), subsequent calls are fast.
   */
  const ensurePyodideLoaded = () => {
    setActiveKernel('pyodide')
    warmPyodideWorker()
  }

  // Lazy load Skulpt on first run
  const ensureSkulptLoaded = async () => {
    // Check if already loaded
    if (window.Sk) {
      setActiveKernel('skulpt')
      return
    }

    // Global promise cache to prevent loading scripts multiple times
    const scriptPromises = (window as any).__skulptPromises || {}
    if (!(window as any).__skulptPromises) {
      (window as any).__skulptPromises = scriptPromises
    }

    const loadScript = (src: string): Promise<void> => {
      // Return existing promise if already loading/loaded
      if (scriptPromises[src]) {
        return scriptPromises[src]
      }

      // Create new loading promise
      scriptPromises[src] = new Promise<void>((resolve, reject) => {
        // Check if script already exists in DOM
        const existing = document.querySelector(`script[src="${src}"]`)
        if (existing) {
          // Script tag exists, assume it's loaded (or will be)
          setTimeout(() => resolve(), 10)
          return
        }

        const script = document.createElement('script')
        script.src = src
        script.onload = () => resolve()
        script.onerror = () => {
          delete scriptPromises[src] // Allow retry on error
          reject(new Error(`Failed to load ${src}`))
        }
        document.body.appendChild(script)
      })

      return scriptPromises[src]
    }

    setKernelLoading(true)

    try {
      await loadScript('/js/skulpt.min.js')
      await loadScript('/js/skulpt-stdlib.js')
      setActiveKernel('skulpt')
      setKernelLoading(false)
    } catch (error) {
      setKernelLoading(false)
      addOutput('Failed to load Python runtime', OutputLevel.ERROR)
      throw error
    }
  }

  // Initialize CodeMirror editor.
  // IMPORTANT: This effect only runs when language or activeFileIndex changes (true recreation needed).
  // Theme, fontSize, and lineWrapping are reconfigured via Compartments in separate effects below,
  // which avoids destroying/recreating the editor and losing cursor position + focus.
  // `files` is read via ref to avoid the destructive feedback loop where debounced save → files state
  // change → editor recreation → cursor/focus loss.
  const filesRef = useRef(files)
  useLayoutEffect(() => { filesRef.current = files }, [files])
  const activeFileIndexRef = useRef(activeFileIndex)
  useLayoutEffect(() => { activeFileIndexRef.current = activeFileIndex }, [activeFileIndex])

  // Apply a CodeEditorData snapshot to the editor's UI state. Mirrors the
  // restore-on-click handler in the History tab; also used by the orphan-
  // preview flow to load a single orphan version's content into the live
  // editor without writing it back to the orphan's componentId.
  const applyDataToEditor = useCallback((data: CodeEditorData) => {
    if (data.files) {
      setFiles(data.files)
      filesRef.current = data.files
      const view = editorViewRef.current
      const fileIdx = data.activeFileIndex ?? activeFileIndex
      if (view && data.files[fileIdx]) {
        view.dispatch(view.state.update({
          changes: { from: 0, to: view.state.doc.length, insert: data.files[fileIdx].content },
          annotations: programmaticChange.of(true),
        }))
      }
    }
    if (data.activeFileIndex !== undefined) setActiveFileIndex(data.activeFileIndex)
    if (data.fontSize !== undefined) setFontSize(data.fontSize)
    if (data.lineWrapping !== undefined) setLineWrapping(data.lineWrapping)
    if (data.editorWidth !== undefined) setEditorWidth(data.editorWidth)
    if (data.canvasTransform) setCanvasTransform(data.canvasTransform)
  }, [activeFileIndex])

  // Hydrate the editor from the student's checkpoint payload whenever the
  // viewed student or their latest snapshot changes. Track what we last
  // applied so reusing the snapshot reference (e.g. on re-render) doesn't
  // re-dispatch a no-op transaction. Skip if there's no snapshot yet for
  // this componentId — that just means this student hasn't touched this
  // editor; we leave the previous content visible until they do.
  const lastAppliedSnapshotRef = useRef<{ componentId: string; createdAt: string } | null>(null)
  useEffect(() => {
    if (!isViewingSnapshot) {
      lastAppliedSnapshotRef.current = null
      return
    }
    if (!studentSnapshot) return
    const fingerprint = { componentId: studentSnapshot.componentId, createdAt: studentSnapshot.createdAt }
    const prev = lastAppliedSnapshotRef.current
    if (prev && prev.componentId === fingerprint.componentId && prev.createdAt === fingerprint.createdAt) {
      return
    }
    lastAppliedSnapshotRef.current = fingerprint
    const payload = studentSnapshot.payload as CodeEditorData | null
    if (payload && typeof payload === 'object') {
      applyDataToEditor(payload)
    }
  }, [isViewingSnapshot, studentSnapshot, applyDataToEditor])

  // Full snapshot history for the viewed student + this component (the dropdown
  // beneath the editor). Fetched on demand in snapshot-view mode. Picking an
  // entry applies its payload via applyDataToEditor — scratch only, no save.
  const [snapList, setSnapList] = useState<Array<{ id: number; kind: string; label: string | null; createdAt: string; payload: unknown }>>([])
  const [viewedSnapshotId, setViewedSnapshotId] = useState<number | null>(null)
  // True when the teacher has typed into the editor since loading a snapshot —
  // drives the Revert button. Applying a snapshot is a programmatic change, so
  // it doesn't trip this (only real keystrokes do; see the updateListener).
  const [editedSinceSnapshot, setEditedSinceSnapshot] = useState(false)
  // Ref so the (once-created) editor updateListener reads the live value.
  const isViewingSnapshotRef = useRef(isViewingSnapshot)
  useEffect(() => { isViewingSnapshotRef.current = isViewingSnapshot }, [isViewingSnapshot])
  useEffect(() => {
    if (!isViewingSnapshot || !pageId || !selectedStudent?.id) return
    let cancelled = false
    fetch(`/api/exams/${pageId}/component-snapshots?studentId=${encodeURIComponent(selectedStudent.id)}&componentId=${encodeURIComponent(componentId)}`)
      .then((r) => (r.ok ? r.json() : { snapshots: [] }))
      .then((j) => { if (!cancelled) { setSnapList(j.snapshots ?? []); setViewedSnapshotId(null); setEditedSinceSnapshot(false) } })
      .catch(() => { if (!cancelled) setSnapList([]) })
    return () => { cancelled = true }
  }, [isViewingSnapshot, pageId, selectedStudent?.id, componentId])

  // Load a snapshot into the editor (scratch view — never writes the snapshot).
  const viewSnapshot = useCallback((snap: { id: number; payload: unknown }) => {
    setViewedSnapshotId(snap.id)
    setEditedSinceSnapshot(false)
    if (snap.payload && typeof snap.payload === 'object') applyDataToEditor(snap.payload as CodeEditorData)
  }, [applyDataToEditor])

  // Revert the editor to the currently-viewed snapshot (or the latest), discarding
  // the teacher's scratch edits. Reads only — nothing about the snapshot changes.
  const revertSnapshot = useCallback(() => {
    const chosen = snapList.find((s) => s.id === viewedSnapshotId)
    const payload = (chosen?.payload ?? studentSnapshot?.payload) as CodeEditorData | null
    if (payload && typeof payload === 'object') applyDataToEditor(payload)
    setEditedSinceSnapshot(false)
  }, [snapList, viewedSnapshotId, studentSnapshot, applyDataToEditor])

  // When the teacher exits view mode (clears selectedStudent), restore their
  // own IndexedDB-loaded state so the editor doesn't keep showing the last
  // student's code. Falls back to a no-op when savedData is empty (teacher
  // never had data on this page).
  const wasViewingRef = useRef(isViewingSnapshot)
  useEffect(() => {
    const wasViewing = wasViewingRef.current
    wasViewingRef.current = isViewingSnapshot
    if (!wasViewing || isViewingSnapshot) return
    if (savedData) {
      applyDataToEditor(savedData)
    }
  }, [isViewingSnapshot, savedData, applyDataToEditor])

  // Preview an orphan version: snapshot current editor state ONCE (per
  // editor instance) as a safety autosave, then load the orphan's content
  // into the editor. Does not move the orphan version's componentId — the
  // bulk move is the row-level "Restore to this editor" button.
  const previewOrphanVersion = useCallback(async (versionId: number) => {
    if (!safetyAutosaveDoneRef.current) {
      const currentData: CodeEditorData = {
        files: filesRef.current,
        activeFileIndex,
        fontSize,
        lineWrapping,
        editorWidth,
        canvasTransform,
      }
      try {
        await createVersion(currentData, {
          kind: 'auto',
          label: 'before previewing orphan',
        })
        safetyAutosaveDoneRef.current = true
      } catch (e) {
        console.error('Autosave before orphan preview failed:', e)
      }
    }
    const data = await userDataService.getVersionPayload<CodeEditorData>(versionId)
    if (!data) return
    applyDataToEditor(data)
    await refreshVersions()
  }, [activeFileIndex, fontSize, lineWrapping, editorWidth, canvasTransform, createVersion, applyDataToEditor, refreshVersions])
  const activeTabRef = useRef(activeTab)
  useLayoutEffect(() => { activeTabRef.current = activeTab }, [activeTab])
  const skriptImportsRef = useRef(skriptImports)
  useLayoutEffect(() => { skriptImportsRef.current = skriptImports }, [skriptImports])
  const globalImportsRef = useRef(globalImports)
  useLayoutEffect(() => { globalImportsRef.current = globalImports }, [globalImports])
  const editorBinariesRef = useRef(editorBinaries)
  useLayoutEffect(() => { editorBinariesRef.current = editorBinaries }, [editorBinaries])
  const skriptBinariesRef = useRef(skriptBinaries)
  useLayoutEffect(() => { skriptBinariesRef.current = skriptBinaries }, [skriptBinaries])
  const globalBinariesRef = useRef(globalBinaries)
  useLayoutEffect(() => { globalBinariesRef.current = globalBinaries }, [globalBinaries])
  const attachedFilesRef = useRef(attachedFiles)
  useLayoutEffect(() => { attachedFilesRef.current = attachedFiles }, [attachedFiles])

  // Cache for teacher-attached file bytes keyed by URL. Avoids re-fetching the
  // same file on every Run click. Lives across runs of this editor instance.
  const attachedFileBytesRef = useRef<Map<string, Uint8Array>>(new Map())

  // When imports change externally, close any open tabs for files that no longer exist
  useEffect(() => {
    if (!isPython) return
    setOpenImports(prev => {
      const filtered = prev.filter(tab => {
        const store = tab.scope === 'skript' ? skriptImports : globalImports
        return store.files.some(f => f.name === tab.name)
      })
      if (filtered.length === prev.length) return prev
      return filtered
    })
    // If the active tab is an import that was deleted, switch to local file 0
    if (activeTab.type === 'import') {
      const store = activeTab.scope === 'skript' ? skriptImports : globalImports
      if (!store.files.some(f => f.name === activeTab.name)) {
        setActiveTab({ type: 'local', index: 0 })
      }
    }
  }, [isPython, skriptImports, globalImports]) // eslint-disable-line react-hooks/exhaustive-deps -- activeTab read is intentional

  useEffect(() => {
    // Wait for saved data to load before creating the editor so we can
    // use the restored content instead of the default initialCode.
    if (!editorRef.current || !mounted || isLoading) return

    const isDark = resolvedTheme === 'dark'

    // Select language extension
    const langExtension = language === 'python'
      ? python()
      : language === 'sql'
      ? sql()
      : javascript()

    const extensions = [
      basicSetup,
      keymap.of([
        indentWithTab, // Enable Tab/Shift+Tab for indentation
        { key: 'Mod-z', run: undo }, // Enable Ctrl+Z (Cmd+Z on Mac) for undo
      ]),
      langExtension,
      // Python convention: 4-space indentation; 2 spaces for JS/SQL
      indentUnit.of(language === 'python' ? '    ' : '  '),
      EditorState.tabSize.of(language === 'python' ? 4 : 2),
      EditorView.theme({
        '&': {
          height: '100%',
          width: '100%'
        },
        '.cm-scroller': {
          overflow: 'auto'
        },
        // Extra bottom padding so the floating Run/Stop button doesn't obscure code
        '.cm-content': {
          paddingBottom: '2.5rem'
        },
      }),
      // Dynamic compartments — reconfigured without destroying the editor.
      // Scaling the gutters alongside the content keeps line numbers sized and
      // line-height-aligned with the code when the user zooms the editor.
      fontSizeCompartment.current.of(EditorView.theme({
        '.cm-content': { fontSize: `${fontSize}px` },
        '.cm-gutters': { fontSize: `${fontSize}px` }
      })),
      themeCompartment.current.of(isDark ? vsCodeDark : vsCodeLight),
      lineWrappingCompartment.current.of(lineWrapping ? EditorView.lineWrapping : []),
      // Always editable. In snapshot-view mode the teacher MAY tweak + run the
      // student's code to test something — those edits are scratch-only (all
      // save/checkpoint paths are gated on isViewingSnapshot, and switching
      // snapshot/student re-applies the stored payload, discarding the tweak).
      readOnlyCompartment.current.of([]),
    ]

    // Add Python autocomplete for Python files
    if (language === 'python') {
      // Reads other local files + import files from refs (avoids stale closures)
      const completions = createPythonCompletions(() => {
        const toSource = (f: { name: string, content: string }) => ({
          name: f.name.replace(/\.py$/i, ''),
          content: f.content
        })
        const otherFiles = filesRef.current
          .filter((_, i) => i !== activeFileIndexRef.current)
          .map(toSource)
        const skriptFiles = (skriptImportsRef.current?.files || []).map(toSource)
        const globalFiles = (globalImportsRef.current?.files || []).map(toSource)
        return [...otherFiles, ...skriptFiles, ...globalFiles]
      })
      extensions.push(
        autocompletion({
          override: [completions],
          activateOnTyping: true,
          maxRenderedOptions: 20,
          // Trigger completion on dot for attribute access
          activateOnCompletion: (completion) => /^[a-zA-Z_]/.test(completion.label),
        })
      )
    }

    // Add code highlighting extension
    extensions.push(...codeHighlighting())

    // Sync highlight positions back to React state when document changes
    // IMPORTANT: Only update positions for STUDENT highlights, not teacher highlights.
    // Teacher highlights are in CodeMirror but managed separately via teacherHighlightsForEditor.
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged && update.state.field(highlightField).size > 0) {
          // Extract current positions from CodeMirror decorations
          const extracted = extractHighlights(update.view, activeFileIndexRef.current)
          // Only update positions for highlights that already exist in student state
          // Don't add new ones - those are teacher highlights that should stay separate
          setHighlights(prev => {
            const extractedMap = new Map(extracted.map(h => [h.id, h]))
            // Update positions for existing student highlights only
            const updated = prev.map(h => {
              const extracted = extractedMap.get(h.id)
              if (extracted) {
                return { ...h, from: extracted.from, to: extracted.to }
              }
              // Highlight was deleted in CodeMirror, keep in state (will be filtered out)
              return h
            }).filter(h => extractedMap.has(h.id)) // Remove deleted highlights

            // Check if anything actually changed to avoid unnecessary re-renders
            const hasChanges = updated.length !== prev.length || updated.some((h, i) => {
              return prev[i]?.from !== h.from || prev[i]?.to !== h.to
            })
            return hasChanges ? updated : prev
          })

          // Update comment indicator positions after DOM updates
          requestAnimationFrame(() => {
            updateCommentIndicatorsRef.current()
          })
        }
      })
    )

    // Add update listener for auto-save
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          // Check if any transaction is marked as programmatic
          const isProgrammatic = update.transactions.some(tr => tr.annotation(programmaticChange))

          // Only trigger save and version creation on user input (not programmatic changes)
          if (!isProgrammatic) {
            // Teacher editing a student's snapshot → mark dirty so Revert shows.
            // (Persistence is gated elsewhere; this is display-only.)
            if (isViewingSnapshotRef.current) setEditedSinceSnapshot(true)
            // Increment keystroke counter
            keystrokeCountRef.current++

            // Reset the idle timer on every keystroke. If no further keystroke
            // arrives within AUTOSAVE_IDLE_MS, fire an autosave covering the
            // edits accumulated so far.
            if (autosaveIdleTimerRef.current) {
              clearTimeout(autosaveIdleTimerRef.current)
            }
            autosaveIdleTimerRef.current = setTimeout(() => {
              autosaveIdleTimerRef.current = null
              if (keystrokeCountRef.current > 0) {
                keystrokeCountRef.current = 0
                createVersionSnapshotRef.current()
              }
            }, AUTOSAVE_IDLE_MS)

            // Burst path: hit the 100-keystroke threshold during fast typing.
            // Reset the counter SYNCHRONOUSLY before firing so additional
            // keystrokes during the (async) snapshot don't each re-trigger
            // the threshold. Without this, a fast typist gets several
            // duplicate autosaves fired off in quick succession.
            if (keystrokeCountRef.current >= 100) {
              keystrokeCountRef.current = 0
              if (autosaveIdleTimerRef.current) {
                clearTimeout(autosaveIdleTimerRef.current)
                autosaveIdleTimerRef.current = null
              }
              createVersionSnapshotRef.current()
            }

            // Clear existing timeout
            if (contentSaveTimeoutRef.current) {
              clearTimeout(contentSaveTimeoutRef.current)
            }

            // Debounce save by 300ms after typing stops
            contentSaveTimeoutRef.current = setTimeout(() => {
              debouncedSaveContentRef.current()
            }, 300)
          }
        }

      })
    )

    // Clean up previous editor
    if (editorViewRef.current) {
      editorViewRef.current.destroy()
    }

    const state = EditorState.create({
      doc: filesRef.current[activeFileIndex]?.content || initialCode,
      extensions,
    })

    const view = new EditorView({
      state,
      parent: editorRef.current,
    })

    editorViewRef.current = view
    setEditorReady(true)
    console.debug(debugTag, 'CodeMirror created')

    // Re-apply highlights after editor creation
    // Use displayHighlightsRef to include both student and teacher highlights
    const currentHighlights = displayHighlightsRef.current
    if (currentHighlights.length > 0) {
      const docLength = view.state.doc.length

      // Filter highlights for current file and validate bounds
      const fileHighlights = currentHighlights
        .filter(h => h.fileIndex === activeFileIndex)
        .filter(h => h.from >= 0 && h.to >= 0 && h.from < docLength && h.to <= docLength && h.to > h.from)
        .map(h => ({ from: h.from, to: h.to, color: h.color, id: h.id, isTeacher: h.isTeacher }))

      if (fileHighlights.length > 0) {
        // Defer dispatch to ensure view is fully initialized
        requestAnimationFrame(() => {
          if (editorViewRef.current === view) {
            view.dispatch({
              effects: setHighlightsEffect.of(fileHighlights)
            })
          }
        })
      }
    }

    return () => {
      setEditorReady(false)
      // Flush pending content to IndexedDB before destroying the editor.
      // This catches edits made in the last 2 seconds before unmount/navigation.
      if (contentSaveTimeoutRef.current) {
        clearTimeout(contentSaveTimeoutRef.current)
        contentSaveTimeoutRef.current = null
      }
      // Cancel any pending idle-autosave; if there's accumulated work, fire
      // it now so the unmount doesn't lose the last few keystrokes.
      if (autosaveIdleTimerRef.current) {
        clearTimeout(autosaveIdleTimerRef.current)
        autosaveIdleTimerRef.current = null
      }
      if (keystrokeCountRef.current > 0) {
        keystrokeCountRef.current = 0
        createVersionSnapshotRef.current()
      }
      debouncedSaveContentRef.current()

      if (editorViewRef.current) {
        editorViewRef.current.destroy()
        editorViewRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- theme/fontSize/lineWrapping use Compartments below; files/debouncedSaveContent use refs; isLoading gates creation until savedData is ready
  }, [mounted, language, initialCode, activeFileIndex, isLoading])

  // Reconfigure theme without destroying the editor
  useEffect(() => {
    const view = editorViewRef.current
    if (!view) return
    const isDark = resolvedTheme === 'dark'
    view.dispatch({
      effects: themeCompartment.current.reconfigure(isDark ? vsCodeDark : vsCodeLight)
    })
  }, [resolvedTheme])

  // Reconfigure font size without destroying the editor
  useEffect(() => {
    const view = editorViewRef.current
    if (!view) return
    view.dispatch({
      effects: fontSizeCompartment.current.reconfigure(
        EditorView.theme({
          '.cm-content': { fontSize: `${fontSize}px` },
          '.cm-gutters': { fontSize: `${fontSize}px` }
        })
      )
    })
  }, [fontSize])

  // Reconfigure line wrapping without destroying the editor
  useEffect(() => {
    const view = editorViewRef.current
    if (!view) return
    view.dispatch({
      effects: lineWrappingCompartment.current.reconfigure(
        lineWrapping ? EditorView.lineWrapping : []
      )
    })
  }, [lineWrapping])

  // Editor stays editable in all modes (incl. snapshot view — see the compartment
  // init); kept as a no-op reconfigure point in case read-only returns later.
  useEffect(() => {
    const view = editorViewRef.current
    if (!view) return
    view.dispatch({ effects: readOnlyCompartment.current.reconfigure([]) })
  }, [isViewingSnapshot])

  // Attach non-passive wheel event listener to prevent page scroll
  useEffect(() => {
    const container = canvasContainerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const newScale = Math.max(0.1, Math.min(5, canvasTransform.scale * delta))

      const rect = container.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const canvasX = (mouseX - canvasTransform.x) / canvasTransform.scale
      const canvasY = (mouseY - canvasTransform.y) / canvasTransform.scale

      const newX = mouseX - canvasX * newScale
      const newY = mouseY - canvasY * newScale

      setCanvasTransform({
        x: newX,
        y: newY,
        scale: newScale
      })
    }

    // Add listener with passive: false to allow preventDefault
    container.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [canvasTransform])

  // Prevent editor scroll from propagating to page
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    // Find the CodeMirror scroller element (the actual scrollable container)
    const scroller = editor.querySelector('.cm-scroller') as HTMLElement
    if (!scroller) return

    const handleWheel = (e: WheelEvent) => {
      // Only stop propagation if we're not at the scroll boundary
      const { scrollTop, scrollHeight, clientHeight } = scroller
      const isAtTop = scrollTop === 0 && e.deltaY < 0
      const isAtBottom = scrollTop + clientHeight >= scrollHeight && e.deltaY > 0

      // Stop propagation unless we're at a boundary and trying to scroll further
      if (!isAtTop && !isAtBottom) {
        e.stopPropagation()
      }
    }

    scroller.addEventListener('wheel', handleWheel, { passive: true })

    return () => {
      scroller.removeEventListener('wheel', handleWheel)
    }
  }, [mounted])

  // Handle output panel wheel scroll explicitly
  // CSS overscroll-behavior alone doesn't work when parent handlers use passive: false
  useEffect(() => {
    const outputPanel = outputPanelRef.current
    if (!outputPanel) return

    const handleWheel = (e: WheelEvent) => {
      const { scrollTop, scrollHeight, clientHeight } = outputPanel
      const isScrollable = scrollHeight > clientHeight

      if (!isScrollable) return // Let page scroll if content doesn't need scrolling

      // Manually scroll the output panel
      outputPanel.scrollTop += e.deltaY

      // Prevent page scroll when output is scrollable
      e.preventDefault()
      e.stopPropagation()
    }

    outputPanel.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      outputPanel.removeEventListener('wheel', handleWheel)
    }
  }, [output.length, activePanel]) // Re-attach when output changes or panel switches

  // Auto-scroll output panel when input prompt appears
  useEffect(() => {
    if (pendingInput && outputPanelRef.current) {
      outputPanelRef.current.scrollTop = outputPanelRef.current.scrollHeight
    }
  }, [pendingInput])

  // Add output helper
  const addOutput = (message: string, level: OutputLevel = OutputLevel.OUTPUT) => {
    setOutput((prev) => [...prev, { message, level, timestamp: Date.now() }])
    setPanelVisible(true)
    setActivePanel('output')
  }

  // Save current file/import content from editor
  const saveCurrentFile = () => {
    if (!editorViewRef.current) return
    const content = editorViewRef.current.state.doc.toString()

    if (activeTab.type === 'local') {
      // Update both ref and state so downstream reads always see the latest
      filesRef.current = filesRef.current.map((file, idx) =>
        idx === activeTab.index ? { ...file, content } : file
      )
      setFiles(filesRef.current)
    } else if (activeTab.type === 'import') {
      const { scope, name } = activeTab
      // Read from refs (not state) to get the latest content including unsaved typing
      const store = scope === 'skript' ? skriptImportsRef.current : globalImportsRef.current
      const updater = scope === 'skript' ? saveSkriptImports : saveGlobalImports
      if (store) {
        const updatedFiles = store.files.map(f => f.name === name ? { ...f, content } : f)
        updater({ files: updatedFiles })
      }
    }
  }

  // Switch to a local file tab
  const switchToFile = (index: number) => {
    saveCurrentFile()
    setActiveFileIndex(index)
    setActiveTab({ type: 'local', index })
  }

  // Switch to an import tab
  const switchToImport = (scope: 'skript' | 'global', name: string) => {
    saveCurrentFile()
    setActiveTab({ type: 'import', scope, name })
    // Ensure this import is in openImports
    setOpenImports(prev => {
      if (prev.some(i => i.scope === scope && i.name === name)) return prev
      return [...prev, { name, scope }]
    })
  }

  // Get the content for the currently active tab
  const getActiveContent = (): string => {
    if (activeTab.type === 'local') {
      return files[activeTab.index]?.content || initialCode
    }
    const store = activeTab.scope === 'skript' ? skriptImports : globalImports
    return store?.files.find(f => f.name === activeTab.name)?.content || ''
  }

  // Add a new file
  const addNewFile = () => {
    const fileNumber = files.length + 1
    const ext = getFileExtension(language)
    const newFile: PythonFile = {
      name: `file${fileNumber}${ext}`,
      content: language === 'sql' ? '-- New file\n' : '# New file\n'
    }
    setFiles(prev => [...prev, newFile])
    setActiveFileIndex(files.length)
    setActiveTab({ type: 'local', index: files.length })
  }

  // Remove a file
  const removeFile = (index: number) => {
    if (files.length === 1) {
      addOutput('Cannot remove the last file', OutputLevel.WARNING)
      return
    }
    setFiles(prev => prev.filter((_, idx) => idx !== index))
    if (activeFileIndex >= index && activeFileIndex > 0) {
      setActiveFileIndex(prev => prev - 1)
    }
    // If removing the active local tab, switch back
    if (activeTab.type === 'local' && activeTab.index >= index && activeTab.index > 0) {
      setActiveTab({ type: 'local', index: activeTab.index - 1 })
    }
  }

  // Move a local file to imports
  const makeImport = (fileIndex: number, scope: 'skript' | 'global') => {
    const file = files[fileIndex]
    if (!file) return
    const store = scope === 'skript' ? skriptImports : globalImports
    const updater = scope === 'skript' ? saveSkriptImports : saveGlobalImports
    if (!store) return

    // Check for duplicate name in target scope
    if (store.files.some(f => f.name === file.name)) {
      addOutput(`A file named "${file.name}" already exists in ${scope === 'skript' ? 'Skript' : 'Global'} scope`, OutputLevel.WARNING)
      return
    }

    // Add to import store
    updater({ files: [...store.files, { name: file.name, content: file.content }] })
    // Remove from local files
    setFiles(prev => prev.filter((_, idx) => idx !== fileIndex))
    // Open as import tab
    setOpenImports(prev => [...prev, { name: file.name, scope }])
    setActiveTab({ type: 'import', scope, name: file.name })
    if (activeFileIndex >= fileIndex && activeFileIndex > 0) {
      setActiveFileIndex(prev => prev - 1)
    }
  }

  // Close an import tab (just removes from view, doesn't delete the file)
  const closeImportTab = (scope: 'skript' | 'global', name: string) => {
    // Save editor content before closing if this is the active tab
    if (activeTab.type === 'import' && activeTab.scope === scope && activeTab.name === name) {
      saveCurrentFile()
      setActiveTab({ type: 'local', index: 0 })
      setActiveFileIndex(0)
    }
    setOpenImports(prev => prev.filter(i => !(i.scope === scope && i.name === name)))
  }

  // Delete an import file entirely
  const deleteImportFile = (scope: 'skript' | 'global', name: string) => {
    const store = scope === 'skript' ? skriptImports : globalImports
    const updater = scope === 'skript' ? saveSkriptImports : saveGlobalImports
    if (!store) return
    updater({ files: store.files.filter(f => f.name !== name) })
    closeImportTab(scope, name)
  }

  // Create a new import file
  const createImportFile = (scope: 'skript' | 'global') => {
    const store = scope === 'skript' ? skriptImports : globalImports
    const updater = scope === 'skript' ? saveSkriptImports : saveGlobalImports
    if (!store) return

    const existing = store.files.map(f => f.name)
    let num = 1
    let name = `helpers.py`
    while (existing.includes(name)) {
      num++
      name = `helpers${num}.py`
    }
    updater({ files: [...store.files, { name, content: '# Shared import file\n' }] })
    setOpenImports(prev => [...prev, { name, scope }])
    setActiveTab({ type: 'import', scope, name })
  }

  // Move import between scopes (drag-and-drop in dropdown)
  const moveImportScope = (name: string, fromScope: 'skript' | 'global', toScope: 'skript' | 'global') => {
    if (fromScope === toScope) return
    // Read from refs (not state) to get the latest content including unsaved typing
    const fromStore = fromScope === 'skript' ? skriptImportsRef.current : globalImportsRef.current
    const toStore = toScope === 'skript' ? skriptImportsRef.current : globalImportsRef.current
    const fromUpdater = fromScope === 'skript' ? saveSkriptImports : saveGlobalImports
    const toUpdater = toScope === 'skript' ? saveSkriptImports : saveGlobalImports
    if (!fromStore || !toStore) return

    let file = fromStore.files.find(f => f.name === name)
    if (!file) return
    // If this file is currently open in the editor, grab the live content from CodeMirror
    if (editorViewRef.current && activeTab.type === 'import' && activeTab.scope === fromScope && activeTab.name === name) {
      file = { ...file, content: editorViewRef.current.state.doc.toString() }
    }
    if (toStore.files.some(f => f.name === name)) {
      addOutput(`A file named "${name}" already exists in ${toScope === 'skript' ? 'Skript' : 'Global'} scope`, OutputLevel.WARNING)
      return
    }

    fromUpdater({ files: fromStore.files.filter(f => f.name !== name) })
    toUpdater({ files: [...toStore.files, file] })
    // Update openImports to reflect new scope
    setOpenImports(prev => prev.map(i =>
      i.scope === fromScope && i.name === name ? { ...i, scope: toScope } : i
    ))
    if (activeTab.type === 'import' && activeTab.scope === fromScope && activeTab.name === name) {
      setActiveTab({ type: 'import', scope: toScope, name })
    }
  }

  // Rename an import file
  const renameImportFile = (scope: 'skript' | 'global', oldName: string) => {
    if (!renameValue.trim()) {
      setRenamingImport(null)
      return
    }

    const ext = getFileExtension(language)
    const newName = renameValue.trim().endsWith(ext)
      ? renameValue.trim()
      : renameValue.trim() + ext

    if (newName === oldName) {
      setRenamingImport(null)
      return
    }

    const store = scope === 'skript' ? skriptImports : globalImports
    const updater = scope === 'skript' ? saveSkriptImports : saveGlobalImports
    if (!store) { setRenamingImport(null); return }

    // Check for duplicate names within the same scope
    if (store.files.some(f => f.name !== oldName && f.name === newName)) {
      addOutput('A file with that name already exists', OutputLevel.WARNING)
      return
    }

    updater({ files: store.files.map(f => f.name === oldName ? { ...f, name: newName } : f) })
    setOpenImports(prev => prev.map(i =>
      i.scope === scope && i.name === oldName ? { ...i, name: newName } : i
    ))
    if (activeTab.type === 'import' && activeTab.scope === scope && activeTab.name === oldName) {
      setActiveTab({ type: 'import', scope, name: newName })
    }
    setRenamingImport(null)
  }

  // Start renaming an import file
  const startImportRename = (scope: 'skript' | 'global', name: string) => {
    setRenamingImport({ scope, name })
    const ext = getFileExtension(language)
    const extPattern = new RegExp(`\\${ext}$`)
    setRenameValue(name.replace(extPattern, ''))
  }

  // Move an import file back to local files
  const makeLocal = (scope: 'skript' | 'global', name: string) => {
    const store = scope === 'skript' ? skriptImports : globalImports
    const updater = scope === 'skript' ? saveSkriptImports : saveGlobalImports
    if (!store) return

    let file = store.files.find(f => f.name === name)
    if (!file) return

    // If this file is currently open in the editor, grab the live content
    if (editorViewRef.current && activeTab.type === 'import' && activeTab.scope === scope && activeTab.name === name) {
      file = { ...file, content: editorViewRef.current.state.doc.toString() }
    }

    // Check for duplicate name in local files
    if (files.some(f => f.name === file!.name)) {
      addOutput(`A file named "${file.name}" already exists in local files`, OutputLevel.WARNING)
      return
    }

    // Remove from import store
    updater({ files: store.files.filter(f => f.name !== name) })
    // Remove the import tab without saving back (closeImportTab would re-save)
    setOpenImports(prev => prev.filter(i => !(i.scope === scope && i.name === name)))
    // Add to local files
    setFiles(prev => [...prev, { name: file!.name, content: file!.content }])
    // Switch to the newly added local file
    setActiveTab({ type: 'local', index: files.length })
    setActiveFileIndex(files.length)
  }

  // Start renaming a file
  const startRename = (index: number) => {
    setRenamingIndex(index)
    const ext = getFileExtension(language)
    const extPattern = new RegExp(`\\${ext}$`)
    setRenameValue(files[index].name.replace(extPattern, ''))
  }

  // Confirm rename
  const confirmRename = (index: number) => {
    if (!renameValue.trim()) {
      setRenamingIndex(null)
      return
    }

    const ext = getFileExtension(language)
    const newName = renameValue.trim().endsWith(ext)
      ? renameValue.trim()
      : renameValue.trim() + ext

    // Check for duplicate names
    if (files.some((f, idx) => idx !== index && f.name === newName)) {
      addOutput('A file with that name already exists', OutputLevel.WARNING)
      return
    }

    setFiles(prev => prev.map((file, idx) =>
      idx === index ? { ...file, name: newName } : file
    ))
    setRenamingIndex(null)
  }

  // Cancel rename
  const cancelRename = () => {
    setRenamingIndex(null)
    setRenameValue('')
  }

  // Font size controls
  const increaseFontSize = () => {
    setFontSize(prev => Math.min(prev + 2, 32)) // Max 32px
  }

  const decreaseFontSize = () => {
    setFontSize(prev => Math.max(prev - 2, 8)) // Min 8px
  }

  // Update editor when active tab changes (local file or import)
  // Also fires when skriptImports/globalImports change (cross-editor sync),
  // but skips the dispatch if the document content hasn't actually changed.
  useEffect(() => {
    if (!editorViewRef.current) return
    const content = activeTab.type === 'local'
      ? (files[activeFileIndex]?.content || '')
      : ((activeTab.scope === 'skript' ? skriptImports : globalImports)?.files.find(f => f.name === activeTab.name)?.content || '')
    const view = editorViewRef.current
    // Skip if content matches — avoids cursor disruption on unrelated import changes
    if (view.state.doc.toString() === content) return
    const transaction = view.state.update({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: content
      },
      annotations: programmaticChange.of(true)
    })
    view.dispatch(transaction)
  }, [activeFileIndex, activeTab, files, skriptImports, globalImports])

  // Run code
  const runCode = () => {
    if (!editorViewRef.current) return

    // Save current file before running
    saveCurrentFile()

    // Snapshot + checkpoint the Run press. Fire-and-forget; service-layer
    // dedup collapses identical consecutive runs into a single row/POST.
    // In an exam WITH a python-check, the silent check after execution makes
    // its own checkpoint (same code + the score), so skip this redundant run
    // snapshot to avoid double-storing per Run press. Editors without checks
    // and practice mode still snapshot here (their only capture).
    if (!(exam && hasChecks)) void createRunVersion()

    const code = editorViewRef.current.state.doc.toString()

    if (language === 'python') {
      // Decide which runtime to use based on current editor content (not saved state)
      // This allows switching between Skulpt and Pyodide when code changes
      const hasTurtle = /import\s+turtle|from\s+turtle/.test(code)
      const hasInput = /\binput\s*\(/.test(code)

      if (hasTurtle || hasInput) {
        runPythonCode(code) // Use Skulpt for turtle and input() (native async suspension)
      } else {
        runPyodideCode(code) // Use Pyodide for everything else (including matplotlib)
      }
    } else if (language === 'sql') {
      runSqlQuery(code)
    } else if (language === 'javascript') {
      runJavaScriptCode(code)
    }
  }

  // Run JavaScript code in a Web Worker.
  // Multi-file: prepend sibling files (in tab order) above the active file's
  // content so helpers defined in other tabs are in scope. ES module
  // import/export between files is not supported in v1.
  const runJavaScriptCode = async (code: string) => {
    setRunState(RunState.RUNNING)
    setOutput([])

    const siblingFiles = filesRef.current.filter((_, idx) => idx !== activeFileIndex)
    const combined = siblingFiles.length > 0
      ? siblingFiles.map(f => f.content).join('\n;\n') + '\n;\n' + code
      : code

    const controller = new AbortController()
    jsAbortControllerRef.current = controller

    try {
      const { executeJavaScript } = await import('@/lib/js-executor.client')
      const result = await executeJavaScript(combined, {
        signal: controller.signal,
        onOutput: (level, text) => {
          const mapped =
            level === 'error' ? OutputLevel.ERROR :
            level === 'warn' ? OutputLevel.WARNING :
            OutputLevel.OUTPUT
          addOutput(text, mapped)
        },
        onError: (message) => {
          addOutput(message, OutputLevel.ERROR)
        },
      })
      if (result.stopped) {
        addOutput('Program stopped', OutputLevel.WARNING)
      }
    } catch (error: any) {
      addOutput(error?.message || 'Failed to execute JavaScript', OutputLevel.ERROR)
    } finally {
      if (jsAbortControllerRef.current === controller) {
        jsAbortControllerRef.current = null
      }
      setRunState(RunState.STOPPED)
    }
  }

  // Run SQL query
  const runSqlQuery = async (query: string) => {
    setRunState(RunState.RUNNING)
    setOutput([]) // Clear previous output
    setVerificationResult(null) // Reset verification on each run

    // Yield one frame so React commits the RUNNING state (button → Stop)
    // before SQL.js's synchronous .exec() blocks the event loop. Without
    // this, fast queries against a cached DB finish inside a single
    // microtask and the button never visibly changes — unlike the Python
    // and JS paths, which naturally await a runtime that hasn't loaded yet.
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)))

    try {
      // Ensure database is configured
      if (!db) {
        addOutput('No database configured for this SQL editor', OutputLevel.ERROR)
        setRunState(RunState.STOPPED)
        return
      }

      // Dynamic import to avoid SSR issues
      const { executeSqlQuery, loadDatabase } = await import('@/lib/sql-executor.client')

      // Ensure database is loaded before executing query
      setDbStatus('loading')
      await loadDatabase(db)
      setDbStatus('ready')

      // Run student query (with limit for display, without limit for verification)
      const result = await executeSqlQuery(query, db)

      if (result.success && result.results) {
        // Check if query returned any rows
        const hasRows = result.results.length > 0 && result.results[0].values.length > 0

        if (hasRows) {
          const totalRows = result.results.reduce((sum, r) => sum + r.values.length, 0)
          const message = `Query executed in ${result.executionTime?.toFixed(2)}ms · ${totalRows} row${totalRows !== 1 ? 's' : ''}`
          setOutput([{
            message,
            level: OutputLevel.OUTPUT,
            timestamp: Date.now(),
            sqlResults: result.results
          }])
        } else {
          // Query succeeded but returned no rows
          const message = `Query executed in ${result.executionTime?.toFixed(2)}ms · No rows returned.`
          setOutput([{
            message,
            level: OutputLevel.WARNING,
            timestamp: Date.now()
          }])
        }
        // Show output panel
        setPanelVisible(true)
        setActivePanel('output')

        // Verification: compare student result against solution (both without limit)
        if (solution) {
          const studentFull = await executeSqlQuery(query, db, { applyLimit: false })
          const solutionFull = await executeSqlQuery(solution, db, { applyLimit: false })
          const isCorrect =
            studentFull.success &&
            solutionFull.success &&
            compareResultSets(studentFull.results ?? [], solutionFull.results ?? [])
          setVerificationResult({ isCorrect, showSolution: false })
          // Persist so teacher can see class progress
          if (pageId) {
            saveVerification({ isCorrect, hasAttempted: true }, { immediate: true })
            // Local check version + synced server checkpoint in one go.
            void createCheckVersion(isCorrect ? 'check: correct' : 'check: incorrect')
          }
        }
      } else {
        addOutput(result.error || 'Unknown error occurred', OutputLevel.ERROR)
      }
    } catch (error: any) {
      addOutput(error.message || 'Failed to execute SQL query', OutputLevel.ERROR)
    } finally {
      setRunState(RunState.STOPPED)
    }
  }

  // Run Python code with Skulpt
  const runPythonCode = async (code: string) => {
    setRunState(RunState.RUNNING)
    setOutput([]) // Clear previous output

    try {
      // Ensure Skulpt is loaded
      await ensureSkulptLoaded()

      if (!window.Sk) {
        addOutput('Python runtime not loaded yet', OutputLevel.ERROR)
        setRunState(RunState.STOPPED)
        return
      }

      const canvas = canvasRef.current
      if (canvas) {
        canvas.innerHTML = '' // Clear previous turtle graphics
      }

      const Sk = window.Sk

      Sk.configure({
        output: (text: string) => {
          addOutput(text, OutputLevel.OUTPUT)
        },
        inputfun: (prompt: string): Promise<string> => {
          if (prompt) addOutput(prompt, OutputLevel.OUTPUT)
          return new Promise<string>((resolve, reject) => {
            const entry = { prompt, resolve, reject }
            setPendingInput(entry)
            pendingInputRef.current = entry
          })
        },
        read: (filename: string) => {
          // Extract just the base filename (remove directory paths)
          const baseName = filename.split('/').pop() || filename
          const ext = getFileExtension(language)
          const extPattern = new RegExp(`\\${ext}$`)

          // Read from refs (not state) for the latest content including unsaved typing
          const userFile = filesRef.current.find(f => {
            // Direct match
            if (f.name === baseName || f.name === filename) return true

            // Try adding extension
            if (f.name === baseName + ext || f.name === filename + ext) return true

            // Try removing extension
            const nameWithoutExt = f.name.replace(extPattern, '')
            if (nameWithoutExt === baseName || nameWithoutExt === filename) return true

            return false
          })

          if (userFile) {
            return userFile.content
          }

          // Search skript-scoped imports, then global imports (from refs for latest content)
          const findInImports = (importFiles: PythonFile[] | undefined) => {
            if (!importFiles) return undefined
            return importFiles.find(f => {
              if (f.name === baseName || f.name === filename) return true
              if (f.name === baseName + ext || f.name === filename + ext) return true
              const nameWithoutExt = f.name.replace(extPattern, '')
              if (nameWithoutExt === baseName || nameWithoutExt === filename) return true
              return false
            })
          }
          const skriptFile = findInImports(skriptImportsRef.current?.files)
          if (skriptFile) return skriptFile.content
          const globalFile = findInImports(globalImportsRef.current?.files)
          if (globalFile) return globalFile.content

          // Read Python modules from the stdlib
          if (Sk.builtinFiles && Sk.builtinFiles['files'][filename]) {
            return Sk.builtinFiles['files'][filename]
          }
          // Skulpt tries multiple paths when loading modules, so we don't log every attempt
          throw new Error(`File not found: ${filename}`)
        },
        inputfunTakesPrompt: true,
        __future__: Sk.python3,
        python3: true,
        execLimit: Number.POSITIVE_INFINITY,
      } as SkulptConfig)

      // Configure turtle graphics if canvas exists. Assign a FRESH
      // Sk.TurtleGraphics every run: Skulpt's turtle module mutates this
      // global with internal canvas/context references, so reusing it (||=)
      // after the target div was cleared makes the next run draw into a
      // detached, invisible canvas.
      if (canvas) {
        Sk.TurtleGraphics = {
          width: 2000,
          height: 2000,
          target: canvas,
        }

        // Frame the turtle canvas once Skulpt has created it.
        setTimeout(() => fitToView(), 100)
      }

      const promise = Sk.misceval.asyncToPromise(() => {
        return Sk.importMainWithBody('<stdin>', false, code, true)
      })

      promise.then(
        () => {
          setPendingInput(null)
          pendingInputRef.current = null
          // Show success flash on Run button
          setShowSuccessFlash(true)
          setTimeout(() => setShowSuccessFlash(false), 1500)
          setRunState(RunState.STOPPED)
        },
        (err: SkulptError | Error) => {
          setPendingInput(null)
          pendingInputRef.current = null
          const errStr = err.toString()
          if ('tp$name' in err && err.tp$name === 'TimeoutError' && Sk.execLimit === 1) {
            // Already reported by stopCode
          } else if (errStr.includes('Program stopped')) {
            // Rejected input from stopCode, already reported
          } else {
            addOutput(errStr, OutputLevel.ERROR)
          }
          setRunState(RunState.STOPPED)
        }
      )
    } catch (error) {
      addOutput(`Error: ${error}`, OutputLevel.ERROR)
      setRunState(RunState.STOPPED)
    }
  }

  // Run Python code with Pyodide (for matplotlib, numpy, etc.)
  const runPyodideCode = async (code: string) => {
    setRunState(RunState.RUNNING)
    setOutput([])

    // Fully clear the shared graphics canvas. Both turtle (Skulpt) and
    // matplotlib (Pyodide) render into this same div — only removing
    // `.matplotlib-plot` would leave a previous turtle <canvas> (2000×2000)
    // behind, pushing this run's plots out of view. Each run starts empty.
    if (canvasRef.current) {
      canvasRef.current.innerHTML = ''
    }

    ensurePyodideLoaded()

    // Detect required packages by parsing imports (cheap; same map as before).
    const packageMap: Record<string, string> = {
      'matplotlib': 'matplotlib',
      'numpy': 'numpy',
      'pandas': 'pandas',
      'scipy': 'scipy',
      'sympy': 'sympy',
      'scikit-learn': 'scikit-learn',
      'sklearn': 'scikit-learn',
      'PIL': 'Pillow',
      'pillow': 'Pillow',
      'cv2': 'opencv-python',
      'imageio': 'imageio',
      'micropip': 'micropip',
    }
    const importRegex = /(?:^|\n)\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm
    const packagesToLoad: string[] = []
    let match
    while ((match = importRegex.exec(code)) !== null) {
      const pkg = packageMap[match[1]]
      if (pkg) packagesToLoad.push(pkg)
    }
    const uniquePackages = [...new Set(packagesToLoad)]

    // Collect text aux files (local extras + skript + global imports).
    const localFiles = filesRef.current
    const importFiles = [...(skriptImportsRef.current?.files || []), ...(globalImportsRef.current?.files || [])]
    const textFiles = [...(localFiles.length > 1 ? localFiles : []), ...importFiles]

    // Collect binary aux files. Precedence: editor → skript → global → teacher.
    // Same student-mental-model ordering as before; the worker writes them in
    // the order received and the writes are gated by `seen` so the first wins.
    const binaryFiles: { name: string; bytes: Uint8Array }[] = []
    const seen = new Set<string>()
    const studentBinaryScopes: BinaryFileData[] = [
      editorBinariesRef.current,
      skriptBinariesRef.current,
      globalBinariesRef.current,
    ]
    for (const scope of studentBinaryScopes) {
      for (const file of scope.files) {
        if (seen.has(file.name)) continue
        seen.add(file.name)
        const buf = new Uint8Array(await file.bytes.arrayBuffer())
        binaryFiles.push({ name: file.name, bytes: buf })
      }
    }
    for (const att of attachedFilesRef.current || []) {
      if (seen.has(att.name)) continue
      let bytes = attachedFileBytesRef.current.get(att.url)
      if (!bytes) {
        try {
          const resp = await fetch(att.url)
          if (!resp.ok) {
            addOutput(`Failed to load attached file '${att.name}': ${resp.status}`, OutputLevel.ERROR)
            continue
          }
          bytes = new Uint8Array(await resp.arrayBuffer())
          attachedFileBytesRef.current.set(att.url, bytes)
        } catch (err) {
          addOutput(`Failed to load attached file '${att.name}': ${err instanceof Error ? err.message : String(err)}`, OutputLevel.ERROR)
          continue
        }
      }
      seen.add(att.name)
      binaryFiles.push({ name: att.name, bytes })
    }

    // Stop button + hard timeout both terminate the worker. Either path also
    // kills any in-flight silent exam check below (it shares the worker).
    const controller = new AbortController()
    pyodideAbortControllerRef.current = controller

    try {
      const { result, plots, stopped, timedOut } = await runPython({
        code,
        packages: uniquePackages,
        textFiles,
        binaryFiles,
        configMatplotlib: uniquePackages.includes('matplotlib'),
        signal: controller.signal,
        timeoutMs: STUDENT_PYODIDE_TIMEOUT_MS,
        onStdout: (text) => addOutput(text, OutputLevel.OUTPUT),
        onStderr: (text) => addOutput(text, OutputLevel.ERROR),
      })

      if (stopped) {
        addOutput('Program stopped', OutputLevel.WARNING)
        setRunState(RunState.STOPPED)
        return
      }
      if (timedOut) {
        addOutput('TimeoutError: Execution timed out', OutputLevel.ERROR)
        setRunState(RunState.STOPPED)
        return
      }

      // Render plots returned from the worker.
      if (plots && plots.length > 0 && canvasRef.current) {
        setCanvasVisible(true)
        const canvas = canvasRef.current
        const plotImgs: HTMLImageElement[] = []
        for (let i = 0; i < plots.length; i++) {
          const img = document.createElement('img')
          img.src = plots[i]
          img.alt = `Plot ${i + 1}`
          img.className = 'matplotlib-plot'
          img.draggable = false
          img.style.cssText = 'max-width: 100%; height: auto; display: block; margin: 8px auto; border-radius: 4px; user-select: none;'
          canvas.appendChild(img)
          plotImgs.push(img)
        }
        // Wait for plots to decode so framing knows their size — otherwise a
        // leftover turtle transform can leave them off-screen.
        await Promise.all(plotImgs.map(img => img.decode().catch(() => {})))
        fitToView()
      }

      if (result !== undefined && result !== null) {
        addOutput(String(result), OutputLevel.OUTPUT)
      }

      setShowSuccessFlash(true)
      setTimeout(() => setShowSuccessFlash(false), 1500)
      setRunState(RunState.STOPPED)

      // Exam mode: silently run checks after each execution. Skipped in
      // snapshot-view mode — a teacher's scratch run must not auto-run the
      // graded checks or persist any check result.
      if (exam && effectiveCheckCode && !isViewingSnapshot) {
        const allAuxFiles = [...(localFiles.length > 1 ? localFiles : []), ...importFiles]
        try {
          const results = await runChecks({
            studentCode: code,
            checkCode: effectiveCheckCode,
            auxFiles: allAuxFiles,
            timeoutMs: STUDENT_PYODIDE_TIMEOUT_MS,
          })
          const newChecksUsed = checksUsed + 1
          setChecksUsed(newChecksUsed)
          const totalTests = results.length
          const passedTests = results.filter(r => r.passed).length
          const totalPoints = effectiveCheckPoints ?? totalTests
          const earned = totalTests > 0 ? Math.round((passedTests / totalTests) * totalPoints) : 0
          if (pageId) {
            savePythonCheck({
              checksUsed: newChecksUsed,
              maxChecks: maxChecks ?? null,
              points: totalPoints,
              earnedPoints: earned,
              lastResults: results,
              lastCheckedAt: Date.now(),
            }, { immediate: true })
            void createCheckVersion(`exam check: ${passedTests}/${totalTests} (${earned}/${totalPoints} pts)`)
          }
        } catch { /* silent in exam mode */ }
      }
    } catch (error: any) {
      const errorMessage = cleanPythonError(error.message || String(error))
      addOutput(errorMessage, OutputLevel.ERROR)
      setRunState(RunState.STOPPED)
    } finally {
      if (pyodideAbortControllerRef.current === controller) {
        pyodideAbortControllerRef.current = null
      }
    }
  }

  // Stop running code
  const stopCode = () => {
    if (pendingInputRef.current) {
      pendingInputRef.current.reject(new Error('Program stopped'))
      setPendingInput(null)
      pendingInputRef.current = null
    }
    if (window.Sk) {
      window.Sk.execLimit = 1
    }
    // Aborting terminates the JS Worker. runJavaScriptCode reports "Program
    // stopped" itself via the result.stopped branch, so don't double-log here.
    if (jsAbortControllerRef.current) {
      jsAbortControllerRef.current.abort()
      setRunState(RunState.STOPPED)
      return
    }
    // Aborting terminates the Pyodide Worker. runPyodideCode handles the
    // stopped branch itself (adds "Program stopped" once); don't double-log.
    if (pyodideAbortControllerRef.current) {
      pyodideAbortControllerRef.current.abort()
      setRunState(RunState.STOPPED)
      return
    }
    setRunState(RunState.STOPPED)
    addOutput('Program stopped', OutputLevel.WARNING)
  }

  // Run the CURRENT stage's checks (assert statements against student code).
  // For a single-stage exercise this is the classic Check button.
  const runPythonCheck = async () => {
    if (!effectiveCheckCode || !editorViewRef.current) return
    if (effectiveMaxChecks !== undefined && checksUsed >= effectiveMaxChecks) return

    setIsChecking(true)
    saveCurrentFile()

    const code = editorViewRef.current.state.doc.toString()

    ensurePyodideLoaded()

    // Collect auxiliary files
    const localFiles = filesRef.current
    const importFiles = [...(skriptImportsRef.current?.files || []), ...(globalImportsRef.current?.files || [])]
    const allAuxFiles = [...(localFiles.length > 1 ? localFiles : []), ...importFiles]

    // Stop button + hard timeout terminate the worker; the worker module
    // returns all-failed results in either case, which the scoring logic
    // below handles uniformly (earned=0, no celebration, no advance).
    const controller = new AbortController()
    pyodideAbortControllerRef.current = controller

    try {
      const results = await runChecks({
        studentCode: code,
        checkCode: effectiveCheckCode,
        auxFiles: allAuxFiles,
        signal: controller.signal,
        timeoutMs: STUDENT_PYODIDE_TIMEOUT_MS,
      })

      const newChecksUsed = checksUsed + 1
      setCheckResults(results)
      setChecksUsed(newChecksUsed)

      // Calculate points
      const totalTests = results.length
      const passedTests = results.filter(r => r.passed).length
      const totalPoints = effectiveCheckPoints ?? totalTests
      const earned = totalTests > 0 ? Math.round((passedTests / totalTests) * totalPoints) : 0

      // Trigger celebration only on a not-passing → passing transition.
      // Skips: repeat clicks while already passing, and runs that don't pass.
      const allPassedNow = totalTests > 0 && passedTests === totalTests
      if (allPassedNow && !prevAllPassedRef.current) {
        setCelebrationToken(t => t + 1)
      }
      prevAllPassedRef.current = allPassedNow

      const stageIndex = currentStage
      const isLastStage = stageIndex >= stages.length - 1

      // On clearing the stage: release its coupled-video gate and advance to
      // the next stage (if any). Advancing is deferred briefly so the student
      // sees the green result before the next stage's assertions appear.
      if (allPassedNow) {
        if (coupledVideo) {
          coupledVideo.markPassed(`${pythonCheckComponentId}-stage-${stageIndex}`)
        }
        if (!isLastStage) {
          setTimeout(() => {
            setCurrentStage((i) => Math.min(i + 1, stages.length - 1))
            setCheckResults(null)
            setChecksUsed(0)
            prevAllPassedRef.current = false
          }, 1200)
        }
      }

      // Persist for teacher dashboard (records the stage just acted on).
      // Never in snapshot-view mode — a teacher's scratch check must not write.
      if (pageId && !isViewingSnapshot) {
        const clearedStage = allPassedNow && !isLastStage ? stageIndex + 1 : stageIndex
        savePythonCheck({
          checksUsed: newChecksUsed,
          maxChecks: effectiveMaxChecks ?? null,
          points: totalPoints,
          earnedPoints: earned,
          lastResults: results,
          lastCheckedAt: Date.now(),
          currentStage: clearedStage,
        }, { immediate: true })
        const stageTag = isStaged ? `stage ${stageIndex + 1}/${stages.length} ` : ''
        void createCheckVersion(`${stageTag}check: ${passedTests}/${totalTests} (${earned}/${totalPoints} pts)`)
      }
    } catch (error: any) {
      addOutput(`Check error: ${error.message || String(error)}`, OutputLevel.ERROR)
    } finally {
      if (pyodideAbortControllerRef.current === controller) {
        pyodideAbortControllerRef.current = null
      }
      setIsChecking(false)
    }
  }

  // Restart Python kernel
  const restartKernel = () => {
    if (activeKernel === 'pyodide') {
      // Kill the Pyodide worker; next run respawns and reloads.
      terminatePyodideWorker()
      setActiveKernel(null)
    } else if (activeKernel === 'skulpt') {
      // Clear Skulpt state - it will reload on next run
      delete (window as any).Sk
      delete (window as any).__skulptPromises
      setActiveKernel(null)
    }
    setShowKernelMenu(false)
  }

  // Force switch kernel
  const switchKernel = (_kernel: 'skulpt' | 'pyodide') => {
    // Clear both kernels — next run auto-selects based on imports.
    terminatePyodideWorker()
    delete (window as any).Sk
    delete (window as any).__skulptPromises
    setActiveKernel(null)
    setShowKernelMenu(false)
  }

  // Reset code to original markdown content and clear personal highlights
  const resetCode = () => {
    // Reset to the original markdown files
    const originalFiles = originalInitialFiles.current

    // Update files state
    setFiles(originalFiles)
    setActiveFileIndex(0)

    // Update editor view with the first file's content
    const originalContent = originalFiles[0]?.content || ''
    if (editorViewRef.current) {
      editorViewRef.current.dispatch({
        changes: {
          from: 0,
          to: editorViewRef.current.state.doc.length,
          insert: originalContent,
        },
      })
    }

    // Clear personal highlights and restore teacher highlights
    setHighlights([])
    studentHighlightsSyncedRef.current = '' // Reset sync tracker

    // Clear all highlights from CodeMirror and re-apply teacher highlights
    if (editorViewRef.current) {
      const docLength = editorViewRef.current.state.doc.length
      const teacherFileHighlights = teacherHighlightsForEditor
        .filter(h => h.fileIndex === 0) // Reset always goes to file 0
        .filter(h => h.from >= 0 && h.to >= 0 && h.from < docLength && h.to <= docLength && h.to > h.from)
        .map(h => ({ from: h.from, to: h.to, color: h.color, id: h.id }))

      editorViewRef.current.dispatch({
        effects: [
          setHighlightsEffect.of([]), // Clear all
          replaceTeacherHighlights.of(teacherFileHighlights) // Re-add teacher highlights
        ]
      })
    }

    setOutput([])
    // Only clear canvas for Python graphics (not SQL schemas)
    if (canvasRef.current && language !== 'sql') {
      canvasRef.current.innerHTML = ''
    }
    // Reset to center position
    resetCanvasView()
  }

  // Canvas pan and zoom handlers
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return // Only left click
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX - canvasTransform.x,
      y: e.clientY - canvasTransform.y
    }
  }

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return
    setCanvasTransform(prev => ({
      ...prev,
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y
    }))
  }

  const handleCanvasMouseUp = () => {
    setIsDragging(false)
  }

  // Touch gesture state. Single-finger = pan; two fingers = pinch + pan.
  // We snapshot the start of a pinch so the math is anchored, not incremental
  // (avoids drift). When fingers transition (e.g. one lifts mid-pinch), we
  // recalibrate so the remaining gesture stays smooth.
  const touchStateRef = useRef<
    | { mode: 'pan'; offsetX: number; offsetY: number }
    | { mode: 'pinch'; startDist: number; startScale: number; startCenterX: number; startCenterY: number; startTransformX: number; startTransformY: number }
    | null
  >(null)
  // canvasTransform read inside native listeners — keep a ref so the listener
  // closure always sees the latest values without re-attaching every change.
  const canvasTransformRef = useRef(canvasTransform)
  useLayoutEffect(() => { canvasTransformRef.current = canvasTransform }, [canvasTransform])

  // Attach touch listeners *natively* on the canvas container. Reasons:
  //   1. The page's annotation layer registers `touchstart`/`touchmove` at the
  //      document level (annotation-layer.tsx) and uses two-finger pinch to
  //      zoom #paper. Without intercepting at the canvas, the same gesture
  //      pinches both the canvas and the page.
  //   2. React synthetic events bubble through the React root, so calling
  //      `stopPropagation` from a React handler stops the React handler from
  //      firing too. A native listener on the actual canvas element runs in
  //      the bubble phase before the event reaches `document`.
  useEffect(() => {
    const container = canvasContainerRef.current
    if (!container) return

    const onTouchStart = (e: TouchEvent) => {
      e.stopPropagation()
      if (e.touches.length === 1) {
        const t = e.touches[0]
        touchStateRef.current = {
          mode: 'pan',
          offsetX: t.clientX - canvasTransformRef.current.x,
          offsetY: t.clientY - canvasTransformRef.current.y,
        }
        setIsDragging(true)
      } else if (e.touches.length >= 2) {
        const t1 = e.touches[0]
        const t2 = e.touches[1]
        touchStateRef.current = {
          mode: 'pinch',
          startDist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
          startScale: canvasTransformRef.current.scale,
          startCenterX: (t1.clientX + t2.clientX) / 2,
          startCenterY: (t1.clientY + t2.clientY) / 2,
          startTransformX: canvasTransformRef.current.x,
          startTransformY: canvasTransformRef.current.y,
        }
        setIsDragging(false)
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      e.stopPropagation()
      const state = touchStateRef.current
      if (!state) return

      if (state.mode === 'pan' && e.touches.length === 1) {
        const t = e.touches[0]
        setCanvasTransform(prev => ({
          ...prev,
          x: t.clientX - state.offsetX,
          y: t.clientY - state.offsetY,
        }))
      } else if (state.mode === 'pinch' && e.touches.length >= 2) {
        const rect = container.getBoundingClientRect()
        const t1 = e.touches[0]
        const t2 = e.touches[1]
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
        const centerX = (t1.clientX + t2.clientX) / 2
        const centerY = (t1.clientY + t2.clientY) / 2

        const scaleRatio = dist / state.startDist
        const newScale = Math.max(0.1, Math.min(5, state.startScale * scaleRatio))

        // Keep the canvas point that was under the start midpoint roughly under
        // the current midpoint (so pinch zooms about the gesture's anchor while
        // the midpoint translation pans naturally with the fingers).
        const canvasX = (state.startCenterX - rect.left - state.startTransformX) / state.startScale
        const canvasY = (state.startCenterY - rect.top - state.startTransformY) / state.startScale
        const newX = (centerX - rect.left) - canvasX * newScale
        const newY = (centerY - rect.top) - canvasY * newScale

        setCanvasTransform({ x: newX, y: newY, scale: newScale })
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      e.stopPropagation()
      if (e.touches.length === 1) {
        // Lifted from pinch back to single-finger pan. Recalibrate the offset
        // so the remaining finger doesn't snap.
        const t = e.touches[0]
        touchStateRef.current = {
          mode: 'pan',
          offsetX: t.clientX - canvasTransformRef.current.x,
          offsetY: t.clientY - canvasTransformRef.current.y,
        }
        setIsDragging(true)
      } else if (e.touches.length === 0) {
        touchStateRef.current = null
        setIsDragging(false)
      }
    }

    // passive: false so the browser knows we may preventDefault if needed
    // (and stopPropagation is more reliably honored against the page-level
    // pinch handler that also uses passive: false).
    container.addEventListener('touchstart', onTouchStart, { passive: false })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd, { passive: false })
    container.addEventListener('touchcancel', onTouchEnd, { passive: false })

    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('touchcancel', onTouchEnd)
    }
    // Re-run when the canvas mounts/unmounts: the container only exists when
    // `canvasVisible && showGraphics` is true, so without these deps the
    // effect would run once at mount with a null ref and never attach.
  }, [canvasVisible, showGraphics])

  const resetCanvasView = () => {
    // Reset to centered position
    const canvas = canvasRef.current
    const container = canvasContainerRef.current
    if (canvas && container) {
      const turtleCanvas = canvas.querySelector('canvas')
      if (turtleCanvas) {
        const containerRect = container.getBoundingClientRect()
        const canvasWidth = turtleCanvas.width
        const canvasHeight = turtleCanvas.height
        const centerX = (containerRect.width - canvasWidth) / 2
        const centerY = (containerRect.height - canvasHeight) / 2
        setCanvasTransform({ x: centerX, y: centerY, scale: 1 })
        return
      }
    }
    // Fallback if canvas not found
    setCanvasTransform({ x: 0, y: 0, scale: 1 })
  }

  // "Show everything" — frame whatever is in the graphics pane (turtle
  // canvas, matplotlib plots, SQL schema images) so it all fits, centred,
  // in the visible area. Runs after every render and is also a toolbar
  // button. offsetLeft/Top/Width/Height are layout metrics, unaffected by
  // the CSS transform on canvasRef, so content bounds can be read directly.
  const fitToView = useCallback(() => {
    const container = canvasContainerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const children = Array.from(canvas.children) as HTMLElement[]
    if (children.length === 0) {
      setCanvasTransform({ x: 0, y: 0, scale: 1 })
      return
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const child of children) {
      // For a turtle <canvas>, frame the painted pixels, not the full
      // (mostly blank) 2000×2000 element. Other content (matplotlib / SQL
      // schema <img>s) fills its element, so the element bounds are right.
      const drawn = child instanceof HTMLCanvasElement ? getCanvasDrawnBounds(child) : null
      const left = child.offsetLeft + (drawn?.left ?? 0)
      const top = child.offsetTop + (drawn?.top ?? 0)
      const width = drawn?.width ?? child.offsetWidth
      const height = drawn?.height ?? child.offsetHeight
      minX = Math.min(minX, left)
      minY = Math.min(minY, top)
      maxX = Math.max(maxX, left + width)
      maxY = Math.max(maxY, top + height)
    }
    const contentW = maxX - minX
    const contentH = maxY - minY
    if (contentW <= 0 || contentH <= 0) {
      setCanvasTransform({ x: 0, y: 0, scale: 1 })
      return
    }

    const { width: containerW, height: containerH } = container.getBoundingClientRect()
    const PADDING = 24
    const scale = Math.max(
      0.05,
      Math.min(
        (containerW - PADDING * 2) / contentW,
        (containerH - PADDING * 2) / contentH,
        1, // never upscale past natural size
      ),
    )
    // Center the content's bounding box in the container.
    const x = (containerW - contentW * scale) / 2 - minX * scale
    const y = (containerH - contentH * scale) / 2 - minY * scale
    setCanvasTransform({ x, y, scale })
  }, [])

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!document.fullscreenElement && wrapperRef.current) {
      wrapperRef.current.requestFullscreen()
      setFullscreen(true)
    } else if (document.fullscreenElement) {
      document.exitFullscreen()
      setFullscreen(false)
    }
  }

  return (
    <>
    <div
      ref={wrapperRef}
      className="flex flex-col w-full border rounded-lg overflow-hidden bg-background relative z-0"
      style={{ height: fullscreen ? '100vh' : `${manualHeight ?? totalHeight}px` }}
      data-dynamic-height="true"
    >
      {/* Main content area */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden relative">
        {/* Code Editor Panel */}
        {showEditor && (
          <div
            className="flex flex-col border-r relative"
            style={{
              width: canvasVisible && showGraphics ? `${editorWidth}%` : '100%',
              display: showEditor ? 'flex' : 'none'
            }}
          >
            {/* Floating Toolbar - Top Right (highlighter + zoom controls + kernel indicator) */}
            <div ref={kernelMenuRef} className="absolute top-1 right-1 z-30 flex items-center gap-0.5 bg-background/80 backdrop-blur-sm rounded px-1">
              {/* Highlighter Button */}
              <div className="relative">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleHighlightButtonClick}
                  onMouseDown={handleHighlightButtonMouseDown}
                  onMouseUp={handleHighlightButtonMouseUp}
                  onMouseLeave={handleHighlightButtonMouseLeave}
                  className="h-6 w-6 p-0"
                  title={highlighterMode ? 'Highlighter mode active (click to deactivate)' : 'Highlight selection (long press for colors)'}
                  style={{
                    color: `var(--highlight-${highlightColor})`,
                    backgroundColor: highlighterMode ? `var(--highlight-${highlightColor}-bg)` : undefined
                  }}
                >
                  <Highlighter className="w-3 h-3" />
                </Button>

                {/* Color Picker Dropdown */}
                {showColorPicker && (
                  <div
                    ref={colorPickerRef}
                    className="absolute top-full left-0 mt-1 p-1 bg-popover border border-border rounded-lg shadow-lg flex gap-1 z-50"
                  >
                    {(['red', 'yellow', 'green', 'blue'] as const).map((color) => (
                      <button
                        key={color}
                        onClick={() => {
                          setHighlightColor(color)
                          setShowColorPicker(false)
                        }}
                        className={`w-6 h-6 rounded transition-all hover:scale-110 ${
                          highlightColor === color ? 'ring-2 ring-primary ring-offset-1' : ''
                        }`}
                        style={{
                          backgroundColor: color === 'red' ? 'rgba(239, 68, 68, 0.7)'
                            : color === 'yellow' ? 'rgba(234, 179, 8, 0.7)'
                            : color === 'green' ? 'rgba(34, 197, 94, 0.7)'
                            : 'rgba(59, 130, 246, 0.7)'
                        }}
                        title={`${color.charAt(0).toUpperCase() + color.slice(1)} highlight`}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="w-px h-4 bg-border mx-1" />

              {/* Zoom Controls */}
              <Button
                size="sm"
                variant="ghost"
                onClick={decreaseFontSize}
                className="h-6 w-6 p-0"
                title="Decrease font size"
              >
                <ZoomOut className="w-3 h-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={increaseFontSize}
                className="h-6 w-6 p-0"
                title="Increase font size"
              >
                <ZoomIn className="w-3 h-3" />
              </Button>
              <button
                onClick={() => setLineWrapping(!lineWrapping)}
                className={`h-6 w-6 p-0 rounded-md flex items-center justify-center transition-colors hover:bg-accent hover:text-accent-foreground ${
                  lineWrapping ? 'bg-gray-300 dark:bg-gray-700' : ''
                }`}
                title={lineWrapping ? 'Disable line wrapping' : 'Enable line wrapping'}
              >
                <WrapText className="w-3 h-3" />
              </button>

              {/* Files panel button - Python only, gated on having attached files OR allowing uploads.
                  Clicking opens a unified list of teacher-attached binaries + student uploads
                  (split by scope). All student uploads stay on-device (localOnly=true). */}
              {isPython && (allowUpload || (attachedFiles && attachedFiles.length > 0)) && (
                <>
                  <div className="w-px h-4 bg-border mx-1" />
                  <div className="relative" ref={binariesDropdownRef}>
                    <button
                      onClick={() => {
                        if (!showBinariesDropdown && binariesDropdownRef.current) {
                          const rect = binariesDropdownRef.current.getBoundingClientRect()
                          setBinariesDropdownPosition({
                            top: rect.bottom + 4,
                            left: rect.right - 240,
                          })
                        }
                        setShowBinariesDropdown(prev => !prev)
                      }}
                      className="w-6 h-6 rounded flex items-center justify-center transition-colors hover:bg-muted text-amber-600 dark:text-amber-400"
                      title="Files (attached & uploaded)"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              )}

              {/* Global Files button - Python only.
                  Skip the leading separator when the binaries paperclip is also shown,
                  since the two buttons should sit visually together. */}
              {isPython && (
                <>
                  {!(allowUpload || (attachedFiles && attachedFiles.length > 0)) && (
                    <div className="w-px h-4 bg-border mx-1" />
                  )}
                  <div className="relative" ref={importsDropdownRef}>
                    <button
                      onClick={() => {
                        if (!showImportsDropdown && importsDropdownRef.current) {
                          const rect = importsDropdownRef.current.getBoundingClientRect()
                          setImportsDropdownPosition({
                            top: rect.bottom + 4,
                            left: rect.right - 200,
                          })
                        }
                        setShowImportsDropdown(prev => !prev)
                      }}
                      className="w-6 h-6 rounded flex items-center justify-center transition-colors hover:bg-muted text-blue-600 dark:text-blue-400"
                      title="Global files"
                    >
                      <Package className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Global files dropdown - rendered via portal */}
                  {showImportsDropdown && importsDropdownPosition && typeof document !== 'undefined' && createPortal(
                    <div
                      ref={importsDropdownPortalRef}
                      className="fixed bg-popover border rounded-lg shadow-lg p-2 min-w-[200px] z-[9999]"
                      style={{
                        top: `${importsDropdownPosition.top}px`,
                        left: `${importsDropdownPosition.left}px`,
                      }}
                    >
                      {/* Skript scope section */}
                      {skriptId && (
                        <>
                          <div
                            className="text-xs font-medium text-muted-foreground px-2 py-1"
                            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('bg-blue-50', 'dark:bg-blue-900/20') }}
                            onDragLeave={(e) => { e.currentTarget.classList.remove('bg-blue-50', 'dark:bg-blue-900/20') }}
                            onDrop={(e) => {
                              e.preventDefault()
                              e.currentTarget.classList.remove('bg-blue-50', 'dark:bg-blue-900/20')
                              const data = e.dataTransfer.getData('text/plain')
                              try {
                                const { name, scope } = JSON.parse(data)
                                if (scope !== 'skript') moveImportScope(name, scope, 'skript')
                              } catch {}
                            }}
                          >
                            Skript scope
                          </div>
                          {(skriptImports?.files || []).map(f => (
                            <div
                              key={`skript-${f.name}`}
                              className="flex items-center justify-between px-2 py-1 text-sm rounded hover:bg-muted cursor-pointer"
                              draggable
                              onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ name: f.name, scope: 'skript' }))}
                              onClick={() => { switchToImport('skript', f.name); setShowImportsDropdown(false) }}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                setImportContextMenu({ scope: 'skript', name: f.name, x: e.clientX, y: e.clientY })
                              }}
                            >
                              <span className="flex items-center gap-1.5">
                                <Package className="w-3 h-3 text-blue-500" />
                                {f.name}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (f.content.trim() && f.content !== '# Shared import file') {
                                    dialog.showConfirm(
                                      `Delete "${f.name}"?`,
                                      () => deleteImportFile('skript', f.name),
                                      { destructive: true, title: 'Delete file', confirmText: 'Delete' }
                                    )
                                    return
                                  }
                                  deleteImportFile('skript', f.name)
                                }}
                                className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                                title="Delete"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                          {(skriptImports?.files || []).length === 0 && (
                            <div className="text-xs text-muted-foreground/50 px-2 py-1 italic">No files</div>
                          )}
                          <div className="border-t my-1" />
                        </>
                      )}

                      {/* Global scope section */}
                      <div
                        className="text-xs font-medium text-muted-foreground px-2 py-1"
                        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('bg-blue-50', 'dark:bg-blue-900/20') }}
                        onDragLeave={(e) => { e.currentTarget.classList.remove('bg-blue-50', 'dark:bg-blue-900/20') }}
                        onDrop={(e) => {
                          e.preventDefault()
                          e.currentTarget.classList.remove('bg-blue-50', 'dark:bg-blue-900/20')
                          const data = e.dataTransfer.getData('text/plain')
                          try {
                            const { name, scope } = JSON.parse(data)
                            if (scope !== 'global') moveImportScope(name, scope, 'global')
                          } catch {}
                        }}
                      >
                        Global scope
                      </div>
                      {(globalImports?.files || []).map(f => (
                        <div
                          key={`global-${f.name}`}
                          className="flex items-center justify-between px-2 py-1 text-sm rounded hover:bg-muted cursor-pointer"
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ name: f.name, scope: 'global' }))}
                          onClick={() => { switchToImport('global', f.name); setShowImportsDropdown(false) }}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setImportContextMenu({ scope: 'global', name: f.name, x: e.clientX, y: e.clientY })
                          }}
                        >
                          <span className="flex items-center gap-1.5">
                            <Package className="w-3 h-3 text-blue-500" />
                            {f.name}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (f.content.trim() && f.content !== '# Shared import file') {
                                dialog.showConfirm(
                                  `Delete "${f.name}"?`,
                                  () => deleteImportFile('global', f.name),
                                  { destructive: true, title: 'Delete file', confirmText: 'Delete' }
                                )
                                return
                              }
                              deleteImportFile('global', f.name)
                            }}
                            className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      {(globalImports?.files || []).length === 0 && (
                        <div className="text-xs text-muted-foreground/50 px-2 py-1 italic">No files</div>
                      )}

                      <div className="border-t my-1" />
                      <button
                        onClick={() => { createImportFile(skriptId ? 'skript' : 'global'); setShowImportsDropdown(false) }}
                        className="w-full text-left px-2 py-1 text-sm rounded hover:bg-muted text-blue-600 dark:text-blue-400"
                      >
                        <Plus className="w-3 h-3 inline mr-1" />
                        New global file
                      </button>
                    </div>,
                    document.body
                  )}
                </>
              )}

              {/* Files dropdown (binaries) - portal-rendered */}
              {isPython && showBinariesDropdown && binariesDropdownPosition && typeof document !== 'undefined' && createPortal(
                <div
                  ref={binariesDropdownPortalRef}
                  className="fixed bg-popover border rounded-lg shadow-lg p-2 min-w-[260px] max-w-[320px] z-[9999]"
                  style={{
                    top: `${binariesDropdownPosition.top}px`,
                    left: `${binariesDropdownPosition.left}px`,
                  }}
                >
                  {/* Teacher-attached files (read-only). Shown only if any. */}
                  {attachedFiles && attachedFiles.length > 0 && (
                    <>
                      <div className="text-xs font-medium text-muted-foreground px-2 py-1 flex items-center gap-1">
                        From skript
                        <span className="text-[10px] text-muted-foreground/60">(read-only)</span>
                      </div>
                      {attachedFiles.map(f => (
                        <div key={`attached-${f.name}`} className="flex items-center justify-between px-2 py-1 text-sm rounded hover:bg-muted/50">
                          <span className="flex items-center gap-1.5 truncate">
                            <FileText className="w-3 h-3 text-amber-500 shrink-0" />
                            <span className="truncate">{f.name}</span>
                          </span>
                        </div>
                      ))}
                      <div className="border-t my-1" />
                    </>
                  )}

                  {/* Student uploads, grouped by scope. Editor scope is shown even when empty
                      so the student knows where their next upload will land. Skript/global
                      sections are only shown when they contain files OR can receive promotions. */}
                  {([
                    { scope: 'editor' as const, label: 'This editor', data: editorBinaries },
                    ...(skriptId ? [{ scope: 'skript' as const, label: 'This skript', data: skriptBinaries }] : []),
                    { scope: 'global' as const, label: 'Everywhere', data: globalBinaries },
                  ]).map(({ scope, label, data }) => (
                    <div key={`scope-${scope}`}>
                      <div className="text-xs font-medium text-muted-foreground px-2 py-1">
                        {label}
                      </div>
                      {data.files.length === 0 && (
                        <div className="text-xs text-muted-foreground/50 px-2 py-1 italic">No files</div>
                      )}
                      {data.files.map(f => {
                        const isRenaming = renamingBinary?.scope === scope && renamingBinary?.oldName === f.name
                        const commitRename = () => {
                          renameBinary(scope, f.name, renameBinaryValue)
                          setRenamingBinary(null)
                        }
                        return (
                        <div key={`${scope}-${f.name}`} className="flex items-center justify-between px-2 py-1 text-sm rounded hover:bg-muted/50 gap-2">
                          <span className="flex items-center gap-1.5 truncate min-w-0">
                            <FileText className="w-3 h-3 text-amber-500 shrink-0" />
                            {isRenaming ? (
                              <input
                                type="text"
                                value={renameBinaryValue}
                                autoFocus
                                onChange={(e) => setRenameBinaryValue(e.target.value)}
                                onBlur={commitRename}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') commitRename()
                                  else if (e.key === 'Escape') setRenamingBinary(null)
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="h-5 px-1 text-xs border rounded bg-background min-w-0 flex-1"
                              />
                            ) : (
                              <span
                                className="truncate cursor-text"
                                onDoubleClick={() => {
                                  setRenamingBinary({ scope, oldName: f.name })
                                  setRenameBinaryValue(f.name)
                                }}
                                title="Double-click to rename"
                              >
                                {f.name}
                              </span>
                            )}
                            {!isRenaming && (
                              <span className="text-[10px] text-muted-foreground/60 shrink-0">
                                {formatBytes(f.sizeBytes)}
                              </span>
                            )}
                          </span>
                          <span className="flex items-center gap-0.5 shrink-0">
                            {/* Scope buttons - clicking a different scope opens the confirm modal.
                                Skript scope is hidden when the editor isn't inside a skript. */}
                            {(['editor', 'skript', 'global'] as const)
                              .filter(s => s !== 'skript' || skriptId)
                              .map(s => (
                                <button
                                  key={s}
                                  onClick={() => {
                                    if (s === scope) return
                                    setPendingScopeChange({
                                      name: f.name,
                                      sizeBytes: f.sizeBytes,
                                      fromScope: scope,
                                      toScope: s,
                                    })
                                  }}
                                  className={`px-1 h-5 rounded text-[10px] uppercase tracking-wide transition-colors ${
                                    s === scope
                                      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 cursor-default'
                                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                  }`}
                                  title={s === scope ? `Currently scoped to ${s}` : `Move to ${s} scope`}
                                  disabled={s === scope}
                                >
                                  {s === 'editor' ? 'E' : s === 'skript' ? 'S' : 'G'}
                                </button>
                              ))}
                            <button
                              onClick={() => {
                                setRenamingBinary({ scope, oldName: f.name })
                                setRenameBinaryValue(f.name)
                              }}
                              className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                              title="Rename"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => {
                                dialog.showConfirm(
                                  `Remove "${f.name}"?`,
                                  () => removeBinary(scope, f.name),
                                  { destructive: true, title: 'Remove file', confirmText: 'Remove' }
                                )
                              }}
                              className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                              title="Remove"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </span>
                        </div>
                        )
                      })}
                    </div>
                  ))}

                  {/* Upload button - only shown when the editor opted in via allow-upload */}
                  {allowUpload && (
                    <>
                      <div className="border-t my-1" />
                      <input
                        ref={binariesFileInputRef}
                        type="file"
                        multiple
                        accept={acceptUploads || undefined}
                        className="hidden"
                        onChange={(e) => {
                          handleBinaryUpload(e.target.files)
                          // Allow re-uploading the same file by clearing the input.
                          e.target.value = ''
                        }}
                      />
                      <button
                        onClick={() => binariesFileInputRef.current?.click()}
                        className="w-full text-left px-2 py-1 text-sm rounded hover:bg-muted text-amber-600 dark:text-amber-400 flex items-center gap-1.5"
                      >
                        <Upload className="w-3 h-3" />
                        Upload file
                      </button>
                      <div className="text-[10px] text-muted-foreground/60 px-2 pt-1">
                        Files stay on this device only.
                      </div>
                    </>
                  )}
                </div>,
                document.body
              )}

              {/* Python Kernel Indicator */}
              {language === 'python' && (
                <>
                  <button
                    ref={kernelButtonRef}
                    onClick={() => {
                      if (!showKernelMenu && kernelButtonRef.current) {
                        const rect = kernelButtonRef.current.getBoundingClientRect()
                        setKernelMenuPosition({
                          top: rect.bottom + 4,
                          left: rect.right - 160 // 160px is menu width
                        })
                      }
                      setShowKernelMenu(!showKernelMenu)
                    }}
                    className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
                      kernelLoading
                        ? 'bg-yellow-500/20 animate-pulse'
                        : activeKernel
                        ? 'hover:bg-muted'
                        : ''
                    }`}
                    title={activeKernel ? `Python (${activeKernel})` : 'Python kernel not loaded'}
                  >
                    <svg
                      viewBox="0 0 256 255"
                      className={`w-4 h-4 ${
                        kernelLoading
                          ? 'text-yellow-600 dark:text-yellow-400'
                          : activeKernel
                          ? 'text-muted-foreground hover:text-foreground'
                          : 'text-muted-foreground/40'
                      }`}
                      fill="currentColor"
                    >
                      <path d="M126.916.072c-64.832 0-60.784 28.115-60.784 28.115l.072 29.128h61.868v8.745H41.631S.145 61.355.145 126.77c0 65.417 36.21 63.097 36.21 63.097h21.61v-30.356s-1.165-36.21 35.632-36.21h61.362s34.475.557 34.475-33.319V33.97S194.67.072 126.916.072zM92.802 19.66a11.12 11.12 0 0 1 11.13 11.13 11.12 11.12 0 0 1-11.13 11.13 11.12 11.12 0 0 1-11.13-11.13 11.12 11.12 0 0 1 11.13-11.13z" />
                      <path d="M128.757 254.126c64.832 0 60.784-28.115 60.784-28.115l-.072-29.127H127.6v-8.745h86.441s41.486 4.705 41.486-60.712c0-65.416-36.21-63.096-36.21-63.096h-21.61v30.355s1.165 36.21-35.632 36.21h-61.362s-34.475-.557-34.475 33.32v56.013s-5.235 33.897 62.518 33.897zm34.114-19.586a11.12 11.12 0 0 1-11.13-11.13 11.12 11.12 0 0 1 11.13-11.131 11.12 11.12 0 0 1 11.13 11.13 11.12 11.12 0 0 1-11.13 11.13z" />
                    </svg>
                  </button>

                  {/* Kernel Menu Dropdown - Rendered via Portal */}
                  {showKernelMenu && kernelMenuPosition && typeof document !== 'undefined' && createPortal(
                    <div
                      className="fixed bg-popover border rounded-lg shadow-lg p-2 min-w-[160px] z-[9999]"
                      style={{
                        top: `${kernelMenuPosition.top}px`,
                        left: `${kernelMenuPosition.left}px`
                      }}
                    >
                      <div className="text-xs text-muted-foreground mb-2 px-2">
                        {activeKernel ? (
                          <span>Kernel: <strong className="text-foreground capitalize">{activeKernel}</strong></span>
                        ) : (
                          <span>No kernel loaded</span>
                        )}
                      </div>
                      <div className="border-t my-1" />
                      <button
                        onClick={restartKernel}
                        disabled={!activeKernel}
                        className="w-full text-left px-2 py-1 text-sm rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Restart kernel
                      </button>
                      <div className="border-t my-1" />
                      <div className="text-xs text-muted-foreground px-2 mb-1">Switch to:</div>
                      <button
                        onClick={() => switchKernel('skulpt')}
                        className={`w-full text-left px-2 py-1 text-sm rounded hover:bg-muted ${activeKernel === 'skulpt' ? 'bg-muted' : ''}`}
                      >
                        Skulpt <span className="text-xs text-muted-foreground">(turtle)</span>
                      </button>
                      <button
                        onClick={() => switchKernel('pyodide')}
                        className={`w-full text-left px-2 py-1 text-sm rounded hover:bg-muted ${activeKernel === 'pyodide' ? 'bg-muted' : ''}`}
                      >
                        Pyodide <span className="text-xs text-muted-foreground">(numpy, etc)</span>
                      </button>
                    </div>,
                    document.body
                  )}
                </>
              )}
            </div>

            {/* File Tabs - hidden in single-file mode */}
            {!singleFile && (
              <div
                className="flex items-center gap-1 pl-2 border-b bg-muted/10 h-9"
                style={{ paddingRight: toolbarWidth + 8 }}
              >
                  <div className="flex items-center gap-1 overflow-x-auto overflow-y-hidden flex-1 h-full file-tabs-scroll">
                    {/* Local file tabs */}
                    {files.map((file, index) => (
                      <div key={`local-${index}`} className="flex items-center">
                        {renamingIndex === index ? (
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => confirmRename(index)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                confirmRename(index)
                              } else if (e.key === 'Escape') {
                                cancelRename()
                              }
                            }}
                            autoFocus
                            className="h-7 px-2 text-xs border rounded bg-background"
                            style={{ width: '120px' }}
                          />
                        ) : (
                          <Button
                            size="sm"
                            variant={activeTab.type === 'local' && activeFileIndex === index ? 'secondary' : 'ghost'}
                            onClick={() => switchToFile(index)}
                            onDoubleClick={() => startRename(index)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              setTabContextMenu({ index, x: e.clientX, y: e.clientY })
                            }}
                            onPointerDown={(e) => {
                              // Long-press for touch/stylus (500ms)
                              if (e.pointerType === 'touch' || e.pointerType === 'pen') {
                                tabLongPressRef.current = setTimeout(() => {
                                  setTabContextMenu({ index, x: e.clientX, y: e.clientY })
                                }, 500)
                              }
                            }}
                            onPointerUp={() => {
                              if (tabLongPressRef.current) {
                                clearTimeout(tabLongPressRef.current)
                                tabLongPressRef.current = null
                              }
                            }}
                            onPointerCancel={() => {
                              if (tabLongPressRef.current) {
                                clearTimeout(tabLongPressRef.current)
                                tabLongPressRef.current = null
                              }
                            }}
                            className="h-7 pl-2 pr-1 text-xs gap-1 group/tab"
                            title="Double-click to rename · Right-click for options"
                          >
                            <FileText className="w-3 h-3" />
                            {file.name}
                            <span
                              className={`w-4 h-4 inline-flex items-center justify-center rounded-sm hover:bg-foreground/10 ${
                                files.length <= 1 ? 'invisible' :
                                activeTab.type === 'local' && activeFileIndex === index ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover/tab:opacity-60 hover:!opacity-100'
                              }`}
                              onClick={(e) => {
                                e.stopPropagation()
                                removeFile(index)
                              }}
                              title="Remove file"
                            >
                              <X className="w-3 h-3" />
                            </span>
                          </Button>
                        )}
                      </div>
                    ))}

                    {/* Open import tabs (visually distinct) */}
                    {isPython && openImports.map((imp) => {
                      const isActive = activeTab.type === 'import' && activeTab.scope === imp.scope && activeTab.name === imp.name
                      const isRenaming = renamingImport?.scope === imp.scope && renamingImport?.name === imp.name
                      return isRenaming ? (
                        <input
                          key={`import-rename-${imp.scope}-${imp.name}`}
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => renameImportFile(imp.scope, imp.name)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              renameImportFile(imp.scope, imp.name)
                            } else if (e.key === 'Escape') {
                              setRenamingImport(null)
                              setRenameValue('')
                            }
                          }}
                          autoFocus
                          className="h-7 px-2 text-xs border rounded bg-background"
                          style={{ width: '120px' }}
                        />
                      ) : (
                        <Button
                          key={`import-${imp.scope}-${imp.name}`}
                          size="sm"
                          variant={isActive ? 'secondary' : 'ghost'}
                          onClick={() => switchToImport(imp.scope, imp.name)}
                          onDoubleClick={() => startImportRename(imp.scope, imp.name)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setImportContextMenu({ scope: imp.scope, name: imp.name, x: e.clientX, y: e.clientY })
                          }}
                          className={`h-7 pl-2 pr-1 text-xs gap-1 group/tab ${isActive ? 'bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50' : 'text-blue-600 dark:text-blue-400'}`}
                          title={`${imp.scope === 'skript' ? 'Skript scope' : 'Global scope'} · Double-click to rename · Right-click for options`}
                        >
                          <Package className="w-3 h-3" />
                          {imp.name}
                          <span
                            className={`w-4 h-4 inline-flex items-center justify-center rounded-sm hover:bg-foreground/10 ${
                              isActive ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover/tab:opacity-60 hover:!opacity-100'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation()
                              closeImportTab(imp.scope, imp.name)
                            }}
                            title="Close tab"
                          >
                            <X className="w-3 h-3" />
                          </span>
                        </Button>
                      )
                    })}

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={addNewFile}
                      className="h-7 px-2 text-xs"
                      title="Add new file"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
              </div>
            )}

            {/* Tab context menu - rendered via portal */}
            {tabContextMenu && typeof document !== 'undefined' && createPortal(
              <div
                ref={tabContextMenuRef}
                className="fixed bg-popover border rounded-lg shadow-lg py-1 min-w-[160px] z-[9999]"
                style={{ top: `${tabContextMenu.y}px`, left: `${tabContextMenu.x}px` }}
              >
                <button
                  onClick={() => { startRename(tabContextMenu.index); setTabContextMenu(null) }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
                >
                  Rename
                </button>
                {isPython && (
                  <>
                    <button
                      onClick={() => { makeImport(tabContextMenu.index, 'skript'); setTabContextMenu(null) }}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
                    >
                      Move to Skript scope
                    </button>
                    <button
                      onClick={() => { makeImport(tabContextMenu.index, 'global'); setTabContextMenu(null) }}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
                    >
                      Move to Global scope
                    </button>
                  </>
                )}
                {files.length > 1 && (
                  <>
                    <div className="border-t my-1" />
                    <button
                      onClick={() => { removeFile(tabContextMenu.index); setTabContextMenu(null) }}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted text-destructive"
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>,
              document.body
            )}

            {/* Import tab context menu - rendered via portal */}
            {importContextMenu && typeof document !== 'undefined' && createPortal(
              <div
                ref={importContextMenuRef}
                className="fixed bg-popover border rounded-lg shadow-lg py-1 min-w-[160px] z-[9999]"
                style={{ top: `${importContextMenu.y}px`, left: `${importContextMenu.x}px` }}
              >
                <button
                  onClick={() => { startImportRename(importContextMenu.scope, importContextMenu.name); setImportContextMenu(null) }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
                >
                  Rename
                </button>
                <button
                  onClick={() => { makeLocal(importContextMenu.scope, importContextMenu.name); setImportContextMenu(null) }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
                >
                  Make local
                </button>
                {importContextMenu.scope !== 'global' && (
                  <button
                    onClick={() => { moveImportScope(importContextMenu.name, importContextMenu.scope, 'global'); setImportContextMenu(null) }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    Move to Global scope
                  </button>
                )}
                {importContextMenu.scope !== 'skript' && skriptId && (
                  <button
                    onClick={() => { moveImportScope(importContextMenu.name, importContextMenu.scope, 'skript'); setImportContextMenu(null) }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    Move to Skript scope
                  </button>
                )}
                <div className="border-t my-1" />
                <button
                  onClick={() => { deleteImportFile(importContextMenu.scope, importContextMenu.name); setImportContextMenu(null) }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted text-destructive"
                >
                  Delete
                </button>
              </div>,
              document.body
            )}

            {/* CodeMirror Editor */}
            <div ref={editorRef} className="flex-1 overflow-auto w-full h-full relative" style={{ cursor: highlighterMode ? highlighterCursor : undefined }}>
              {/* Loading skeleton while editor initializes */}
              {!editorReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-[#1e1e1e] z-[1]">
                  <span className="text-xs text-muted-foreground animate-pulse">Loading editor...</span>
                </div>
              )}
              {/* Snapshot-view banner: when a teacher is viewing a student's
                  submission, the floating action buttons are hidden so Run /
                  Check / Reset / Save can't fire against frozen student code. */}
              {/* Floating Control Buttons - Bottom Left. Shown in snapshot-view
                  mode too (teacher can Run the student's code to test); all
                  persistence is gated, so a scratch run saves nothing. */}
              {(
              <div className="absolute bottom-2 left-2 flex items-center gap-1 z-10">
                {runState === RunState.STOPPED ? (
                  <Button
                    onClick={runCode}
                    size="sm"
                    variant={showSuccessFlash ? 'default' : 'default'}
                    className={`h-7 px-2 shadow-lg transition-colors ${
                      showSuccessFlash ? 'bg-green-600 hover:bg-green-600 text-white' : ''
                    }`}
                  >
                    <Play className="w-3 h-3 mr-1" />
                    {showSuccessFlash ? '✓' : 'Run'}
                  </Button>
                ) : (
                  <Button onClick={stopCode} size="sm" variant="destructive" className="h-7 px-2 shadow-lg">
                    <Square className="w-3 h-3 mr-1" />
                    Stop
                  </Button>
                )}
                {language === 'sql' && db && (
                  <span
                    className="flex items-center justify-center w-5 h-5 cursor-default opacity-50 hover:opacity-100 transition-opacity"
                    title={dbStatus === 'idle' ? `${dbName} — loads on first run` : dbStatus === 'loading' ? `Loading ${dbName}...` : `${dbName} ready`}
                  >
                    {dbStatus === 'idle' && (
                      <Circle className="w-3.5 h-3.5 text-muted-foreground/40" />
                    )}
                    {dbStatus === 'loading' && (
                      <span
                        className="block w-3.5 h-3.5 rounded-full animate-spin border-2 border-muted-foreground/30 border-t-muted-foreground/70"
                      />
                    )}
                    {dbStatus === 'ready' && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-600/70" />
                    )}
                  </span>
                )}
                {hasChecks && !exam && (
                  <Button
                    onClick={runPythonCheck}
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 shadow-lg"
                    disabled={isChecking || (effectiveMaxChecks !== undefined && checksUsed >= effectiveMaxChecks)}
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    {isChecking ? '...' : 'Check'}
                    {isStaged && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        stage {Math.min(currentStage + 1, stages.length)}/{stages.length}
                      </span>
                    )}
                    {effectiveMaxChecks !== undefined && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        {checksUsed}/{effectiveMaxChecks}
                      </span>
                    )}
                  </Button>
                )}
              </div>
              )}
              {/* Floating Control Buttons - Bottom Right */}
              {pageId && !isViewingSnapshot && (
                <div className="absolute bottom-2 right-2 flex items-center gap-1 z-10">
                  <button
                    onClick={() => { navigator.clipboard.writeText(componentId) }}
                    className="h-7 w-7 flex items-center justify-center text-[10px] font-mono opacity-15 hover:opacity-60 active:opacity-100 transition-opacity cursor-pointer"
                    title={componentId}
                  >
                    #
                  </button>
                  <Button
                    onClick={resetCode}
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 shadow-lg"
                    title="Reset to default content"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </Button>
                  <Button
                    onClick={() => {
                      setActivePanel('history')
                      setPanelVisible(true)
                    }}
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 shadow-lg"
                    title="Version history"
                  >
                    <History className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Draggable Splitter - wider touch target on mobile */}
        {showEditor && showGraphics && canvasVisible && (
          <div
            onMouseDown={handleSplitterMouseDown}
            onTouchStart={handleSplitterTouchStart}
            className={`w-1 bg-border hover:bg-primary/20 cursor-col-resize flex-shrink-0 transition-colors relative flex items-center justify-center touch-none ${
              isDraggingSplitter ? 'bg-primary/30' : ''
            }`}
            style={{ minWidth: '8px' }}
          >
            {/* Drag indicator */}
            <div className="text-muted-foreground/40 text-xs select-none pointer-events-none">
              ⋮
            </div>
            {/* Extended touch target (invisible but increases hit area) */}
            <div className="absolute inset-y-0 -left-2 -right-2 md:hidden" />
          </div>
        )}

        {/* Graphics Panel (Turtle Graphics & Matplotlib for Python) */}
        {canvasVisible && showGraphics && (
          <div
            className="flex flex-col relative"
            style={{ width: showEditor ? `${100 - editorWidth}%` : '100%' }}
          >
            <div
              ref={canvasContainerRef}
              className="flex-1 relative overflow-hidden"
              style={{
                backgroundColor: resolvedTheme === 'dark' ? '#111827' : '#ffffff',
                cursor: isDragging ? 'grabbing' : 'grab',
                touchAction: 'none',
                overscrollBehavior: 'contain'
              }}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
            >
              {/* Floating Control Buttons */}
              <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
                <Button onClick={fitToView} size="sm" variant="outline" className="h-7 w-7 p-0 shadow-lg" title="Fit to view — show everything">
                  <Scan className="w-3 h-3" />
                </Button>
                <Button onClick={toggleFullscreen} size="sm" variant="outline" className="h-7 w-7 p-0 shadow-lg" title="Fullscreen">
                  {fullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                </Button>
              </div>
              <div
                ref={canvasRef}
                className="absolute inset-0"
                style={{
                  transform: `translate(${canvasTransform.x}px, ${canvasTransform.y}px) scale(${canvasTransform.scale})`,
                  transformOrigin: '0 0',
                  transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Horizontal Divider (between main content and output) - bigger touch target on mobile */}
      {panelVisible && (
        <div
          onMouseDown={handleHorizontalSplitterMouseDown}
          onTouchStart={handleHorizontalSplitterTouchStart}
          className="h-1 bg-border hover:bg-primary/20 cursor-row-resize flex-shrink-0 transition-colors relative touch-none"
          style={{ minHeight: '8px' }}
        >
          {/* Extended touch target (invisible but increases hit area) */}
          <div className="absolute -top-2 -bottom-2 inset-x-0 md:hidden" />
        </div>
      )}

      {/* Output/History Panel - fixed height */}
      {panelVisible && (
        <div
          className="flex flex-col overflow-hidden"
          style={{ height: `${outputPanelHeight}px` }}
        >
        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 border-b bg-muted/30">
          <Button
            onClick={() => setActivePanel('output')}
            size="sm"
            variant={activePanel === 'output' ? 'secondary' : 'ghost'}
            className="h-7"
          >
            Output
          </Button>
          {pageId && (
            <Button
              onClick={() => setActivePanel('history')}
              size="sm"
              variant={activePanel === 'history' ? 'secondary' : 'ghost'}
              className="h-7"
            >
              History
            </Button>
          )}
          {pageId && orphans.length > 0 && (
            <Button
              onClick={() => setActivePanel('orphans')}
              size="sm"
              variant={activePanel === 'orphans' ? 'secondary' : 'ghost'}
              className="h-7"
              title="Saves from previous versions of this editor whose IDs no longer match"
            >
              Orphaned ({orphans.length})
            </Button>
          )}
          {/* Spacer */}
          <div className="flex-1" />
          {/* Close button */}
          <Button
            onClick={() => setPanelVisible(false)}
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            title="Close panel"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>

        {/* Panel Content */}
        {activePanel === 'output' ? (
          <div ref={outputPanelRef} className="flex-1 overflow-auto p-2 font-mono text-sm" style={{ overscrollBehaviorY: 'contain' }}>
            {output.map((entry, index) => (
                <div key={index} className="mb-2">
                  {/* Stats line with inline verification result */}
                  <div
                    className={`${entry.isHtml ? '' : 'whitespace-pre-wrap'} ${
                      entry.level === OutputLevel.ERROR
                        ? 'text-red-600 dark:text-red-400'
                        : entry.level === OutputLevel.WARNING
                        ? 'text-yellow-600 dark:text-yellow-400'
                        : 'text-foreground'
                    }`}
                  >
                    {entry.isHtml ? (
                      <div dangerouslySetInnerHTML={{ __html: entry.message }} />
                    ) : (
                      entry.message
                    )}
                    {verificationResult !== null && !exam && (
                      <>
                        {verificationResult.isCorrect ? (
                          <span className="text-green-600 dark:text-green-400"> · &#10003; Correct!</span>
                        ) : (
                          <>
                            <span className="text-red-600 dark:text-red-400"> · &#10007; Not correct.</span>
                            {' '}
                            <button
                              className="text-red-600 dark:text-red-400 underline text-xs opacity-80 hover:opacity-100"
                              onClick={() => setVerificationResult(prev => prev ? { ...prev, showSolution: !prev.showSolution } : prev)}
                            >
                              {verificationResult.showSolution ? 'Hide solution' : 'Show solution'}
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                  {/* Solution reveal (below the stats line) */}
                  {verificationResult?.showSolution && solution && !exam && (
                    <pre className="mt-1 bg-black/10 dark:bg-white/10 rounded px-2 py-1 text-xs overflow-x-auto">{solution}</pre>
                  )}

                  {/* SQL Results Table */}
                  {entry.sqlResults && entry.sqlResults.length > 0 && (
                    <div className="mt-1">
                      {entry.sqlResults.map((resultSet, rsIndex) => (
                        <table key={rsIndex} className="w-max min-w-full border-collapse border border-border text-[11px] mb-2">
                          <thead className="bg-muted">
                            <tr>
                              {resultSet.columns.map((column, colIdx) => (
                                <th
                                  key={colIdx}
                                  className="border border-border px-1.5 py-0.5 text-left font-semibold"
                                >
                                  {column}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {resultSet.values.map((row, rowIdx) => (
                              <tr key={rowIdx} className="hover:bg-muted/50">
                                {row.map((cell, cellIdx) => (
                                  <td
                                    key={cellIdx}
                                    className="border border-border !text-[0.7rem] !text-center !p-[0.2rem]"
                                  >
                                    {cell === null ? (
                                      <span className="text-muted-foreground italic">NULL</span>
                                    ) : (
                                      String(cell)
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {pendingInput && (
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-muted-foreground font-mono text-sm">{'>'}</span>
                  <input
                    autoFocus
                    type="text"
                    className="flex-1 bg-transparent border-b border-muted-foreground/30 outline-none text-sm font-mono text-foreground"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const value = e.currentTarget.value
                        addOutput(value, OutputLevel.OUTPUT)
                        pendingInput.resolve(value)
                        setPendingInput(null)
                        pendingInputRef.current = null
                      }
                    }}
                  />
                </div>
              )}
          </div>
        ) : activePanel === 'history' ? (
          <div className="flex-1 overflow-x-auto overflow-y-hidden p-2">
            {/* Controls row: Save button + toggles */}
            <div className="flex items-center gap-4 px-2 pb-2 text-xs border-b mb-2">
              <Button
                onClick={() => createVersionSnapshot(true)}
                size="sm"
                variant="outline"
                className="h-7 px-2"
                title="Save version"
              >
                <Save className="w-3 h-3 mr-1" />
                Save
              </Button>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-foreground">Confirm deletion</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={confirmDeletion}
                  onClick={() => setConfirmDeletion(!confirmDeletion)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    confirmDeletion ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      confirmDeletion ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-foreground">Show local-only</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showAutosaves}
                  onClick={() => setShowAutosaves(!showAutosaves)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    showAutosaves ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      showAutosaves ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </label>
            </div>

            {versionsLoading && versions.length === 0 ? (
              // Only show the loading spinner on the FIRST fetch. Subsequent
              // refreshes (after delete/save/restore) keep the stale list
              // visible and swap in fresh data once it arrives, avoiding a
              // disorienting flash.
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-current" />
                <span className="ml-2">Loading versions...</span>
              </div>
            ) : versions.length === 0 ? (
              <div className="text-muted-foreground italic px-2">No saved versions yet. Click &quot;Save&quot; to create one.</div>
            ) : (
              <>
                {/* Version timeline */}
                <div className="flex gap-2 px-2 py-2 overflow-x-auto">
                {versions
                  // Synced rows (cloud icon) are always shown — they reflect
                  // explicit student actions that reached the server. Local
                  // rows (autosaves, failed manual POSTs on free tier, etc.)
                  // are gated behind the toggle.
                  .filter(v => showAutosaves || v.synced)
                  .map((version) => {
                  const date = new Date(version.createdAt)
                  const now = Date.now()
                  const diff = now - version.createdAt
                  const seconds = Math.floor(diff / 1000)
                  const minutes = Math.floor(seconds / 60)
                  const hours = Math.floor(minutes / 60)
                  const days = Math.floor(hours / 24)

                  const timeAgo =
                    seconds < 60 ? 'now' :
                    minutes < 60 ? `${minutes}m` :
                    hours < 24 ? `${hours}h` :
                    days < 7 ? `${days}d` :
                    date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

                  const isHighlighted = version.id != null && highlightedVersion === version.id
                  const isEditing = version.id != null && editingVersion === version.id

                  return (
                    <div
                      // Prefer the stable IndexedDB auto-increment id over
                      // versionNumber, which can collide if two parallel
                      // createVersion calls race (rare but seen in practice
                      // during fast-typing autosave bursts).
                      key={version.id ?? `v-${version.versionNumber}`}
                      className={`group relative flex-shrink-0 w-24 min-h-28 max-h-40 border rounded-lg p-3 transition-all flex flex-col items-center justify-center gap-1 ${
                        isHighlighted ? 'bg-primary/20 border-primary ring-2 ring-primary/50' : 'hover:bg-accent/50'
                      }`}
                    >
                      {/* Sync indicator (top-left): cloud = pushed to server
                          as a checkpoint, local-disk = local IndexedDB only.
                          Today only manual saves can sync; autosaves stay
                          local by design. The flag is persisted on the
                          version row so the badge survives reloads. */}
                      {/* Sync indicator (top-left). Synced rows show a blue
                          cloud (label only). Local rows show an orange disk
                          that's clickable — tapping it promotes the autosave
                          to a synced manual save while preserving the
                          displayed name. */}
                      {version.synced ? (
                        <div
                          className="absolute top-1 left-1 z-10 pointer-events-none text-primary"
                          title="Synced to server"
                        >
                          <Cloud className="w-5 h-5" />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation()
                            await promoteVersion(version)
                          }}
                          className="absolute top-1 left-1 z-20 text-orange-500 hover:text-orange-400 transition-colors"
                          title="Click to convert this autosave into a synced manual save"
                        >
                          <HardDrive className="w-5 h-5" />
                        </button>
                      )}

                      {/* Delete button - appears on hover. Positioned INSIDE
                          the card boundary because the version-list wrapper uses
                          `overflow-x-auto`, which per the CSS spec implicitly
                          clips the y-axis too — anchoring the button at
                          `-top-2 -right-2` previously hid it behind the clip. */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          const defaultName = defaultVersionLabels.get(version.id ?? `v-${version.versionNumber}`) ?? `v${version.versionNumber}`
                          const displayName = version.label || defaultName
                          const doDelete = async () => {
                            await deleteVersion({ id: version.id, versionNumber: version.versionNumber })
                            await refreshVersions()
                          }
                          if (confirmDeletion) {
                            dialog.showConfirm(
                              `Delete ${displayName}?`,
                              doDelete,
                              { destructive: true, title: 'Delete version', confirmText: 'Delete' }
                            )
                          } else {
                            await doDelete()
                          }
                        }}
                        disabled={isDeleting}
                        className="absolute top-1 right-1 z-20 w-5 h-5 bg-destructive text-destructive-foreground rounded-full items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hidden group-hover:flex hover:bg-destructive/90"
                        title="Delete version"
                      >
                        <X className="w-3 h-3" />
                      </button>

                      {/* Click to restore */}
                      <button
                        disabled={isRestoring || isEditing}
                        onClick={async () => {
                          if (version.id == null) return
                          const data = await restore(version.id)
                          if (data) {
                            // Restore the data to component state
                            if (data.files) {
                              setFiles(data.files)
                              filesRef.current = data.files
                              // Update editor content directly — setFiles alone may not
                              // trigger the sync effect if files state was already stale
                              const view = editorViewRef.current
                              const fileIdx = data.activeFileIndex ?? activeFileIndex
                              if (view && data.files[fileIdx]) {
                                view.dispatch(view.state.update({
                                  changes: { from: 0, to: view.state.doc.length, insert: data.files[fileIdx].content },
                                  annotations: programmaticChange.of(true)
                                }))
                              }
                            }
                            if (data.activeFileIndex !== undefined) setActiveFileIndex(data.activeFileIndex)
                            if (data.fontSize !== undefined) setFontSize(data.fontSize)
                            if (data.lineWrapping !== undefined) setLineWrapping(data.lineWrapping)
                            if (data.editorWidth !== undefined) setEditorWidth(data.editorWidth)
                            if (data.canvasTransform) setCanvasTransform(data.canvasTransform)
                            await refreshVersions()

                            // Highlight the restored version
                            if (version.id != null) {
                              setHighlightedVersion(version.id)
                              setTimeout(() => setHighlightedVersion(null), 2000)
                            }
                          }
                        }}
                        className="absolute inset-0 rounded-lg disabled:cursor-default"
                      />

                      {/* Editable version name */}
                      {isEditing ? (
                        <div className="flex flex-col items-center gap-1 w-full relative z-10">
                          <input
                            type="text"
                            value={editingLabel}
                            onChange={(e) => setEditingLabel(e.target.value)}
                            onBlur={async () => {
                              if (version.id != null) {
                                await updateLabel(version.id, editingLabel)
                                await refreshVersions()
                              }
                              setEditingVersion(null)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur()
                              } else if (e.key === 'Escape') {
                                setEditingVersion(null)
                              }
                            }}
                            autoFocus
                            placeholder={defaultVersionLabels.get(version.id ?? `v-${version.versionNumber}`) ?? `v${version.versionNumber}`}
                            className="w-full text-xs text-center bg-background border rounded px-1 py-0.5 font-bold"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="text-xs text-muted-foreground">{timeAgo}</div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1 w-full">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (version.id != null) setEditingVersion(version.id)
                              setEditingLabel(version.label || '')
                            }}
                            className="relative z-10 font-bold text-sm text-foreground w-full text-center px-1 hover:text-primary transition-colors line-clamp-2 cursor-text"
                            title="Click to rename version"
                          >
                            {version.label || defaultVersionLabels.get(version.id ?? `v-${version.versionNumber}`) || `v${version.versionNumber}`}
                          </button>
                          <div className="text-xs text-muted-foreground pointer-events-none">{timeAgo}</div>
                        </div>
                      )}
                    </div>
                  )
                })}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-2">
            {orphans.length === 0 ? (
              <div className="text-muted-foreground italic px-2 py-2 text-sm">
                No orphaned saves found for this page.
              </div>
            ) : (
              <>
                <div className="text-xs text-muted-foreground px-2 pb-2 border-b mb-2">
                  These editor IDs have saved versions in this browser but no
                  matching editor on the page. Click an ID to inspect the most
                  recent versions, then restore them onto this editor if you want.
                </div>
                {orphans.map((orphanId) => (
                  <OrphanRow
                    key={orphanId}
                    pageId={pageId!}
                    orphanId={orphanId}
                    onPreviewVersion={previewOrphanVersion}
                    onRestore={async () => {
                      await reassignHistory(orphanId)
                      await refreshVersions()
                      await refreshOrphans()
                      setActivePanel('history')
                    }}
                    onDelete={async () => {
                      // Order: history rows first (refCount-aware blob cleanup),
                      // then the main userData row. Orphan disappears from the
                      // list because detection runs against userData_history.
                      await userDataService.deleteAllVersions(pageId!, orphanId)
                      await userDataService.delete(pageId!, orphanId)
                      await refreshOrphans()
                    }}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>
      )}

      {/* Resize Handle (bottom-right corner) */}
      {!fullscreen && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
          title="Drag to resize"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
          >
            <path d="M9 1v8H1" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </div>
      )}

      {/* Persistent Comment Indicators - shown for highlights with comments
          Rendered inline (not portaled) so they get captured in snaps.
          z-index 10 keeps them above code but below snaps (z-50) and other overlays */}
      {commentIndicators.length > 0 && commentIndicators
        .filter(ind => ind.id !== hoveredHighlightId) // Don't show if already showing hover actions
        .map(indicator => (
          <div
            key={indicator.id}
            className="absolute w-3 h-3 bg-primary rounded-full flex items-center justify-center z-10 -translate-x-1 -translate-y-2 pointer-events-none"
            style={{
              left: `${indicator.x}px`,
              top: `${indicator.y}px`,
            }}
          >
            <MessageSquare className="w-2 h-2 text-primary-foreground" />
          </div>
        ))}

      {/* Highlight Action Buttons - Portal */}
      {hoveredHighlightId && deleteButtonPosition && !commentingHighlightId && typeof document !== 'undefined' && createPortal(
        <div
          className="highlight-actions fixed flex items-center gap-1 z-[9999]"
          style={{
            left: `${deleteButtonPosition.x - 24}px`, // Offset for both buttons
            top: `${deleteButtonPosition.y}px`,
          }}
          onMouseLeave={() => {
            // Check if we're back over a highlight, otherwise hide
            setTimeout(() => {
              const highlightEl = document.querySelector('[data-highlight-id]:hover')
              const actionsEl = document.querySelector('.highlight-actions:hover')
              if (!highlightEl && !actionsEl) {
                setHoveredHighlightId(null)
                setDeleteButtonPosition(null)
              }
            }, 50)
          }}
        >
          {/* Student's own highlights - show action buttons */}
          {highlights.find(h => h.id === hoveredHighlightId) && (
            <>
              {/* Comment button */}
              <button
                className="relative w-5 h-5 bg-background border border-border text-muted-foreground rounded-full flex items-center justify-center shadow-md hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                onClick={() => handleOpenComment(hoveredHighlightId)}
                title={highlights.find(h => h.id === hoveredHighlightId)?.comments?.length ? "Edit comment" : "Add comment"}
              >
                <MessageSquare className="w-3 h-3" />
                {/* Indicator dot if has comments */}
                {(highlights.find(h => h.id === hoveredHighlightId)?.comments?.length ?? 0) > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full" />
                )}
              </button>
              {/* Delete button - only show for your own highlights */}
              {highlights.find(h => h.id === hoveredHighlightId)?.authorId === currentAuthorId && (
                <button
                  className="w-5 h-5 bg-background border border-border text-muted-foreground rounded-full flex items-center justify-center shadow-md hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                  onClick={() => handleDeleteHighlight(hoveredHighlightId)}
                title="Remove highlight"
              >
                <X className="w-3 h-3" />
              </button>
              )}
              {/* Comments preview tooltip */}
              {(highlights.find(h => h.id === hoveredHighlightId)?.comments?.length ?? 0) > 0 && (
                <div className="absolute top-6 right-0 w-48 p-2 bg-background border border-border rounded shadow-lg text-xs max-h-32 overflow-y-auto space-y-2">
                  {highlights.find(h => h.id === hoveredHighlightId)?.comments?.map(comment => (
                    <div key={comment.id} className="text-muted-foreground whitespace-pre-wrap">
                      {comment.text}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {/* Teacher highlights - show comments read-only (no action buttons) */}
          {!highlights.find(h => h.id === hoveredHighlightId) && (() => {
            const teacherHighlight = teacherHighlightsForEditor.find(h => h.id === hoveredHighlightId)
            if (!teacherHighlight?.comments?.length) return null
            return (
              <div className="w-48 p-2 bg-background border border-border rounded shadow-lg text-xs max-h-32 overflow-y-auto space-y-2">
                <div className="text-muted-foreground/70 text-[10px] uppercase tracking-wide mb-1">Teacher comment</div>
                {teacherHighlight.comments.map(comment => (
                  <div key={comment.id} className="text-muted-foreground whitespace-pre-wrap">
                    {comment.text}
                  </div>
                ))}
              </div>
            )
          })()}
        </div>,
        document.body
      )}

      {/* Comment Popover - Portal */}
      {commentingHighlightId && commentPopoverPosition && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[10000] bg-background border border-border rounded-lg shadow-lg p-2 w-64"
          style={{
            left: `${commentPopoverPosition.x}px`,
            top: `${commentPopoverPosition.y}px`,
          }}
        >
          <textarea
            ref={commentInputRef}
            className="w-full h-20 text-sm bg-muted/50 border border-border rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Add a comment..."
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSaveComment()
              } else if (e.key === 'Escape') {
                handleCancelComment()
              }
            }}
          />
          <div className="flex justify-end gap-1 mt-2">
            <button
              className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={handleCancelComment}
            >
              Cancel
            </button>
            <button
              className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
              onClick={handleSaveComment}
            >
              Save
            </button>
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to save
          </div>
        </div>,
        document.body
      )}
    </div>

    {/* Python check test results */}
    {hasChecks && checkResults && !exam && (
      <>
        {isStaged && (
          <div className="mt-2 text-xs font-medium text-muted-foreground">
            Stage {Math.min(currentStage + 1, stages.length)} of {stages.length}
            {activeStage?.label ? `: ${activeStage.label}` : ''}
          </div>
        )}
        <PythonTestResults
          results={checkResults}
          points={effectiveCheckPoints ?? checkResults.length}
          earnedPoints={checkResults.length > 0
            ? Math.round((checkResults.filter(r => r.passed).length / checkResults.length) * (effectiveCheckPoints ?? checkResults.length))
            : 0}
          checksUsed={checksUsed}
          maxChecks={effectiveMaxChecks ?? null}
          celebrationToken={celebrationToken}
        />
      </>
    )}

    {/* Snapshot history — teacher viewing a student. A compact read-only list of
        the student's saved snapshots, sat between the editor and the points box;
        click any to load it into the editor (above). Editing surfaces Revert.
        Nothing here mutates a snapshot. */}
    {isViewingSnapshot && (
      <div className="mt-1.5 rounded-md border bg-card px-1.5 py-1 text-[11px]">
        <div className="flex items-center justify-between gap-2 px-0.5 min-h-[20px] text-muted-foreground">
          <span className="font-medium uppercase tracking-wide text-[10px]">
            Snapshots{editedSinceSnapshot && <span className="ml-1 normal-case tracking-normal text-amber-600 dark:text-amber-400">· edited (not saved)</span>}
          </span>
          {editedSinceSnapshot && (
            <button
              type="button"
              onClick={revertSnapshot}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-foreground hover:bg-accent/50"
            >
              <RotateCcw className="w-3 h-3" /> Revert
            </button>
          )}
        </div>
        {snapList.length === 0 ? (
          <div className="px-1 py-0.5 text-muted-foreground">
            {snapshotLoading ? 'Loading…' : 'No saved snapshots for this student.'}
          </div>
        ) : (
          <ul className="!m-0 !mt-0.5 !p-0 !list-none max-h-[5.5rem] overflow-y-auto">
            {snapList.map((s) => {
              const active = (viewedSnapshotId ?? snapList[0].id) === s.id
              return (
                <li key={s.id} className="!m-0 !p-0 !list-none marker:content-['']">
                  <button
                    type="button"
                    onClick={() => viewSnapshot(s)}
                    className={cn(
                      'w-full flex items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] leading-tight hover:bg-accent/50',
                      active && 'bg-amber-50 dark:bg-amber-950/30 font-medium',
                    )}
                  >
                    <span className="uppercase text-[9px] tracking-wide text-muted-foreground w-14 flex-shrink-0 whitespace-nowrap">{s.kind}</span>
                    <span className="truncate flex-1 text-[11px]">{s.label ?? ''}</span>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0 tabular-nums">{new Date(s.createdAt).toLocaleTimeString()}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )}

    {/* In-exam grade badge for python-check exercises — teacher grading or
        student reviewing a returned exam. Self-hides when no review is active. */}
    {hasChecks && <GradeBadge componentId={pythonCheckComponentId} />}

    {/* Teacher class-overview progress — only in the "class overview" mode
        (no student selected). When viewing/grading one student we show their
        answer + grade badge instead, so hide the class dropdown. */}
    {solution && pageId && isTeacher && selectedClass && !isViewingSnapshot && (
      <SqlProgressBar
        classId={selectedClass.id}
        className={selectedClass.name}
        pageId={pageId}
        componentId={verificationComponentId}
      />
    )}

    {/* Teacher class progress for Python check exercises */}
    {hasChecks && pageId && isTeacher && selectedClass && !isViewingSnapshot && (
      <PythonProgressBar
        classId={selectedClass.id}
        className={selectedClass.name}
        pageId={pageId}
        componentId={pythonCheckComponentId}
      />
    )}

    {/* Scope-promotion confirm modal. Always shown on scope change for consistency.
        Files >1MB get an extra red warning since promoting them widens the load
        cost across more editors. */}
    {pendingScopeChange && typeof document !== 'undefined' && createPortal(
      <div
        className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40"
        onClick={(e) => { if (e.target === e.currentTarget) setPendingScopeChange(null) }}
      >
        <div className="bg-popover border rounded-lg shadow-xl p-4 max-w-sm w-[90%]">
          <h3 className="text-sm font-semibold mb-2">Move file scope?</h3>
          <p className="text-sm text-muted-foreground mb-3">
            <span className="font-mono">{pendingScopeChange.name}</span>
            {' '}({formatBytes(pendingScopeChange.sizeBytes)}) will be available in{' '}
            <strong className="text-foreground">
              {pendingScopeChange.toScope === 'editor' && 'this editor only'}
              {pendingScopeChange.toScope === 'skript' && 'every Python editor in this skript'}
              {pendingScopeChange.toScope === 'global' && 'every Python editor everywhere'}
            </strong>.
          </p>
          {pendingScopeChange.sizeBytes > 1024 * 1024 && (
            <p className="text-xs text-red-600 dark:text-red-400 mb-3 border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 rounded p-2">
              Large files load every time these editors run. Promoting may slow them down.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setPendingScopeChange(null)}
              className="px-3 py-1 text-sm rounded hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={applyScopeChange}
              className="px-3 py-1 text-sm rounded bg-amber-600 hover:bg-amber-700 text-white"
            >
              Move
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}
    <AlertDialogModal
      open={dialog.open} onOpenChange={dialog.setOpen}
      type={dialog.type} title={dialog.title} message={dialog.message}
      onConfirm={dialog.onConfirm} showCancel={dialog.showCancel}
      confirmText={dialog.confirmText} cancelText={dialog.cancelText}
      destructive={dialog.destructive}
    />
    </>
  )
})
