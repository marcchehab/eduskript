'use client'

/**
 * Sticky Notes Layer
 *
 * Allows users to place sticky notes anywhere on a lesson page.
 * Notes are:
 * - Absolutely positioned within the `.paper` container
 * - Draggable by their header bar
 * - Resizable via bottom-right corner handle
 * - Minimizable / color-coded / deletable
 * - Persisted and synced via useSyncedUserData (same mechanism as drawn annotations)
 *
 * Broadcasting support:
 * - Teachers can broadcast sticky notes to a class, student, or public page
 *   using the same viewMode / syncOptions pattern as annotations and spacers.
 * - Students receive broadcast notes as read-only (no drag, resize, edit, or delete).
 * - Broadcast notes are visually distinguished with a Radio icon in the header.
 *
 * Architecture:
 * - StickyNotesLayer wraps page children and portals note cards into `.paper`
 * - Placement mode is activated via the AnnotationToolbar (shared via StickyNotesContext)
 * - Note positions are stored as absolute pixel offsets from the paper top/left
 */

import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { nanoid } from 'nanoid'
import {
  StickyNote as StickyNoteIcon,
  X,
  Minus,
  Plus,
  Palette,
  GripVertical,
  ChevronsDownUp,
  Radio,
} from 'lucide-react'
import { useSyncedUserData, type SyncedUserDataOptions } from '@/lib/userdata'
import { useStickyNotesContext } from '@/contexts/sticky-notes-context'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { useTeacherBroadcast } from '@/hooks/use-teacher-broadcast'
import { useLayerVisibility } from '@/contexts/layer-visibility-context'
import { useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const NOTE_COLORS = ['yellow', 'blue', 'green', 'pink', 'purple'] as const
export type NoteColor = typeof NOTE_COLORS[number]

export interface StickyNote {
  id: string
  /** Pixel offset from paper left edge */
  x: number
  /** Pixel offset from paper top edge */
  y: number
  content: string
  color: NoteColor
  minimized: boolean
  /** Note width in px */
  width: number
  /** Note body height in px */
  height: number
  createdAt: number
  updatedAt: number
}

export interface StickyNotesData {
  notes: StickyNote[]
}

// ---------------------------------------------------------------------------
// Constants & colour config
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 240
const DEFAULT_HEIGHT = 160
const MIN_WIDTH = 160
const MIN_HEIGHT = 80
const INITIAL_DATA: StickyNotesData = { notes: [] }

const COLOR_CONFIG: Record<NoteColor, {
  bg: string
  header: string
  border: string
  /** Full class string for focus/drag ring (ring-2 + color/opacity) */
  ring: string
  swatch: string
  dot: string
}> = {
  yellow: {
    bg: 'bg-yellow-50 dark:bg-yellow-950/50',
    header: 'bg-yellow-100 dark:bg-yellow-900/70',
    border: 'border-yellow-200 dark:border-yellow-800',
    ring: 'ring-2 ring-yellow-400/50',
    swatch: 'bg-yellow-200 dark:bg-yellow-800',
    dot: 'bg-yellow-400',
  },
  blue: {
    bg: 'bg-sky-50 dark:bg-sky-950/50',
    header: 'bg-sky-100 dark:bg-sky-900/70',
    border: 'border-sky-200 dark:border-sky-800',
    ring: 'ring-2 ring-sky-400/50',
    swatch: 'bg-sky-200 dark:bg-sky-800',
    dot: 'bg-sky-400',
  },
  green: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/50',
    header: 'bg-emerald-100 dark:bg-emerald-900/70',
    border: 'border-emerald-200 dark:border-emerald-800',
    ring: 'ring-2 ring-emerald-400/50',
    swatch: 'bg-emerald-200 dark:bg-emerald-800',
    dot: 'bg-emerald-400',
  },
  pink: {
    bg: 'bg-rose-50 dark:bg-rose-950/50',
    header: 'bg-rose-100 dark:bg-rose-900/70',
    border: 'border-rose-200 dark:border-rose-800',
    ring: 'ring-2 ring-rose-400/50',
    swatch: 'bg-rose-200 dark:bg-rose-800',
    dot: 'bg-rose-400',
  },
  purple: {
    bg: 'bg-violet-50 dark:bg-violet-950/50',
    header: 'bg-violet-100 dark:bg-violet-900/70',
    border: 'border-violet-200 dark:border-violet-800',
    ring: 'ring-2 ring-violet-400/50',
    swatch: 'bg-violet-200 dark:bg-violet-800',
    dot: 'bg-violet-400',
  },
}

