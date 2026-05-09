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
  Trash2,
  Minus,
  Plus,
  Palette,
  GripVertical,
  ChevronsDownUp,
  Radio,
} from 'lucide-react'
import {
  determineSectionFromY,
  type HeadingPosition,
} from '@/lib/annotations/reposition-strokes'
import { useHeadingPositions } from '@/contexts/heading-positions-context'
import { useZoom } from '@/contexts/zoom-context'
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
  /**
   * Anchor section for vertical repositioning (matches snap/stroke model).
   * When the markdown above this section grows or shrinks, the note follows
   * its section instead of staying at a stale absolute Y. Optional for
   * back-compat with notes created before anchoring landed; those notes
   * stay at their stored y until the user moves them.
   */
  sectionId?: string
  /** Section's Y offset when the note was placed/last moved. */
  sectionOffsetY?: number
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
  /**
   * Pre-fetched public (page-broadcast) sticky notes from the server.
   *
   * When provided (even as an empty array), the client-side `fetch` for the
   * public layer is skipped — public notes render at first paint without a
   * post-hydration waterfall. Pass `undefined` only on routes that don't
   * SSR-prefetch this data.
   */
  publicStickyNotes?: StickyNote[]
}

export function StickyNotesLayer({ pageId, children, isExamStudent, publicStickyNotes }: StickyNotesLayerProps) {
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

  // For students and unauthenticated visitors: render public (page-broadcast) sticky notes.
  // Teachers use the pageBroadcastStickyNotes hook instead (supports live sync).
  //
  // Initial value comes from the server-rendered `publicStickyNotes` prop when
  // the route SSR-prefetches it (the four public page routes). When the prop is
  // omitted (legacy callers), we fall back to a client fetch on mount.
  const [publicNotes, setPublicNotes] = useState<StickyNote[]>(publicStickyNotes ?? [])
  const isLoggedIn = !!session?.user
  useEffect(() => {
    // Prop-supplied data is authoritative for the initial render — skip the fetch.
    if (publicStickyNotes !== undefined) return
    if (isTeacher || !pageId) return
    fetch(`/api/user-data/sticky-notes/${encodeURIComponent(pageId)}?targetType=page`)
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        const d = json?.data as StickyNotesData | null
        if (d?.notes?.length) setPublicNotes(d.notes)
      })
      .catch(() => {}) // Silently ignore — not critical
  }, [isTeacher, pageId, publicStickyNotes])

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
  const [paperPaddingLeft, setPaperPaddingLeft] = useState<number>(0)

  // Find #paper once mounted (annotation-layer already sets position:relative on it)
  useEffect(() => {
    const find = () => {
      const paper = document.getElementById('paper')
      if (paper) {
        setPaperEl(paper)
        // Read paper's left padding once. Sections (children of .markdown-content)
        // start at this offset within the paper, so notes portaled into a section
        // need their stored paper-X subtracted by this amount to align visually.
        const padding = parseFloat(getComputedStyle(paper).paddingLeft) || 0
        setPaperPaddingLeft(padding)
      }
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

  // Heading positions from AnnotationLayer (parent context). Used to anchor
  // sticky notes to their nearest section so they follow content reflow.
  const headingPositions = useHeadingPositions()
  const headingPositionsRef = useRef<HeadingPosition[]>(headingPositions)
  useEffect(() => { headingPositionsRef.current = headingPositions }, [headingPositions])

  /**
   * Compute the {sectionId, sectionOffsetY} anchor for a Y coordinate. Returns
   * `{}` if no section contains it (e.g. note placed above the first heading)
   * — caller spreads either way, so an empty object is a safe no-op.
   */
  const anchorForY = useCallback((y: number): { sectionId?: string; sectionOffsetY?: number } => {
    const positions = headingPositionsRef.current
    if (positions.length === 0) return {}
    const sectionId = determineSectionFromY(y, positions)
    if (!sectionId) return {}
    const sectionOffsetY = positions.find(h => h.sectionId === sectionId)?.offsetY
    return { sectionId, sectionOffsetY }
  }, [])

  // Note placement: handled via a portal overlay div (see JSX), not a global listener.
  // offsetX/offsetY on the div give direct paper-relative coords without any scroll math.
  const handlePlacementClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const x = e.nativeEvent.offsetX
    const y = e.nativeEvent.offsetY
    const noteY = y - 20

    const newNote: StickyNote = {
      id: nanoid(),
      x: x - DEFAULT_WIDTH / 2,
      y: noteY,
      content: '',
      color: 'yellow',
      minimized: false,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...anchorForY(noteY),
    }

    const current = dataRef.current ?? INITIAL_DATA
    updateData({ notes: [...current.notes, newNote] })
    setPlacementMode(false)
  }, [updateData, setPlacementMode, anchorForY])

  const updateNote = useCallback((id: string, updates: Partial<StickyNote>) => {
    const current = dataRef.current ?? INITIAL_DATA
    // If the note was moved vertically, re-anchor to whichever section now
    // contains it. Without this, dragging a note out of its old section would
    // leave it tied to a wrong anchor and snap back on the next reflow.
    const reAnchor = updates.y !== undefined ? anchorForY(updates.y) : null
    updateData({
      notes: current.notes.map(n =>
        n.id === id
          ? { ...n, ...updates, ...(reAnchor ?? {}), updatedAt: Date.now() }
          : n
      ),
    })
  }, [updateData, anchorForY])

  const deleteNote = useCallback((id: string) => {
    const current = dataRef.current ?? INITIAL_DATA
    updateData({ notes: current.notes.filter(n => n.id !== id) })
  }, [updateData])

  // Stabilise the notes reference so dependent effects don't re-run on every
  // render of this component (the `?? []` fallback would otherwise allocate
  // a fresh array each time).
  const notes = useMemo(() => data?.notes ?? [], [data?.notes])

  // Resolve each note's anchor section to a live DOM element. We re-run when
  // notes change OR when headingPositions change (which is the proxy for
  // "DOM section layout changed" — markdown re-renders, spacers added, etc).
  // Notes whose sectionId can't be resolved fall back to the paper portal
  // (no vertical anchoring, sit at note.y in paper coords).
  //
  // Replaces the old repositionStickyNote effect: instead of writing new
  // y / sectionOffsetY back to userData on every layout shift, we anchor
  // the note's DOM into its section element so the browser carries it.
  // No persistence churn, no JS reposition math.
  const allNotes = useMemo(() => {
    const broadcast: StickyNote[] = []
    for (const layer of broadcastNotesByLayer) for (const n of layer.notes) broadcast.push(n)
    return [...notes, ...broadcast]
  }, [notes, broadcastNotesByLayer])

  const [sectionTargets, setSectionTargets] = useState<Map<string, HTMLElement>>(() => new Map())

  useEffect(() => {
    const next = new Map<string, HTMLElement>()
    for (const note of allNotes) {
      if (!note.sectionId) continue
      if (next.has(note.sectionId)) continue
      const el = document.querySelector(`[data-section-id="${CSS.escape(note.sectionId)}"]`)
      if (el instanceof HTMLElement) next.set(note.sectionId, el)
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: querying live DOM for portal targets after render. Same-value short-circuit prevents cascade.
    setSectionTargets((prev) => {
      if (prev.size !== next.size) return next
      for (const [k, v] of next) if (prev.get(k) !== v) return next
      return prev
    })
  }, [allNotes, headingPositions])

  /** Returns { target, originX, originY } — where to portal this note.
   * Returns null when the note's section was a markdown-dynamic-height
   * element (callout, code-editor, plugin) that's no longer in the DOM —
   * caller renders nothing in that case. Mental model: variable-height
   * element disappears → its annotations disappear too. Data persists.
   * Other anchors (h1/h2/h3, spacers) fall through to the paper-absolute
   * fallback so the note stays visible at its drawn position. */
  const resolveTarget = useCallback((note: StickyNote): { target: HTMLElement; originX: number; originY: number } | null => {
    if (!paperEl) return null
    if (note.sectionId && note.sectionOffsetY !== undefined) {
      const sectionEl = sectionTargets.get(note.sectionId)
      if (sectionEl) {
        // Compensate for the section's own border: `position: absolute; top:0;
        // left:0` of an absolute child of a positioned parent lands at the
        // parent's padding-edge (inside the border), but sectionOffsetY is
        // measured to the border-edge. Without adding the section's border
        // widths to originX/originY, notes inside elements like callouts
        // (which have a 6 px left border) get visibly offset to the right.
        const cs = window.getComputedStyle(sectionEl)
        const borderTop = parseFloat(cs.borderTopWidth) || 0
        const borderLeft = parseFloat(cs.borderLeftWidth) || 0
        return {
          target: sectionEl,
          originX: paperPaddingLeft + borderLeft,
          originY: note.sectionOffsetY + borderTop,
        }
      }
      if (/^(callout|editor|plugin)-/.test(note.sectionId)) {
        return null
      }
    }
    return { target: paperEl, originX: 0, originY: 0 }
  }, [paperEl, paperPaddingLeft, sectionTargets])

  // Listen for spacer-add re-anchor events from annotation-layer. When a new
  // spacer is added inside an existing section, notes that fall below it should
  // re-anchor to the spacer's end-sentinel + shift down by the spacer's height
  // so they follow subsequent height changes. Mirrors the stroke/snap reanchor
  // in annotation-layer.tsx; same destructive-on-remove trade-off applies.
  useEffect(() => {
    const handleReanchor = (e: Event) => {
      const detail = (e as CustomEvent).detail as { spacerId: string; spacerTop: number; spacerEndY: number; height: number }
      const NT = detail.spacerTop
      const NE = detail.spacerEndY
      const H = detail.height

      const visualY = (n: StickyNote): number | null => {
        if (!n.sectionId || n.sectionOffsetY === undefined) return null
        const entry = headingPositionsRef.current.find(h => h.sectionId === n.sectionId)
        if (!entry) return null
        return entry.offsetY + (n.y - n.sectionOffsetY)
      }
      const shouldReassign = (n: StickyNote): boolean => {
        if (!n.sectionId || n.sectionOffsetY === undefined) return false
        const entry = headingPositionsRef.current.find(h => h.sectionId === n.sectionId)
        if (!entry) return false
        if (entry.offsetY >= NT) return false
        const v = visualY(n)
        return v !== null && v > NT
      }

      const current = dataRef.current ?? INITIAL_DATA
      let changed = false
      const next = current.notes.map(n => {
        if (!shouldReassign(n)) return n
        changed = true
        return {
          ...n,
          sectionId: `spacer-${detail.spacerId}-end`,
          sectionOffsetY: NE,
          y: n.y + H,
          updatedAt: Date.now(),
        }
      })
      if (changed) updateData({ notes: next })
    }
    window.addEventListener('eduskript:reanchor-below-spacer', handleReanchor)

    // When a spacer is removed: notes anchored to `spacer-{id}` /
    // `spacer-{id}-end` get split by their CURRENT visual paper-y (not stored
    // y, which can have stale shifts baked in from earlier resizes):
    //
    //   in-spacer (visual_y inside [NT, NE]): deleted if the user has
    //     spacer-delete-annotations on (default), else re-anchored to the
    //     divider above with no y shift.
    //
    //   below-spacer: re-anchored to the divider above with
    //       y -= (stored.sectionOffsetY − NT)
    //     which un-applies the +H shift baked in at add-time, regardless of
    //     any resize that happened in between. See the matching comment in
    //     handleRemoveSpacer (annotation-layer.tsx) for the full rationale.
    const handleUnanchor = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        spacerId: string
        prevSectionId?: string
        prevSectionOffsetY?: number
        spacerTop?: number
        spacerEnd?: number
        deleteInSpacer?: boolean
        headingPositions?: Array<{ sectionId: string; offsetY: number }>
      }
      const NT = detail.spacerTop
      const NE = detail.spacerEnd
      const positions = detail.headingPositions ?? []
      const visualPaperY = (y: number, sectionOffsetY: number, sectionId: string): number | undefined => {
        const entry = positions.find(p => p.sectionId === sectionId)
        if (!entry) return undefined
        return entry.offsetY + (y - sectionOffsetY)
      }
      const inSpacerSection = (sid: string | undefined) =>
        sid === `spacer-${detail.spacerId}` || sid === `spacer-${detail.spacerId}-end`
      const isInSpacer = (visY: number | undefined) =>
        visY !== undefined && NT !== undefined && NE !== undefined && visY >= NT && visY <= NE
      const reanchorShift = (sectionOffsetY: number): number =>
        NT !== undefined ? -(sectionOffsetY - NT) : 0
      const current = dataRef.current ?? INITIAL_DATA
      let changed = false
      const nextNotes: typeof current.notes = []
      for (const n of current.notes) {
        if (!inSpacerSection(n.sectionId)) {
          nextNotes.push(n)
          continue
        }
        if (n.sectionOffsetY === undefined || !n.sectionId) {
          nextNotes.push(n)
          continue
        }
        const visY = visualPaperY(n.y, n.sectionOffsetY, n.sectionId)
        if (isInSpacer(visY)) {
          if (detail.deleteInSpacer) {
            changed = true
            continue // delete
          }
          if (detail.prevSectionId !== undefined && detail.prevSectionOffsetY !== undefined) {
            changed = true
            nextNotes.push({
              ...n,
              sectionId: detail.prevSectionId,
              sectionOffsetY: detail.prevSectionOffsetY,
              updatedAt: Date.now(),
            })
            continue
          }
        } else if (detail.prevSectionId !== undefined && detail.prevSectionOffsetY !== undefined) {
          const shift = reanchorShift(n.sectionOffsetY)
          changed = true
          nextNotes.push({
            ...n,
            sectionId: detail.prevSectionId,
            sectionOffsetY: detail.prevSectionOffsetY,
            y: n.y + shift,
            updatedAt: Date.now(),
          })
          continue
        }
        nextNotes.push(n)
      }
      if (changed) updateData({ notes: nextNotes })
    }
    window.addEventListener('eduskript:unanchor-spacer-removed', handleUnanchor)

    return () => {
      window.removeEventListener('eduskript:reanchor-below-spacer', handleReanchor)
      window.removeEventListener('eduskript:unanchor-spacer-removed', handleUnanchor)
    }
  }, [updateData])

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

      {/* Own note cards: each portaled into its anchor section element when
          resolvable, falling back to #paper otherwise. Section-portaled notes
          follow their section automatically as the page reflows. */}
      {paperEl && isLayerVisible(ownLayerKey) && notes.map(note => {
        const r = resolveTarget(note)
        if (!r) return null
        return createPortal(
          <StickyNoteCard
            key={note.id}
            note={note}
            paperEl={paperEl}
            onUpdate={updates => updateNote(note.id, updates)}
            onDelete={() => deleteNote(note.id)}
            originX={r.originX}
            originY={r.originY}
          />,
          r.target,
          `note-portal:${note.id}`,
        )
      })}

      {/* Broadcast notes from teacher (read-only). Anchored the same way as
          owned notes — no display-only repositionStickyNote call needed; the
          section portal carries them through layout changes. */}
      {paperEl && broadcastNotesByLayer.map(layer =>
        isLayerVisible(layer.layerKey) && layer.notes.map(note => {
          const r = resolveTarget(note)
          if (!r) return null
          return createPortal(
            <StickyNoteCard
              key={`broadcast-${note.id}`}
              note={note}
              paperEl={paperEl}
              readOnly
              originX={r.originX}
              originY={r.originY}
            />,
            r.target,
            `note-portal:broadcast:${note.id}`,
          )
        })
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
  /** When the card is portaled into a section (rather than the paper), the
   *  section's top-left isn't aligned with the paper's top-left. We subtract
   *  these offsets from note.x/note.y at render time so the note still appears
   *  at its stored paper-absolute coordinates. note.x/y itself stays in
   *  paper-space (drag math, persistence). 0 when paper-portaled. */
  originX?: number
  originY?: number
}

function StickyNoteCard({ note, paperEl, onUpdate, onDelete, readOnly, originX = 0, originY = 0 }: StickyNoteCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const getZoom = useZoom()
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
    // Capture ancestor zoom once: cursor delta is in viewport pixels but
    // note.x/y live in #paper's logical pre-scale pixels.
    const zoom = getZoom()

    setIsDragging(true)

    const onMove = (ev: MouseEvent) => {
      const newX = startNoteX + (ev.clientX - startMouseX) / zoom
      const newY = startNoteY + (ev.clientY - startMouseY) / zoom
      if (cardRef.current) {
        cardRef.current.style.left = `${newX - originX}px`
        cardRef.current.style.top = `${newY - originY}px`
      }
    }

    const onUp = (ev: MouseEvent) => {
      onUpdate?.({
        x: startNoteX + (ev.clientX - startMouseX) / zoom,
        y: startNoteY + (ev.clientY - startMouseY) / zoom,
      })
      setIsDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [readOnly, note.x, note.y, onUpdate, getZoom])

  // ---- Resize --------------------------------------------------------------

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()

    const startMouseX = e.clientX
    const startMouseY = e.clientY
    const startW = note.width
    const startH = note.height
    const zoom = getZoom()

    setIsResizing(true)

    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(MIN_WIDTH, startW + (ev.clientX - startMouseX) / zoom)
      const newH = Math.max(MIN_HEIGHT, startH + (ev.clientY - startMouseY) / zoom)
      if (cardRef.current) {
        cardRef.current.style.width = `${newW}px`
        const textarea = cardRef.current.querySelector('textarea')
        if (textarea) textarea.style.height = `${newH}px`
      }
    }

    const onUp = (ev: MouseEvent) => {
      onUpdate?.({
        width: Math.max(MIN_WIDTH, startW + (ev.clientX - startMouseX) / zoom),
        height: Math.max(MIN_HEIGHT, startH + (ev.clientY - startMouseY) / zoom),
      })
      setIsResizing(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [readOnly, note.width, note.height, onUpdate, getZoom])

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
        left: note.x - originX,
        top: note.y - originY,
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
              <Trash2 className="w-3 h-3" aria-hidden />
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
