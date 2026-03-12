'use client'

/**
 * Sticky Notes Layer
 *
 * Allows students to place personal sticky notes anywhere on a lesson page.
 * Notes are:
 * - Absolutely positioned within the `.paper` container
 * - Draggable by their header bar
 * - Resizable via bottom-right corner handle
 * - Minimizable / color-coded / deletable
 * - Persisted and synced via useSyncedUserData (same mechanism as drawn annotations)
 *
 * Architecture:
 * - StickyNotesLayer wraps page children and portals note cards into `.paper`
 * - Placement mode is activated via the AnnotationToolbar (shared via StickyNotesContext)
 * - Note positions are stored as absolute pixel offsets from the paper top/left
 *
 * Sync: uses componentId 'sticky-notes' with no targetType/targetId, so it is
 * personal to the logged-in user and syncs across devices (IndexedDB + server).
 */

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
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
} from 'lucide-react'
import { useSyncedUserData } from '@/lib/userdata'
import { useStickyNotesContext } from '@/contexts/sticky-notes-context'
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
}

export function StickyNotesLayer({ pageId, children }: StickyNotesLayerProps) {
  const { data, updateData } = useSyncedUserData<StickyNotesData>(
    pageId,
    'sticky-notes',
    INITIAL_DATA,
  )
  // Keep a ref so event callbacks always see latest data without stale closures.
  const dataRef = useRef(data)
  useEffect(() => { dataRef.current = data }, [data])

  // Placement mode is driven by the toolbar via StickyNotesContext
  const { placementMode, setPlacementMode, setNoteCount } = useStickyNotesContext()
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
    const paperWidth = (e.currentTarget as HTMLDivElement).offsetWidth

    const newNote: StickyNote = {
      id: nanoid(),
      x: Math.max(8, Math.min(x - DEFAULT_WIDTH / 2, paperWidth - DEFAULT_WIDTH - 8)),
      y: Math.max(8, y - 20),
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

  // Report current note count to context so toolbar can show a badge
  useEffect(() => {
    setNoteCount(notes.length)
  }, [notes.length, setNoteCount])

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
          aria-label="Click to place sticky note"
        />,
        paperEl,
      )}

      {/* Note cards portalled into paper so they scroll with content */}
      {paperEl && notes.map(note =>
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
    </>
  )
}

// ---------------------------------------------------------------------------
// Individual sticky note card
// ---------------------------------------------------------------------------

interface StickyNoteCardProps {
  note: StickyNote
  paperEl: HTMLElement
  onUpdate: (updates: Partial<StickyNote>) => void
  onDelete: () => void
}

function StickyNoteCard({ note, paperEl, onUpdate, onDelete }: StickyNoteCardProps) {
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
    if ((e.target as HTMLElement).closest('textarea,button,input')) return
    e.preventDefault()

    const startMouseX = e.clientX
    const startMouseY = e.clientY
    const startNoteX = note.x
    const startNoteY = note.y

    setIsDragging(true)

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startMouseX
      const dy = ev.clientY - startMouseY
      const paperRect = paperEl.getBoundingClientRect()
      const newX = Math.max(0, Math.min(startNoteX + dx, paperRect.width - note.width - 4))
      const newY = Math.max(0, startNoteY + dy)
      if (cardRef.current) {
        cardRef.current.style.left = `${newX}px`
        cardRef.current.style.top = `${newY}px`
      }
    }

    const onUp = (ev: MouseEvent) => {
      const dx = ev.clientX - startMouseX
      const dy = ev.clientY - startMouseY
      const paperRect = paperEl.getBoundingClientRect()
      onUpdate({
        x: Math.max(0, Math.min(startNoteX + dx, paperRect.width - note.width - 4)),
        y: Math.max(0, startNoteY + dy),
      })
      setIsDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [note.x, note.y, note.width, onUpdate, paperEl])

  // ---- Resize --------------------------------------------------------------

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
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
      onUpdate({
        width: Math.max(MIN_WIDTH, startW + ev.clientX - startMouseX),
        height: Math.max(MIN_HEIGHT, startH + ev.clientY - startMouseY),
      })
      setIsResizing(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [note.width, note.height, onUpdate])

  // ---- Content -------------------------------------------------------------

  const handleContentChange = (value: string) => {
    setLocalContent(value)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      onUpdate({ content: value })
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
          'cursor-grab active:cursor-grabbing',
          'border-b',
          cfg.border,
        )}
        onMouseDown={handleDragStart}
      >
        <GripVertical className="w-3 h-3 opacity-30 shrink-0" aria-hidden />
        <StickyNoteIcon className="w-3 h-3 opacity-50 shrink-0" aria-hidden />

        {/* Preview of content when minimized / label when empty */}
        <span className={cn(
          'text-xs opacity-60 truncate flex-1 min-w-0 select-none',
          note.minimized ? 'max-w-[160px]' : '',
        )}>
          {localContent.trim() || 'Note'}
        </span>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 ml-1 shrink-0" onMouseDown={e => e.stopPropagation()}>
          {/* Color picker toggle */}
          <button
            onClick={() => setShowColorPicker(v => !v)}
            className="w-5 h-5 rounded flex items-center justify-center opacity-40 hover:opacity-80 transition-opacity"
            title="Change colour"
            aria-label="Change note colour"
          >
            <Palette className="w-3 h-3" aria-hidden />
          </button>

          {/* Minimize / expand */}
          <button
            onClick={() => onUpdate({ minimized: !note.minimized })}
            className="w-5 h-5 rounded flex items-center justify-center opacity-40 hover:opacity-80 transition-opacity"
            title={note.minimized ? 'Expand' : 'Minimize'}
            aria-label={note.minimized ? 'Expand note' : 'Minimize note'}
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
            aria-label="Delete note"
          >
            <X className="w-3 h-3" aria-hidden />
          </button>
        </div>
      </div>

      {/* ── Colour picker row ─────────────────────────────────────────────── */}
      {showColorPicker && (
        <div
          className={cn('flex items-center gap-1.5 px-2.5 py-2 shrink-0 border-b', cfg.border)}
          onMouseDown={e => e.stopPropagation()}
        >
          {NOTE_COLORS.map(c => (
            <button
              key={c}
              onClick={() => { onUpdate({ color: c }); setShowColorPicker(false) }}
              className={cn(
                'w-5 h-5 rounded-full border-2 transition-all duration-100 hover:scale-110',
                colors[c].dot,
                note.color === c
                  ? 'border-foreground scale-110 shadow-sm'
                  : 'border-transparent opacity-70 hover:opacity-100',
              )}
              title={c.charAt(0).toUpperCase() + c.slice(1)}
              aria-label={`${c.charAt(0).toUpperCase() + c.slice(1)} note`}
              aria-pressed={note.color === c}
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
            placeholder="Write your note…"
            value={localContent}
            onChange={e => handleContentChange(e.target.value)}
            onMouseDown={e => e.stopPropagation()}
            // autofocus only for brand-new empty notes
            // eslint-disable-next-line jsx-a11y/no-autofocus
            // eslint-disable-next-line react-hooks/purity
            autoFocus={note.content === '' && Date.now() - note.createdAt < 3000}
            spellCheck
          />

          {/* Resize handle */}
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-30 hover:opacity-70 flex items-end justify-end pb-0.5 pr-0.5 transition-opacity"
            onMouseDown={handleResizeStart}
            title="Resize"
            aria-label="Resize note"
          >
            <ChevronsDownUp className="w-2.5 h-2.5 rotate-[135deg]" aria-hidden />
          </div>
        </div>
      )}
    </div>
  )
}
