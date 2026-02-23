"use client"

import { useEffect, useLayoutEffect, useRef, useState, useCallback, memo, useMemo } from 'react'
import { nanoid } from 'nanoid'
import { createPortal } from 'react-dom'
import { useTheme } from 'next-themes'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Annotation, Compartment } from '@codemirror/state'
import { indentUnit } from '@codemirror/language'
import { indentWithTab, undo } from '@codemirror/commands'
import { createLogger } from '@/lib/logger'

const log = createLogger('editor:codemirror')
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { sql } from '@codemirror/lang-sql'
import { vsCodeDark } from '@fsegurai/codemirror-theme-vscode-dark'
import { vsCodeLight } from '@fsegurai/codemirror-theme-vscode-light'
import { basicSetup } from 'codemirror'
import { autocompletion } from '@codemirror/autocomplete'
import { pythonCompletions } from './python-completions'
import { Button } from '@/components/ui/button'
import { Play, Square, RotateCcw, Maximize2, Minimize2, Camera, X, Plus, FileText, ZoomIn, ZoomOut, Save, History, Highlighter, MessageSquare, WrapText, Circle, CheckCircle2 } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { useUserData, useCreateVersion, useVersionHistory, useRestoreVersion, useDeleteVersion, useUpdateVersionLabel } from '@/lib/userdata/hooks'
import { useSyncedUserData, type SyncedUserDataOptions } from '@/lib/userdata/provider'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { useTeacherBroadcast } from '@/hooks/use-teacher-broadcast'
import { useSession } from 'next-auth/react'
import type { CodeEditorData, CodeHighlight, HighlightColor, HighlightComment, SqlVerificationData } from '@/lib/userdata/types'

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

interface CodeEditorProps {
  id?: string
  pageId?: string
  language?: 'python' | 'javascript' | 'sql'
  initialCode?: string
  showCanvas?: boolean
  db?: string // Path to SQL database for SQL language
  schemaImage?: string // Optional schema image for SQL (light theme)
  schemaImageDark?: string // Optional schema image for SQL (dark theme)
  singleFile?: boolean // Hide file tabs for simple single-file examples
  solution?: string // Expected SQL solution for automatic pass/fail verification
}

// Custom annotation to mark programmatic changes (defined once outside component)
const programmaticChange = Annotation.define<boolean>()

// Highlight colors for cursor (URL-encoded hex values)
const highlightColorHex: Record<HighlightColor, string> = {
  red: '%23ef4444', yellow: '%23eab308', green: '%2322c55e', blue: '%233b82f6'
}

// Static preload functions (no component state, safe to call from IntersectionObserver)
// These mirror ensurePyodideLoaded/ensureSkulptLoaded but without UI feedback

/**
 * Preload Pyodide runtime in background. Safe to call multiple times.
 * Returns a promise that resolves when Pyodide is ready.
 */
function preloadPyodide(): Promise<unknown> {
  if ((window as any).__pyodidePromise) {
    return (window as any).__pyodidePromise
  }

  // Load script if not present
  if (!document.querySelector('script[src*="pyodide.js"]')) {
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/pyodide/v0.29.0/full/pyodide.js'
    document.body.appendChild(script)

    return new Promise((resolve, reject) => {
      script.onload = () => {
        // Initialize Pyodide after script loads
        ;(window as any).__pyodidePromise = (window as any).loadPyodide({
          indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.29.0/full/'
        })
        ;(window as any).__pyodidePromise.then(resolve).catch(reject)
      }
      script.onerror = () => reject(new Error('Failed to load Pyodide'))
    })
  }

  // Script exists but promise not set - initialize
  if (!(window as any).__pyodidePromise && (window as any).loadPyodide) {
    ;(window as any).__pyodidePromise = (window as any).loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.29.0/full/'
    })
  }

  return (window as any).__pyodidePromise || Promise.resolve()
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

/**
 * Compare two SQL result sets for equality.
 * Row-order sensitive, string-coerced values.
 */