// ---------------------------------------------------------------------------
// Outer layer component
// ---------------------------------------------------------------------------

interface StickyNotesLayerProps {
  pageId: string
  children: ReactNode
  /** Whether user is a student in an exam session */
  isExamStudent?: boolean
}

export function StickyNotesLayer({ pageId, children, isExamStudent }: StickyNotesLayerProps) {
  const { data: session } = useSession()
  const { viewMode, isTeacher, selectedClass, selectedStudent } = useTeacherClass()
  const isStudent = session?.user?.accountType === 'student' || isExamStudent
  const { isLayerVisible } = useLayerVisibility()

  // Layer key for own notes (mirrors annotation-layer's activeLayerKey logic)
  const ownLayerKey = useMemo(() => {
    if (viewMode === 'page-broadcast') return 'page-broadcast'
    if (isTeacher && viewMode === 'class-broadcast') return 'class-broadcast'
    if (isTeacher && viewMode === 'student-view') return 'student-feedback'
    return 'my-annotations'
  }, [isTeacher, viewMode])

  // Compute targeting (same pattern as annotation-layer syncOptions)
  const syncOptions: SyncedUserDataOptions = useMemo(() => {
    if (viewMode === 'page-broadcast') {
      return { targetType: 'page' as const, targetId: pageId }
    }
    if (!isTeacher) return {}
    if (viewMode === 'class-broadcast' && selectedClass) {
      return { targetType: 'class' as const, targetId: selectedClass.id }
    }
    if (viewMode === 'student-view' && selectedStudent) {
      return { targetType: 'student' as const, targetId: selectedStudent.id }
    }
    return {} // my-view: personal notes
  }, [isTeacher, viewMode, selectedClass, selectedStudent, pageId])

  // Active layer: personal or broadcast depending on viewMode
  const { data, updateData } = useSyncedUserData<StickyNotesData>(
    pageId,
    'sticky-notes',
    INITIAL_DATA,
    syncOptions,
  )

  // Keep a ref so event callbacks always see latest data without stale closures.
  const dataRef = useRef(data)
  useEffect(() => { dataRef.current = data }, [data])

  // For students: receive broadcast sticky notes from teachers
  const {
    classStickyNotes: teacherClassStickyNotes,
    individualStickyNotes: teacherIndividualStickyNotes,
  } = useTeacherBroadcast(isStudent ? pageId : '')

  // For students and unauthenticated visitors: fetch public (page-broadcast) sticky notes.
  // Teachers use the pageBroadcastStickyNotes hook instead (supports live sync).
  const [publicNotes, setPublicNotes] = useState<StickyNote[]>([])
  const isLoggedIn = !!session?.user
  useEffect(() => {
    if (isTeacher || !pageId) return
    fetch(`/api/user-data/sticky-notes/${encodeURIComponent(pageId)}?targetType=page`)
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        const d = json?.data as StickyNotesData | null
        if (d?.notes?.length) setPublicNotes(d.notes)
      })
      .catch(() => {}) // Silently ignore — not critical
  }, [isTeacher, pageId])

  // For teachers: load page-broadcast sticky notes as a read-only reference layer
  // when NOT actively editing page-broadcast (mirrors pageBroadcastData in annotation-layer).
  const pageBroadcastSyncOptions: SyncedUserDataOptions = useMemo(() => {
    return { targetType: 'page' as const, targetId: pageId }
  }, [pageId])
  const { data: pageBroadcastStickyNotes } = useSyncedUserData<StickyNotesData>(
    isTeacher && viewMode !== 'page-broadcast' ? pageId : '',
    'sticky-notes',
    INITIAL_DATA,
    pageBroadcastSyncOptions,
  )

  // Collect broadcast notes per layer so visibility can be checked independently
  const broadcastNotesByLayer: { layerKey: string; notes: StickyNote[] }[] = useMemo(() => {
    const layers: { layerKey: string; notes: StickyNote[] }[] = []

    // Unauthenticated visitors: public notes only
    if (!isLoggedIn) {
      if (publicNotes.length) layers.push({ layerKey: 'public', notes: publicNotes })
      return layers
    }

    // Teachers: show page-broadcast sticky notes as read-only reference
    // (when not actively editing page-broadcast — the hook returns '' key in that case)
    if (isTeacher) {
      const pbNotes = pageBroadcastStickyNotes?.notes
      if (pbNotes?.length) {
        layers.push({ layerKey: 'public', notes: pbNotes })
      }
      return layers
    }

    // Students: public notes + class broadcasts + individual feedback
    if (isStudent) {
      if (publicNotes.length) {
        layers.push({ layerKey: 'public', notes: publicNotes })
      }
      for (const broadcast of teacherClassStickyNotes) {
        const d = broadcast.data as StickyNotesData | null
        if (d?.notes?.length) {
          layers.push({ layerKey: `class-${broadcast.classId}`, notes: d.notes })
        }
      }
      if (teacherIndividualStickyNotes) {
        const d = teacherIndividualStickyNotes.data as StickyNotesData | null
        if (d?.notes?.length) {
          layers.push({ layerKey: 'individual', notes: d.notes })
        }
      }
    }
    return layers
  }, [isLoggedIn, isTeacher, isStudent, publicNotes, pageBroadcastStickyNotes, teacherClassStickyNotes, teacherIndividualStickyNotes])

  // Placement mode is driven by the toolbar via StickyNotesContext
  const { placementMode, setPlacementMode, setNoteCount, setClearHandler } = useStickyNotesContext()

  // Register clear handler so annotation-layer can clear sticky notes when deleting a layer
  useEffect(() => {
    setClearHandler(() => updateData({ notes: [] }))
    return () => setClearHandler(null)
  }, [setClearHandler, updateData])
  const [paperEl, setPaperEl] = useState<HTMLElement | null>(null)

  // Find #paper once mounted (annotation-layer already sets position:relative on it)
  useEffect(() => {
    const find = () => {
      const paper = document.getElementById('paper')
      if (paper) setPaperEl(paper)
    }
    find()
    const t = setTimeout(find, 600)
    return () => clearTimeout(t)
  }, [])

  // Esc to cancel placement
  useEffect(() => {
    if (!placementMode) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlacementMode(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [placementMode])

  // Note placement: handled via a portal overlay div (see JSX), not a global listener.
  // offsetX/offsetY on the div give direct paper-relative coords without any scroll math.
  const handlePlacementClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const x = e.nativeEvent.offsetX
    const y = e.nativeEvent.offsetY

    const newNote: StickyNote = {
      id: nanoid(),
      x: x - DEFAULT_WIDTH / 2,
      y: y - 20,
      content: '',
      color: 'yellow',
      minimized: false,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const current = dataRef.current ?? INITIAL_DATA
    updateData({ notes: [...current.notes, newNote] })
    setPlacementMode(false)
  }, [updateData, setPlacementMode])

  const updateNote = useCallback((id: string, updates: Partial<StickyNote>) => {
    const current = dataRef.current ?? INITIAL_DATA
    updateData({
      notes: current.notes.map(n =>
        n.id === id ? { ...n, ...updates, updatedAt: Date.now() } : n
      ),
    })
  }, [updateData])

  const deleteNote = useCallback((id: string) => {
    const current = dataRef.current ?? INITIAL_DATA
    updateData({ notes: current.notes.filter(n => n.id !== id) })
  }, [updateData])

  const notes = data?.notes ?? []

  // Auto-clean: if a note ID exists in both the personal store and a broadcast layer,
  // remove it from the personal store (broadcast is the canonical source).
  // This fixes data contamination from view-mode switch races.
  useEffect(() => {
    if (notes.length === 0 || broadcastNotesByLayer.length === 0) return
    const broadcastIds = new Set<string>()
    for (const layer of broadcastNotesByLayer) {
      for (const note of layer.notes) broadcastIds.add(note.id)
    }
    const cleaned = notes.filter(n => !broadcastIds.has(n.id))
    if (cleaned.length < notes.length) {
      updateData({ notes: cleaned })
    }
  }, [notes, broadcastNotesByLayer, updateData])

  // Report current note count to context so toolbar can show a badge
  const totalBroadcastNotes = broadcastNotesByLayer.reduce((sum, l) => sum + l.notes.length, 0)
  useEffect(() => {
    setNoteCount(notes.length + totalBroadcastNotes)
  }, [notes.length, totalBroadcastNotes, setNoteCount])

  return (
    <>
      {children}

      {/* Placement-mode hint — fixed tooltip above toolbar */}
      {placementMode && createPortal(
        <div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[9998] pointer-events-none select-none"
          aria-hidden
        >
          <div className="bg-yellow-50 dark:bg-yellow-950 text-yellow-900 dark:text-yellow-100 text-xs px-3 py-2 rounded-lg shadow-lg border border-yellow-200 dark:border-yellow-800 flex items-center gap-1.5 whitespace-nowrap">
            <StickyNoteIcon className="w-3 h-3 shrink-0" />
            Click the page to place a note · <kbd className="font-mono opacity-70">Esc</kbd> to cancel
          </div>
        </div>,
        document.body,
      )}

      {/* Placement overlay — portalled into .paper so it sits above the annotation canvas.
          offsetX/offsetY give paper-relative coordinates used for note positioning. */}
      {paperEl && placementMode && createPortal(
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 50,
            cursor: 'crosshair',
            pointerEvents: 'auto',
          }}
          onClick={handlePlacementClick}
          title="Click to place sticky note"
        />,
        paperEl,
      )}

      {/* Own note cards portalled into paper so they scroll with content */}
      {paperEl && isLayerVisible(ownLayerKey) && notes.map(note =>
        createPortal(
          <StickyNoteCard
            key={note.id}
            note={note}
            paperEl={paperEl}
            onUpdate={updates => updateNote(note.id, updates)}
            onDelete={() => deleteNote(note.id)}
          />,
          paperEl,
        )
      )}

      {/* Broadcast notes from teacher (read-only), filtered by layer visibility */}
      {paperEl && broadcastNotesByLayer.map(layer =>
        isLayerVisible(layer.layerKey) && layer.notes.map(note =>
          createPortal(
            <StickyNoteCard
              key={`broadcast-${note.id}`}
              note={note}
              paperEl={paperEl}
              readOnly
            />,
            paperEl,
          )
        )
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Individual sticky note card
// ---------------------------------------------------------------------------

interface StickyNoteCardProps {
  note: StickyNote
  paperEl: HTMLElement
  onUpdate?: (updates: Partial<StickyNote>) => void
  onDelete?: () => void
  /** When true, note is non-interactive (broadcast notes for students) */
  readOnly?: boolean
}

function StickyNoteCard({ note, paperEl, onUpdate, onDelete, readOnly }: StickyNoteCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)

  // Local content state so typing is instant; synced with debounce
  const [localContent, setLocalContent] = useState(note.content)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep local content in sync if it changes from outside (e.g. another device synced)
  const prevContentRef = useRef(note.content)
  useEffect(() => {
    if (note.content !== prevContentRef.current) {
      prevContentRef.current = note.content
      setLocalContent(note.content)
    }
  }, [note.content])

  // ---- Drag ----------------------------------------------------------------

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (readOnly) return
    if ((e.target as HTMLElement).closest('textarea,button,input')) return
    e.preventDefault()

    const startMouseX = e.clientX
    const startMouseY = e.clientY
    const startNoteX = note.x
    const startNoteY = note.y

    setIsDragging(true)

    const onMove = (ev: MouseEvent) => {
      const newX = startNoteX + ev.clientX - startMouseX
      const newY = startNoteY + ev.clientY - startMouseY
      if (cardRef.current) {
        cardRef.current.style.left = `${newX}px`
        cardRef.current.style.top = `${newY}px`
      }
    }

    const onUp = (ev: MouseEvent) => {
      onUpdate?.({
        x: startNoteX + ev.clientX - startMouseX,
        y: startNoteY + ev.clientY - startMouseY,
      })
      setIsDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [readOnly, note.x, note.y, onUpdate])

  // ---- Resize --------------------------------------------------------------

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()

    const startMouseX = e.clientX
    const startMouseY = e.clientY
    const startW = note.width
    const startH = note.height

    setIsResizing(true)

    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(MIN_WIDTH, startW + ev.clientX - startMouseX)
      const newH = Math.max(MIN_HEIGHT, startH + ev.clientY - startMouseY)
      if (cardRef.current) {
        cardRef.current.style.width = `${newW}px`
        const textarea = cardRef.current.querySelector('textarea')
        if (textarea) textarea.style.height = `${newH}px`
      }
    }

    const onUp = (ev: MouseEvent) => {
      onUpdate?.({
        width: Math.max(MIN_WIDTH, startW + ev.clientX - startMouseX),
        height: Math.max(MIN_HEIGHT, startH + ev.clientY - startMouseY),
      })
      setIsResizing(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [readOnly, note.width, note.height, onUpdate])

  // ---- Content -------------------------------------------------------------

  const handleContentChange = (value: string) => {
    if (readOnly) return
    setLocalContent(value)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      onUpdate?.({ content: value })
    }, 600)
  }

  // Cleanup debounce on unmount
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  const colors = COLOR_CONFIG
  const cfg = colors[note.color]

  return (
    <div
      ref={cardRef}
      className={cn(
        'absolute z-30 rounded-xl border shadow-md flex flex-col overflow-hidden',
        'transition-shadow duration-150',
        'sticky-note-enter',
        cfg.bg,
        cfg.border,
        readOnly ? 'opacity-90' : '',
        (isDragging || isResizing) ? 'shadow-2xl select-none ' + cfg.ring : 'hover:shadow-xl',
      )}
      style={{
        left: note.x,
        top: note.y,
        width: note.minimized ? 'auto' : note.width,
        minWidth: note.minimized ? undefined : MIN_WIDTH,
      }}
    >
      {/* ── Header / drag handle ──────────────────────────────────────────── */}
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1.5 select-none shrink-0',
          cfg.header,
          readOnly ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
          'border-b',
          cfg.border,
        )}
        onMouseDown={readOnly ? undefined : handleDragStart}
      >
        {readOnly
          ? <span title="From teacher"><Radio className="w-3 h-3 opacity-50 shrink-0" aria-hidden /></span>
          : <GripVertical className="w-3 h-3 opacity-30 shrink-0" aria-hidden />
        }
        <StickyNoteIcon className="w-3 h-3 opacity-50 shrink-0" aria-hidden />

        {/* Preview of content when minimized / label when empty */}
        <span className={cn(
          'text-xs opacity-60 truncate flex-1 min-w-0 select-none',
          note.minimized ? 'max-w-[160px]' : '',
        )}>
          {localContent.trim() || 'Note'}
        </span>

        {/* Action buttons (hidden in read-only mode) */}
        {!readOnly && (
          <div className="flex items-center gap-0.5 ml-1 shrink-0" onMouseDown={e => e.stopPropagation()}>
            {/* Color picker toggle */}
            <button
              onClick={() => setShowColorPicker(v => !v)}
              className="w-5 h-5 rounded flex items-center justify-center opacity-40 hover:opacity-80 transition-opacity"
              title="Change colour"
            >
              <Palette className="w-3 h-3" aria-hidden />
            </button>

            {/* Minimize / expand */}
            <button
              onClick={() => onUpdate?.({ minimized: !note.minimized })}
              className="w-5 h-5 rounded flex items-center justify-center opacity-40 hover:opacity-80 transition-opacity"
              title={note.minimized ? 'Expand' : 'Minimize'}
            >
              {note.minimized
                ? <Plus className="w-3 h-3" aria-hidden />
                : <Minus className="w-3 h-3" aria-hidden />
              }
            </button>

            {/* Delete */}
            <button
              onClick={onDelete}
              className="w-5 h-5 rounded flex items-center justify-center opacity-40 hover:opacity-100 hover:text-red-500 transition-all"
              title="Delete note"
            >
              <X className="w-3 h-3" aria-hidden />
            </button>
          </div>
        )}
      </div>

      {/* ── Colour picker row ─────────────────────────────────────────────── */}
      {!readOnly && showColorPicker && (
        <div
          className={cn('flex items-center gap-1.5 px-2.5 py-2 shrink-0 border-b', cfg.border)}
          onMouseDown={e => e.stopPropagation()}
        >
          {NOTE_COLORS.map(c => (
            <button
              key={c}
              onClick={() => { onUpdate?.({ color: c }); setShowColorPicker(false) }}
              className={cn(
                'w-5 h-5 rounded-full border-2 transition-all duration-100 hover:scale-110',
                colors[c].dot,
                note.color === c
                  ? 'border-foreground scale-110 shadow-sm'
                  : 'border-transparent opacity-70 hover:opacity-100',
              )}
              title={c.charAt(0).toUpperCase() + c.slice(1)}
            />
          ))}
        </div>
      )}

      {/* ── Body / textarea ───────────────────────────────────────────────── */}
      {!note.minimized && (
        <div className="relative flex-1 flex flex-col">
          <textarea
            className={cn(
              'w-full bg-transparent text-sm leading-relaxed p-3 outline-none resize-none',
              'placeholder:text-foreground/30',
              'text-foreground',
            )}
            style={{ height: note.height }}
            placeholder={readOnly ? '' : 'Write your note…'}
            value={localContent}
            onChange={e => handleContentChange(e.target.value)}
            onMouseDown={e => e.stopPropagation()}
            readOnly={readOnly}
            // autofocus only for brand-new empty notes
            // eslint-disable-next-line jsx-a11y/no-autofocus
            // eslint-disable-next-line react-hooks/purity
            autoFocus={!readOnly && note.content === '' && Date.now() - note.createdAt < 3000}
            spellCheck={!readOnly}
          />

          {/* Resize handle (hidden in read-only mode) */}
          {!readOnly && (
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-30 hover:opacity-70 flex items-end justify-end pb-0.5 pr-0.5 transition-opacity"
              onMouseDown={handleResizeStart}
              title="Resize"
            >
              <ChevronsDownUp className="w-2.5 h-2.5 rotate-[135deg]" aria-hidden />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