function compareResultSets(a: SqlResultSet[], b: SqlResultSet[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].columns.length !== b[i].columns.length) return false
    if (a[i].columns.some((col, j) => col !== b[i].columns[j])) return false
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
  language = 'python',
  initialCode = '# Write your code here\nprint("Hello, World!")',
  showCanvas = true,
  db = '/sql/netflixdb.sqlite',
  schemaImage,
  schemaImageDark,
  singleFile = false,
  solution,
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme()
  const { data: session } = useSession()
  const { selectedClass, selectedStudent, viewMode, isTeacher } = useTeacherClass()
  const [mounted, setMounted] = useState(false)
  const [runState, setRunState] = useState<RunState>(RunState.STOPPED)
  const [output, setOutput] = useState<OutputEntry[]>([])
  const [verificationResult, setVerificationResult] = useState<{ isCorrect: boolean; showSolution: boolean } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  // User data persistence - only if pageId is provided
  const componentId = `code-editor-${id}`
  const highlightsComponentId = `code-highlights-${id}` // Separate adapter for broadcast highlights
  const verificationComponentId = `sql-verification-${id}`
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

  // Compute targeting options for broadcast highlights
  // ARCHITECTURE: Mirrors annotation-layer.tsx pattern for consistency.
  // When teacher switches modes, they edit different database records:
  // - my-view: personal highlights (no targeting)
  // - class-broadcast: highlights visible to all class members
  // - student-view: individual feedback for one student
  // See: src/components/annotations/annotation-layer.tsx:343
  const syncOptions: SyncedUserDataOptions = useMemo(() => {
    if (!isTeacher) return {}

    if (viewMode === 'class-broadcast' && selectedClass) {
      return { targetType: 'class' as const, targetId: selectedClass.id }
    }
    if (viewMode === 'student-view' && selectedStudent) {
      return { targetType: 'student' as const, targetId: selectedStudent.id }
    }
    return {} // my-view: personal highlights (no targeting)
  }, [isTeacher, viewMode, selectedClass, selectedStudent])

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

  // For students: receive teacher broadcasts (code highlights)
  // LIMITATION: This fetches ALL teacher broadcasts for the page, even if the page
  // has multiple code editors. We filter by editorId below which is O(n) per editor.
  const isStudent = session?.user?.accountType === 'student'

  const broadcastPageId = isStudent && pageId ? pageId : ''

  const {
    classCodeHighlights: teacherClassHighlights,
    individualCodeHighlights: teacherIndividualHighlights,
  } = useTeacherBroadcast(broadcastPageId)

  // Extract teacher highlights for THIS specific code editor
  // PERFORMANCE: O(n) where n = total teacher highlights across all editors on page.
  // Acceptable since pages typically have <5 editors and <50 highlights total.
  // If this becomes a bottleneck, consider pre-grouping by editorId in the API response.
  const teacherHighlightsForEditor = useMemo(() => {
    if (!isStudent) return []

    const highlights: CodeHighlight[] = []

    // Class broadcasts (from enrolled classes)
    // NOTE: A student could be in multiple classes that broadcast to the same page.
    // Currently we show all of them - no deduplication by highlight ID.
    for (const classHighlight of teacherClassHighlights) {
      if (classHighlight.editorId === id) {
        const data = classHighlight.data as BroadcastHighlightsData | null
        if (data?.highlights) {
          highlights.push(...data.highlights.map(h => ({
            ...h,
            isTeacherHighlight: true,
          } as CodeHighlight & { isTeacherHighlight: boolean })))
        }
      }
    }

    // Individual feedback (from teacher to this student)
    for (const individualHighlight of teacherIndividualHighlights) {
      if (individualHighlight.editorId === id) {
        const data = individualHighlight.data as BroadcastHighlightsData | null
        if (data?.highlights) {
          highlights.push(...data.highlights.map(h => ({
            ...h,
            isTeacherHighlight: true,
          } as CodeHighlight & { isTeacherHighlight: boolean })))
        }
      }
    }

    return highlights
  }, [isStudent, teacherClassHighlights, teacherIndividualHighlights, id])

  // Version history hooks
  const createVersion = useCreateVersion<CodeEditorData>(pageId || 'no-page', componentId)
  const { versions, isLoading: versionsLoading, refresh: refreshVersions } = useVersionHistory(pageId || 'no-page', componentId)
  const { restore, isRestoring } = useRestoreVersion<CodeEditorData>(pageId || 'no-page', componentId)
  const { deleteVersion, isDeleting } = useDeleteVersion(pageId || 'no-page', componentId)
  const updateLabel = useUpdateVersionLabel(pageId || 'no-page', componentId)

  // Output/History panel state
  const [activePanel, setActivePanel] = useState<'output' | 'history'>('output')
  const [panelVisible, setPanelVisible] = useState(false)
  const [highlightedVersion, setHighlightedVersion] = useState<number | null>(null)
  const [editingVersion, setEditingVersion] = useState<number | null>(null)
  const [editingLabel, setEditingLabel] = useState<string>('')
  const [confirmDeletion, setConfirmDeletion] = useState(false)
  const [showAutosaves, setShowAutosaves] = useState(false)

  // Keystroke counter for version creation
  const keystrokeCountRef = useRef(0)

  // Helper to get file extension based on language
  const getFileExtension = (lang: 'python' | 'javascript' | 'sql'): string => {
    switch (lang) {
      case 'python': return '.py'
      case 'javascript': return '.js'
      case 'sql': return '.sql'
    }
  }

  // Initialize default data
  const defaultData: CodeEditorData = {
    files: [{ name: `main${getFileExtension(language)}`, content: initialCode }],
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
  const currentCode = files[activeFileIndex]?.content || initialCode
  const hasTurtleModule = language === 'python' && /import\s+turtle|from\s+turtle/.test(currentCode)
  const hasMatplotlib = language === 'python' && /import\s+matplotlib|from\s+matplotlib/.test(currentCode)
  // SQL schema: provided via schemaImage/schemaImageDark props (auto-detected in markdown renderer)
  const hasSqlSchema = language === 'sql' && !!(schemaImage || schemaImageDark)
  const hasGraphics = hasTurtleModule || hasMatplotlib || hasSqlSchema
  const showEditor = containerRef.current ? (editorWidth / 100) * containerRef.current.offsetWidth >= MIN_VISIBLE_WIDTH : true
  const showGraphics = containerRef.current ? ((100 - editorWidth) / 100) * containerRef.current.offsetWidth >= MIN_VISIBLE_WIDTH : true
  const [canvasVisible, setCanvasVisible] = useState(false) // Start hidden, show only when graphics detected

  // Calculate auto-height based on number of lines in the code (editor area only, output adds separately)
  const lineCount = currentCode.split('\n').length
  const fileTabsHeight = singleFile ? 0 : 36 // height of file tabs row
  const calculatedEditorHeight = Math.max(
    MIN_EDITOR_HEIGHT,
    Math.min(MAX_EDITOR_HEIGHT, lineCount * LINE_HEIGHT + fileTabsHeight + 60) // 60px for controls
  )
  // User-adjusted editor height (set when dragging horizontal splitter, keeps total constant)
  const [userEditorHeight, setUserEditorHeight] = useState<number | null>(null)
  const editorHeight = userEditorHeight ?? calculatedEditorHeight
  // Output panel adds to total height when visible
  const totalHeight = editorHeight + (panelVisible ? outputPanelHeight + 4 : 0) // +4 for horizontal splitter

  // Font size state
  const [fontSize, setFontSize] = useState<number>(defaultData.fontSize ?? 14)

  // Line wrapping state
  const [lineWrapping, setLineWrapping] = useState<boolean>(defaultData.lineWrapping ?? false)

  // Canvas pan and zoom state
  const [canvasTransform, setCanvasTransform] = useState(defaultData.canvasTransform ?? { x: 0, y: 0, scale: 1 })

  // Store the original initial code for reset functionality
  // This is the source of truth from the markdown and should never change
  const originalInitialCode = useRef(initialCode)
  const hasLoadedData = useRef(false)

  // Update original code when initialCode prop changes (markdown was edited)
  useEffect(() => {
    originalInitialCode.current = initialCode
  }, [initialCode])

  useEffect(() => {
    // Only restore once when data first loads
    if (!isLoading && savedData && !hasLoadedData.current) {
      hasLoadedData.current = true

      // Check if the markdown content has changed since the data was saved
      // If the first file's content from saved data matches the original initialCode,
      // it's safe to restore. Otherwise, prefer the new markdown content.
      const savedFirstFileContent = savedData.files?.[0]?.content
      const markdownHasChanged = savedFirstFileContent && savedFirstFileContent !== initialCode

      if (markdownHasChanged) {
        // Markdown was updated - don't restore old saved content
        // But do restore other settings like fontSize, editorWidth, etc.
        if (savedData.fontSize !== undefined) setFontSize(savedData.fontSize)
        if (savedData.lineWrapping !== undefined) setLineWrapping(savedData.lineWrapping)
        if (savedData.editorWidth !== undefined) setEditorWidth(savedData.editorWidth)
        if (savedData.canvasTransform) setCanvasTransform(savedData.canvasTransform)
        // Don't restore highlights when markdown changed - they'd be at wrong positions
      } else {
        // Markdown unchanged - safe to restore everything
        if (savedData.files) setFiles(savedData.files)
        if (savedData.activeFileIndex !== undefined) setActiveFileIndex(savedData.activeFileIndex)
        if (savedData.fontSize !== undefined) setFontSize(savedData.fontSize)
        if (savedData.lineWrapping !== undefined) setLineWrapping(savedData.lineWrapping)
        if (savedData.editorWidth !== undefined) setEditorWidth(savedData.editorWidth)
        if (savedData.canvasTransform) setCanvasTransform(savedData.canvasTransform)
        // Only load personal highlights if NOT in broadcast mode
        if (savedData.highlights && !isBroadcastMode) {
          setHighlights(savedData.highlights)
        }
      }
    }
  }, [isLoading, savedData, componentId, pageId, initialCode, isBroadcastMode])

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

  const debouncedSaveContent = useCallback(() => {
    if (!editorViewRef.current) return

    const view = editorViewRef.current
    const cursor = view.state.selection.main.head
    log('debounced save — syncing content to files state', { id, cursor })

    const content = view.state.doc.toString()
    setFiles(prev => prev.map((file, idx) =>
      idx === activeFileIndex ? { ...file, content } : file
    ))

    // Check cursor after state update (next microtask)
    queueMicrotask(() => {
      if (editorViewRef.current) {
        const newCursor = editorViewRef.current.state.selection.main.head
        if (newCursor !== cursor) {
          log.warn('CURSOR MOVED after debounced save!', { before: cursor, after: newCursor })
        }
      }
    })
  }, [activeFileIndex, id])

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
  useEffect(() => {
    // Only save if pageId is provided (not in fallback mode)
    if (!pageId) return

    // Don't save during initial load - wait until data has been loaded/restored
    if (isLoading) {
      return
    }

    // In broadcast mode: save highlights to broadcast record, personal data keeps other settings
    // In personal mode: save everything to personal record
    if (isBroadcastMode) {
      // Save highlights to broadcast record
      updateBroadcastHighlights({ highlights }, { immediate: true })

      // Save personal data WITHOUT highlights (keep them separate)
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
  }, [activeFileIndex, fontSize, lineWrapping, editorWidth, canvasTransform, pageId, savePersistentData, files, componentId, isLoading, highlights, isBroadcastMode, updateBroadcastHighlights, savedData?.highlights])

  // Helper function to create a version snapshot
  const createVersionSnapshot = useCallback(async (isManualSave = false) => {
    if (!pageId) return

    const dataToVersion: CodeEditorData = {
      files,
      activeFileIndex,
      fontSize,
      lineWrapping,
      editorWidth,
      canvasTransform,
      highlights,
    }

    // Don't create version if content matches initial/default code
    const currentContent = files.map(f => f.content).join('\n')
    const isDefaultContent = currentContent === initialCode || currentContent.trim() === ''
    if (isDefaultContent) {
      keystrokeCountRef.current = 0
      return
    }

    // Note: Duplicate detection is handled by the service layer via SHA-256 hashing
    // If the data is identical to a previous version, it will reuse the same blob
    const version = await createVersion(dataToVersion, { isManualSave })
    await refreshVersions()
    keystrokeCountRef.current = 0 // Reset counter after creating version

    // Only open history tab for manual saves
    if (isManualSave) {
      setActivePanel('history')
      setHighlightedVersion(version.versionNumber)
      // Clear highlight after 2 seconds
      setTimeout(() => setHighlightedVersion(null), 2000)
    }
  }, [pageId, files, activeFileIndex, fontSize, lineWrapping, editorWidth, canvasTransform, highlights, createVersion, refreshVersions, initialCode])

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
  const handleHorizontalSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDraggingHorizontalSplitter(true)
  }

  const handleHorizontalSplitterTouchStart = (e: React.TouchEvent) => {
    e.preventDefault()
    setIsDraggingHorizontalSplitter(true)
  }

  useEffect(() => {
    if (!isDraggingHorizontalSplitter) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!wrapperRef.current) return

      const wrapperRect = wrapperRef.current.getBoundingClientRect()
      const currentTotalHeight = wrapperRect.height

      // Calculate new output height from cursor position
      const newOutputHeight = Math.max(MIN_OUTPUT_HEIGHT, Math.min(MAX_OUTPUT_HEIGHT, wrapperRect.bottom - e.clientY))

      // Calculate new editor height to keep total constant
      const splitterHeight = 4
      const newEditorHeight = currentTotalHeight - newOutputHeight - splitterHeight

      // Only apply if editor height is reasonable
      if (newEditorHeight >= MIN_EDITOR_HEIGHT) {
        setOutputPanelHeight(newOutputHeight)
        setUserEditorHeight(newEditorHeight)
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!wrapperRef.current || !e.touches[0]) return

      const wrapperRect = wrapperRef.current.getBoundingClientRect()
      const currentTotalHeight = wrapperRect.height

      // Calculate new output height from touch position
      const newOutputHeight = Math.max(MIN_OUTPUT_HEIGHT, Math.min(MAX_OUTPUT_HEIGHT, wrapperRect.bottom - e.touches[0].clientY))

      // Calculate new editor height to keep total constant
      const splitterHeight = 4
      const newEditorHeight = currentTotalHeight - newOutputHeight - splitterHeight

      // Only apply if editor height is reasonable
      if (newEditorHeight >= MIN_EDITOR_HEIGHT) {
        setOutputPanelHeight(newOutputHeight)
        setUserEditorHeight(newEditorHeight)
      }
    }

    const handleMouseUp = () => {
      setIsDraggingHorizontalSplitter(false)
    }

    const handleTouchEnd = () => {
      setIsDraggingHorizontalSplitter(false)
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
  }, [isDraggingHorizontalSplitter])

  // Handle resize handle dragging (bottom-right corner)
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDraggingResize(true)
  }

  useEffect(() => {
    if (!isDraggingResize) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!wrapperRef.current) return

      const wrapperRect = wrapperRef.current.getBoundingClientRect()
      // Calculate new height based on mouse position relative to wrapper top
      const newHeight = e.clientY - wrapperRect.top

      // Clamp between min and a reasonable max
      setManualHeight(Math.max(MIN_EDITOR_HEIGHT, Math.min(800, newHeight)))
    }

    const handleMouseUp = () => {
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
    setMounted(true)
  }, [])

  // Preload runtime in background on mount (before user clicks Run)
  // This runs asynchronously and doesn't block the UI
  useEffect(() => {
    if (language === 'python') {
      // Check if code uses turtle module - same logic as runCode()
      const hasTurtle = /import\s+turtle|from\s+turtle/.test(initialCode)
      if (hasTurtle) {
        preloadSkulpt().catch(() => {})
      } else {
        preloadPyodide().catch(() => {})
      }
    }
    // SQL preloading is handled below with the database
  }, [language, initialCode])

  // Load SQL database when in SQL mode
  useEffect(() => {
    if (language === 'sql' && db && mounted) {
      // Dynamic import to avoid SSR issues
      import('@/lib/sql-executor.client').then(({ loadDatabase }) => {
        loadDatabase(db).then(() => {
          setDbStatus('ready')
        }).catch((error) => {
          addOutput(`Failed to load database: ${error.message}`, OutputLevel.ERROR)
        })
      })
    }
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

  // Lazy load Pyodide on first run
  const ensurePyodideLoaded = async () => {
    // Return existing promise if already loading/loaded
    if ((window as any).__pyodidePromise) {
      setActiveKernel('pyodide')
      return (window as any).__pyodidePromise
    }

    // Start loading
    setKernelLoading(true)

    try {
      // Load Pyodide script if not already present
      if (!document.querySelector('script[src*="pyodide.js"]')) {
        const script = document.createElement('script')
        script.src = 'https://cdn.jsdelivr.net/pyodide/v0.29.0/full/pyodide.js'

        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve()
          script.onerror = () => reject(new Error('Failed to load Pyodide'))
          document.body.appendChild(script)
        })
      }

      // Initialize Pyodide
      if (!(window as any).__pyodidePromise) {
        ;(window as any).__pyodidePromise = (window as any).loadPyodide({
          indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.29.0/full/'
        })
      }

      const pyodide = await (window as any).__pyodidePromise
      setActiveKernel('pyodide')
      setKernelLoading(false)
      return pyodide
    } catch (error) {
      setKernelLoading(false)
      addOutput('Failed to load Python runtime', OutputLevel.ERROR)
      throw error
    }
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

  useEffect(() => {
    if (!editorRef.current || !mounted) return
    log('EDITOR CREATE — destroying and recreating editor', { id, language, activeFileIndex })

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
      }),
      // Dynamic compartments — reconfigured without destroying the editor
      fontSizeCompartment.current.of(EditorView.theme({
        '.cm-content': { fontSize: `${fontSize}px` }
      })),
      themeCompartment.current.of(isDark ? vsCodeDark : vsCodeLight),
      lineWrappingCompartment.current.of(lineWrapping ? EditorView.lineWrapping : []),
    ]

    // Add Python autocomplete for Python files
    if (language === 'python') {
      extensions.push(
        autocompletion({
          override: [pythonCompletions],
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
            // Increment keystroke counter
            keystrokeCountRef.current++

            // Create version every 5 keystrokes
            if (keystrokeCountRef.current >= 5) {
              createVersionSnapshotRef.current()
            }

            // Clear existing timeout
            if (contentSaveTimeoutRef.current) {
              clearTimeout(contentSaveTimeoutRef.current)
            }

            // Debounce save by 2 seconds after typing stops
            contentSaveTimeoutRef.current = setTimeout(() => {
              debouncedSaveContentRef.current()
            }, 2000)
          }
        }

      })
    )

    // Debug: detect cursor jumps to position 0 (focus loss symptom)
    let lastCursor = -1
    extensions.push(
      EditorView.updateListener.of((update) => {
        const cursor = update.state.selection.main.head
        if (lastCursor > 0 && cursor === 0 && !update.docChanged) {
          log.warn('CURSOR JUMPED TO 0 without doc change!', {
            id,
            lastCursor,
            focused: update.view.hasFocus,
            transactions: update.transactions.length,
          })
          // Log stack trace to find the caller
          console.trace('[editor:codemirror] cursor jump stack trace')
        }
        lastCursor = cursor
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
      if (editorViewRef.current) {
        editorViewRef.current.destroy()
        editorViewRef.current = null
      }
      // Clear any pending auto-save
      if (contentSaveTimeoutRef.current) {
        clearTimeout(contentSaveTimeoutRef.current)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- theme/fontSize/lineWrapping use Compartments below; files/debouncedSaveContent use refs
  }, [mounted, language, initialCode, activeFileIndex])

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
        EditorView.theme({ '.cm-content': { fontSize: `${fontSize}px` } })
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

  // Add output helper
  const addOutput = (message: string, level: OutputLevel = OutputLevel.OUTPUT) => {
    setOutput((prev) => [...prev, { message, level, timestamp: Date.now() }])
    setPanelVisible(true)
    setActivePanel('output')
  }

  // Save current file content
  const saveCurrentFile = () => {
    if (editorViewRef.current) {
      const content = editorViewRef.current.state.doc.toString()
      setFiles(prev => prev.map((file, idx) =>
        idx === activeFileIndex ? { ...file, content } : file
      ))
    }
  }

  // Switch to a different file
  const switchToFile = (index: number) => {
    saveCurrentFile()
    setActiveFileIndex(index)
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

  // Update editor when active file changes
  useEffect(() => {
    if (editorViewRef.current && files[activeFileIndex]) {
      const content = files[activeFileIndex].content
      const view = editorViewRef.current
      const transaction = view.state.update({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: content
        },
        annotations: programmaticChange.of(true)
      })
      view.dispatch(transaction)
    }
  }, [activeFileIndex, files])

  // Run code
  const runCode = () => {
    if (!editorViewRef.current) return

    // Save current file before running
    saveCurrentFile()

    const code = editorViewRef.current.state.doc.toString()

    if (language === 'python') {
      // Decide which runtime to use based on current editor content (not saved state)
      // This allows switching between Skulpt and Pyodide when code changes
      const hasTurtle = /import\s+turtle|from\s+turtle/.test(code)

      if (hasTurtle) {
        runPythonCode(code) // Use Skulpt for turtle
      } else {
        runPyodideCode(code) // Use Pyodide for everything else (including matplotlib)
      }
    } else if (language === 'sql') {
      runSqlQuery(code)
    } else if (language === 'javascript') {
      // TODO: Implement JavaScript execution
      addOutput('JavaScript execution not yet implemented', OutputLevel.ERROR)
    }
  }

  // Run SQL query
  const runSqlQuery = async (query: string) => {
    setRunState(RunState.RUNNING)
    setOutput([]) // Clear previous output
    setVerificationResult(null) // Reset verification on each run

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
        read: (filename: string) => {
          // Extract just the base filename (remove directory paths)
          const baseName = filename.split('/').pop() || filename
          const ext = getFileExtension(language)
          const extPattern = new RegExp(`\\${ext}$`)

          // Try to match with or without extension
          const userFile = files.find(f => {
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

      // Configure turtle graphics if canvas exists
      if (canvas) {
        ;(Sk.TurtleGraphics ||= {
          width: canvas.clientWidth || 500,
          height: canvas.clientHeight || 400,
        }).target = canvas

        // Center the canvas after Skulpt creates it
        // Wait for the canvas element to be created
        setTimeout(() => {
          const turtleCanvas = canvas.querySelector('canvas')
          const container = canvasContainerRef.current
          if (turtleCanvas && container) {
            const containerRect = container.getBoundingClientRect()
            const canvasWidth = turtleCanvas.width
            const canvasHeight = turtleCanvas.height
            const centerX = (containerRect.width - canvasWidth) / 2
            const centerY = (containerRect.height - canvasHeight) / 2
            setCanvasTransform({ x: centerX, y: centerY, scale: 1 })
          }
        }, 100)
      }

      const promise = Sk.misceval.asyncToPromise(() => {
        return Sk.importMainWithBody('<stdin>', false, code, true)
      })

      promise.then(
        () => {
          // Show success flash on Run button
          setShowSuccessFlash(true)
          setTimeout(() => setShowSuccessFlash(false), 1500)
          setRunState(RunState.STOPPED)
        },
        (err: SkulptError) => {
          if (err.tp$name === 'TimeoutError' && Sk.execLimit === 1) {
            addOutput('Program stopped', OutputLevel.WARNING)
          } else {
            addOutput(err.toString(), OutputLevel.ERROR)
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
    setOutput([]) // Clear previous output

    // Clear previous matplotlib plots
    if (canvasRef.current) {
      canvasRef.current.querySelectorAll('.matplotlib-plot').forEach(el => el.remove())
    }

    try {
      // Ensure Pyodide is loaded
      const pyodide = await ensurePyodideLoaded()

      if (!pyodide) {
        addOutput('Pyodide runtime not loaded yet', OutputLevel.ERROR)
        setRunState(RunState.STOPPED)
        return
      }

      // Detect and load required packages
      const packagesToLoad: string[] = []
      const packageMap: Record<string, string> = {
        'matplotlib': 'matplotlib',
        'numpy': 'numpy',
        'pandas': 'pandas',
        'scipy': 'scipy',
        'sympy': 'sympy',
        'scikit-learn': 'scikit-learn',
        'sklearn': 'scikit-learn',
      }

      // Parse imports from code
      const importRegex = /(?:^|\n)\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm
      let match
      while ((match = importRegex.exec(code)) !== null) {
        const moduleName = match[1]
        if (packageMap[moduleName]) {
          packagesToLoad.push(packageMap[moduleName])
        }
      }

      // Remove duplicates
      const uniquePackages = [...new Set(packagesToLoad)]

      // Load packages if needed (silently)
      if (uniquePackages.length > 0) {
        try {
          await pyodide.loadPackage(uniquePackages)
        } catch (err) {
          addOutput(`Warning: Failed to load some packages: ${err}\n`, OutputLevel.WARNING)
        }
      }

      // Configure matplotlib to use non-interactive backend
      if (uniquePackages.includes('matplotlib')) {
        // Prevent matplotlib from appending to DOM
        ;(document as any).pyodideMplTarget = null

        await pyodide.runPythonAsync(`
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt
# Prevent matplotlib from creating interactive dialogs
plt.ioff()
# Make plt.show() a no-op (we capture figures directly)
plt.show = lambda: None
`)
      }

      // Capture stdout
      let stdoutBuffer: string[] = []
      pyodide.setStdout({
        batched: (text: string) => {
          stdoutBuffer.push(text)
          addOutput(text, OutputLevel.OUTPUT)
        }
      })

      // Capture stderr
      pyodide.setStderr({
        batched: (text: string) => {
          addOutput(text, OutputLevel.ERROR)
        }
      })

      // Write all files to Pyodide's virtual filesystem (for multi-file support)
      if (files.length > 1) {
        for (const file of files) {
          const fileName = file.name
          const fileContent = file.content

          // Write file to Pyodide's filesystem
          pyodide.FS.writeFile(fileName, fileContent)
        }
      }

      // Run the code
      const result = await pyodide.runPythonAsync(code)

      // Clean up any matplotlib UI elements that might have been created
      const cleanupMatplotlibUI = () => {
        // Target the outermost container that matplotlib creates
        document.querySelectorAll('body > div[style*="display: inline-block"]').forEach(el => {
          // Check if it contains matplotlib elements
          if (el.querySelector('.mpl-canvas, .mpl-toolbar, .ui-dialog-titlebar')) {
            el.remove()
          }
        })
        // Also clean up any standalone elements
        document.querySelectorAll('.ui-dialog, .mpl-message, .mpl-toolbar').forEach(el => el.remove())
      }

      cleanupMatplotlibUI()
      // Run cleanup again after a short delay to catch async UI creation
      setTimeout(cleanupMatplotlibUI, 100)
      setTimeout(cleanupMatplotlibUI, 500)

      // Check if matplotlib plots were created and capture them
      try {
        const plotScript = `
import sys
import io
import base64

plots = []
try:
    import matplotlib
    import matplotlib.pyplot as plt

    # Get all figures
    figures = [plt.figure(num) for num in plt.get_fignums()]

    for fig in figures:
        buf = io.BytesIO()
        fig.savefig(buf, format='png', bbox_inches='tight', dpi=100)
        buf.seek(0)
        img_str = 'data:image/png;base64,' + base64.b64encode(buf.read()).decode('UTF-8')
        plots.append(img_str)
        plt.close(fig)
except ImportError:
    pass  # matplotlib not loaded
except Exception as e:
    print(f"Error capturing plots: {e}", file=sys.stderr)

plots
`
        const plotsData = await pyodide.runPythonAsync(plotScript)

        // Display plots in the graphics pane
        if (plotsData && plotsData.length > 0 && canvasRef.current) {
          // Clear previous matplotlib plots (but keep turtle graphics)
          const canvas = canvasRef.current
          // Remove existing matplotlib images
          canvas.querySelectorAll('.matplotlib-plot').forEach(el => el.remove())

          // Add new plots
          for (let i = 0; i < plotsData.length; i++) {
            const imgData = plotsData[i]
            const img = document.createElement('img')
            img.src = imgData
            img.alt = `Plot ${i + 1}`
            img.className = 'matplotlib-plot'
            img.draggable = false // Prevent browser image drag behavior
            img.style.cssText = 'max-width: 100%; height: auto; display: block; margin: 8px auto; border-radius: 4px; user-select: none;'
            canvas.appendChild(img)
          }

        }
      } catch {
        // Failed to capture plots - non-critical error
      }

      if (result !== undefined && result !== null) {
        addOutput(String(result), OutputLevel.OUTPUT)
      }

      // Show success flash on Run button
      setShowSuccessFlash(true)
      setTimeout(() => setShowSuccessFlash(false), 1500)
      setRunState(RunState.STOPPED)
    } catch (error: any) {
      const errorMessage = error.message || String(error)
      addOutput(errorMessage, OutputLevel.ERROR)
      setRunState(RunState.STOPPED)
    }
  }

  // Stop running code
  const stopCode = () => {
    if (window.Sk) {
      window.Sk.execLimit = 1
    }
    setRunState(RunState.STOPPED)
    addOutput('Program stopped', OutputLevel.WARNING)
  }

  // Restart Python kernel
  const restartKernel = () => {
    if (activeKernel === 'pyodide') {
      // Clear Pyodide state
      delete (window as any).__pyodidePromise
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
  const switchKernel = (kernel: 'skulpt' | 'pyodide') => {
    // Clear both kernels
    delete (window as any).__pyodidePromise
    delete (window as any).Sk
    delete (window as any).__skulptPromises
    setActiveKernel(null)
    setShowKernelMenu(false)
    // The kernel will auto-select based on imports on next run
  }

  // Reset code to original markdown content and clear personal highlights
  const resetCode = () => {
    // Reset to the original markdown content
    const originalContent = originalInitialCode.current

    // Update files state
    setFiles([{ name: `main${getFileExtension(language)}`, content: originalContent }])
    setActiveFileIndex(0)

    // Update editor view
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

  // Screenshot turtle canvas
  const screenshotCanvas = () => {
    // TODO: Implement canvas screenshot functionality
  }

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
            <div ref={kernelMenuRef} className="absolute top-1 right-1 z-30 flex items-center gap-0.5 bg-background/80 backdrop-blur-sm rounded px-1 py-0.5">
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

              {/* Python Kernel Indicator */}
              {language === 'python' && (
                <>
                  <div className="w-px h-4 bg-border mx-1" />
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
              <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/10 pr-24">
                  <div className="flex items-center gap-1 overflow-x-auto flex-1">
                    {files.map((file, index) => (
                      <div key={index} className="flex items-center">
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
                          <>
                            <Button
                              size="sm"
                              variant={activeFileIndex === index ? 'secondary' : 'ghost'}
                              onClick={() => switchToFile(index)}
                              onDoubleClick={() => startRename(index)}
                              className="h-7 px-2 text-xs gap-1"
                              title="Double-click to rename"
                            >
                              <FileText className="w-3 h-3" />
                              {file.name}
                            </Button>
                            {files.length > 1 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removeFile(index)
                                }}
                                className="h-6 w-6 p-0 ml-1"
                                title="Remove file"
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    ))}
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

            {/* CodeMirror Editor */}
            <div ref={editorRef} className="flex-1 overflow-auto w-full h-full relative" style={{ cursor: highlighterMode ? highlighterCursor : undefined }}>
              {/* Floating Control Buttons - Bottom Left */}
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
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center justify-center w-5 h-5 cursor-default opacity-50 hover:opacity-100 transition-opacity">
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
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        {dbStatus === 'idle' && 'Database loads on first run'}
                        {dbStatus === 'loading' && 'Loading database...'}
                        {dbStatus === 'ready' && 'Database ready'}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              {/* Floating Control Buttons - Bottom Right */}
              {pageId && (
                <div className="absolute bottom-2 right-2 flex items-center gap-1 z-10">
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
                <Button onClick={screenshotCanvas} size="sm" variant="outline" className="h-7 w-7 p-0 shadow-lg" title="Screenshot">
                  <Camera className="w-3 h-3" />
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
            {/* SQL verification feedback banner */}
            {verificationResult !== null && (
              <div className={`mb-2 rounded px-3 py-2 text-sm font-sans ${verificationResult.isCorrect ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200' : 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200'}`}>
                {verificationResult.isCorrect ? (
                  <span>&#10003; Korrekt!</span>
                ) : (
                  <div className="flex flex-col gap-1">
                    <span>&#10007; Die Ergebnisse stimmen nicht überein.</span>
                    <button
                      className="underline text-left text-xs opacity-80 hover:opacity-100"
                      onClick={() => setVerificationResult(prev => prev ? { ...prev, showSolution: !prev.showSolution } : prev)}
                    >
                      {verificationResult.showSolution ? 'Lösung verbergen' : 'Lösung anzeigen'}
                    </button>
                    {verificationResult.showSolution && solution && (
                      <pre className="mt-1 bg-black/10 dark:bg-white/10 rounded px-2 py-1 text-xs overflow-x-auto">{solution}</pre>
                    )}
                  </div>
                )}
              </div>
            )}
            {output.map((entry, index) => (
                <div key={index} className="mb-2">
                  {/* Text message */}
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
                  </div>

                  {/* SQL Results Table */}
                  {entry.sqlResults && entry.sqlResults.length > 0 && (
                    <div className="mt-1 overflow-x-auto">
                      {entry.sqlResults.map((resultSet, rsIndex) => (
                        <table key={rsIndex} className="w-full border-collapse border border-border text-[11px] mb-2">
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
                          <tbody style={{ fontSize: '0.6rem' }}>
                            {resultSet.values.map((row, rowIdx) => (
                              <tr key={rowIdx} className="hover:bg-muted/50">
                                {row.map((cell, cellIdx) => (
                                  <td
                                    key={cellIdx}
                                    style={{ padding: '0.2rem' }}
                                    className="border border-border"
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
          </div>
        ) : (
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
                <span className="text-foreground">Show autosaves</span>
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

            {versionsLoading ? (
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
                  .filter(v => showAutosaves || v.isManualSave)
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

                  const isHighlighted = highlightedVersion === version.versionNumber
                  const isEditing = editingVersion === version.versionNumber

                  return (
                    <div
                      key={version.versionNumber}
                      className={`group relative flex-shrink-0 w-24 min-h-28 max-h-40 border rounded-lg p-3 transition-all flex flex-col items-center justify-center gap-1 ${
                        isHighlighted ? 'bg-primary/20 border-primary ring-2 ring-primary/50' : 'hover:bg-accent/50'
                      }`}
                    >
                      {/* Delete button - appears on hover */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          if (!confirmDeletion || confirm(`Delete version ${version.versionNumber}?`)) {
                            await deleteVersion(version.versionNumber)
                            await refreshVersions()
                          }
                        }}
                        disabled={isDeleting}
                        className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hidden group-hover:flex hover:bg-destructive/90"
                        title="Delete version"
                      >
                        <X className="w-3 h-3" />
                      </button>

                      {/* Click to restore */}
                      <button
                        disabled={isRestoring || isEditing}
                        onClick={async () => {
                          const data = await restore(version.versionNumber)
                          if (data) {
                            // Restore the data to component state
                            if (data.files) setFiles(data.files)
                            if (data.activeFileIndex !== undefined) setActiveFileIndex(data.activeFileIndex)
                            if (data.fontSize !== undefined) setFontSize(data.fontSize)
                            if (data.lineWrapping !== undefined) setLineWrapping(data.lineWrapping)
                            if (data.editorWidth !== undefined) setEditorWidth(data.editorWidth)
                            if (data.canvasTransform) setCanvasTransform(data.canvasTransform)
                            await refreshVersions()

                            // Highlight the restored version
                            setHighlightedVersion(version.versionNumber)
                            setTimeout(() => setHighlightedVersion(null), 2000)
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
                              await updateLabel(version.versionNumber, editingLabel)
                              await refreshVersions()
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
                            placeholder={`v${version.versionNumber}`}
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
                              setEditingVersion(version.versionNumber)
                              setEditingLabel(version.label || '')
                            }}
                            className="relative z-10 font-bold text-sm text-foreground w-full text-center px-1 hover:text-primary transition-colors line-clamp-2"
                            title="Click to rename version"
                          >
                            {version.label || `v${version.versionNumber}`}
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

    {/* Teacher class progress for SQL verification exercises */}
    {solution && pageId && isTeacher && selectedClass && (
      <SqlProgressBar
        classId={selectedClass.id}
        className={selectedClass.name}
        pageId={pageId}
        componentId={verificationComponentId}
      />
    )}
    </>
  )
})
