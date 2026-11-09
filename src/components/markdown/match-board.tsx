"use client"

/**
 * Two-column connect board for `<question type="match">` (quiz.tsx).
 *
 * Left column: the rows (authored order). Right column: the targets, in the
 * order the caller passes (quiz.tsx shuffles them, lib/match-question.ts).
 * A connection = row → target; a target can take several rows. Connections are
 * drawn as SVG curves in an overlay over the board; anchor positions are
 * measured from the connector dots (getBoundingClientRect relative to the
 * board) and re-measured on resize (ResizeObserver) and on every answer change.
 *
 * Ways to connect (all reach onConnect / onDisconnect):
 *   - Pointer drag (mouse, pen, touch) from a row to a target. Pointer events,
 *     not HTML5 drag and drop (which does not fire on touch). Rows use
 *     `touch-action: none` and touchmove is cancelled while a row is pressed,
 *     so a finger drag never scrolls the page (scroll by swiping outside the
 *     rows). Dropping in empty space removes the row's
 *     connection. Hit-testing uses the targets' bounding rects (O(targets) per
 *     drop).
 *   - Tap/click a row, then tap/click a target.
 *   - Keyboard: Enter/Space on a row → focus moves to the targets; ArrowUp/Down
 *     between targets, Enter/Space connects, Escape goes back. Delete/Backspace
 *     on a row removes its connection.
 *   - The × on a connected row removes the connection.
 *
 * Known limitation: the lines are measured after layout; content that changes
 * size without resizing the board or its columns (rare) keeps stale lines
 * until the next answer change or resize.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MatchAnswer } from '@/lib/match-question'

export interface MatchBoardRow {
  label: ReactNode
  /** Shown under the label (feedback text, "Correct match: …"). */
  extra?: ReactNode
  /** Result mark: true = correct, false = wrong, null = blank but counted wrong, undefined = no mark. */
  result?: boolean | null
  /** On full reveal for a not-correct row: the correct target (drawn dashed). */
  keyTarget?: string
}

interface Props {
  idBase: string
  rows: MatchBoardRow[]
  targets: string[]
  answer: MatchAnswer
  disabled: boolean
  onConnect: (row: number, target: string) => void
  onDisconnect: (row: number) => void
  labelledBy?: string
}

type Point = { x: number; y: number }

// Pointer travel (px) that turns a press into a drag instead of a tap.
const DRAG_THRESHOLD = 6

export function MatchBoard({ idBase, rows, targets, answer, disabled, onConnect, onDisconnect, labelledBy }: Props) {
  const boardRef = useRef<HTMLDivElement>(null)
  const rowDotRefs = useRef<Array<HTMLSpanElement | null>>([])
  const targetRefs = useRef<Array<HTMLButtonElement | null>>([])
  const targetDotRefs = useRef<Array<HTMLSpanElement | null>>([])
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])

  const [rowAnchors, setRowAnchors] = useState<Point[]>([])
  const [targetAnchors, setTargetAnchors] = useState<Point[]>([])
  // Row picked by tap/click/keyboard, waiting for a target.
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  // Live pointer drag: row + current pointer position (board coordinates).
  const [drag, setDrag] = useState<{ row: number; at: Point; moved: boolean } | null>(null)
  const dragStartRef = useRef<{ row: number; x: number; y: number; pointerId: number } | null>(null)
  const suppressClickRef = useRef(false)

  // `rows`/`targets` are rebuilt by the parent on every render, so the
  // measurement keys on their count/content, and state is only set when a
  // position actually changed (otherwise measure → setState → render loops).
  const rowCount = rows.length
  const targetsKey = targets.join('\u0000')
  const measure = useCallback(() => {
    const board = boardRef.current
    if (!board) return
    const b = board.getBoundingClientRect()
    const center = (el: Element | null): Point => {
      if (!el) return { x: 0, y: 0 }
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2 - b.left, y: r.top + r.height / 2 - b.top }
    }
    const same = (a: Point[], c: Point[]) => a.length === c.length && a.every((p, i) => p.x === c[i].x && p.y === c[i].y)
    const nextRows = Array.from({ length: rowCount }, (_, i) => center(rowDotRefs.current[i]))
    const nextTargets = targetsKey === '' ? [] : targetsKey.split('\u0000').map((_, i) => center(targetDotRefs.current[i]))
    setRowAnchors((prev) => (same(prev, nextRows) ? prev : nextRows))
    setTargetAnchors((prev) => (same(prev, nextTargets) ? prev : nextTargets))
  }, [rowCount, targetsKey])

  useLayoutEffect(() => {
    measure()
  }, [measure, answer])

  useEffect(() => {
    const board = boardRef.current
    if (!board || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(board)
    rowRefs.current.forEach((el) => el && ro.observe(el))
    targetRefs.current.forEach((el) => el && ro.observe(el))
    return () => ro.disconnect()
  }, [measure])

  // Leaving the editable state drops a pending selection.
  useEffect(() => {
    if (disabled) setSelectedRow(null)
  }, [disabled])

  const toBoard = (clientX: number, clientY: number): Point => {
    const b = boardRef.current?.getBoundingClientRect()
    return { x: clientX - (b?.left ?? 0), y: clientY - (b?.top ?? 0) }
  }

  const targetAt = (clientX: number, clientY: number): number => {
    for (let i = 0; i < targets.length; i++) {
      const r = targetRefs.current[i]?.getBoundingClientRect()
      if (r && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return i
    }
    return -1
  }

  // Window-level move/up/cancel while a press on a row is active.
  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const start = dragStartRef.current
      if (!start || e.pointerId !== start.pointerId) return
      const moved = drag.moved || Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_THRESHOLD
      setDrag({ row: start.row, at: toBoard(e.clientX, e.clientY), moved })
    }
    const onUp = (e: PointerEvent) => {
      const start = dragStartRef.current
      if (!start || e.pointerId !== start.pointerId) return
      const moved = drag.moved || Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_THRESHOLD
      dragStartRef.current = null
      setDrag(null)
      if (!moved) return // a tap: the click handler selects the row
      // A drag that ends on the same row would also fire a click there; skip
      // that one click. Reset on the next task, because a drag ending
      // elsewhere fires no click on the row and must not eat a later tap.
      suppressClickRef.current = true
      setTimeout(() => { suppressClickRef.current = false }, 0)
      const t = targetAt(e.clientX, e.clientY)
      if (t >= 0) onConnect(start.row, targets[t])
      else onDisconnect(start.row) // dropped in empty space
      setSelectedRow(null)
    }
    const onCancel = () => {
      dragStartRef.current = null
      setDrag(null)
    }
    // While a row is pressed the page must not scroll under the finger
    // (iOS Safari can still start a scroll despite touch-action on the row).
    const onTouchMove = (e: TouchEvent) => { if (e.cancelable) e.preventDefault() }
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, targets, onConnect, onDisconnect])

  const startDrag = (e: React.PointerEvent, row: number) => {
    if (disabled || e.button > 0) return
    dragStartRef.current = { row, x: e.clientX, y: e.clientY, pointerId: e.pointerId }
    setDrag({ row, at: toBoard(e.clientX, e.clientY), moved: false })
  }

  const clickRow = (row: number) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (disabled) return
    setSelectedRow((cur) => (cur === row ? null : row))
  }

  const focusTarget = (i: number) => targetRefs.current[(i + targets.length) % targets.length]?.focus()

  const rowKeyDown = (e: React.KeyboardEvent, row: number) => {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setSelectedRow(row)
      const current = targets.indexOf(answer[String(row)] ?? '')
      focusTarget(current >= 0 ? current : 0)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onDisconnect(row)
    } else if (e.key === 'Escape') {
      setSelectedRow(null)
    }
  }

  const connectSelected = (t: number) => {
    if (disabled || selectedRow == null) return
    const row = selectedRow
    onConnect(row, targets[t])
    setSelectedRow(null)
    return row
  }

  const targetKeyDown = (e: React.KeyboardEvent, t: number) => {
    if (disabled) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      focusTarget(t + 1)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault()
      focusTarget(t - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const row = connectSelected(t)
      if (row != null) rowRefs.current[row]?.focus()
    } else if (e.key === 'Escape' && selectedRow != null) {
      e.preventDefault()
      const row = selectedRow
      setSelectedRow(null)
      rowRefs.current[row]?.focus()
    }
  }

  // Cubic curve between the two columns; horizontal tangents at both ends.
  const curve = (a: Point, b: Point) => {
    const dx = Math.max(24, Math.abs(b.x - a.x) / 2)
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
  }

  const lineClass = (result: boolean | null | undefined) =>
    result === true
      ? 'stroke-green-600 dark:stroke-green-500'
      : result === false
        ? 'stroke-red-600 dark:stroke-red-500'
        : 'stroke-primary'

  return (
    <div
      ref={boardRef}
      role="group"
      aria-labelledby={labelledBy}
      className="relative grid grid-cols-2 gap-x-8 sm:gap-x-16"
      data-match-board=""
    >
      {/* Left column: rows */}
      <div className="flex min-w-0 flex-col gap-2">
        {rows.map((row, i) => {
          const target = answer[String(i)]
          const selected = selectedRow === i || drag?.row === i
          return (
            <div
              key={i}
              ref={(el) => { rowRefs.current[i] = el }}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-pressed={selectedRow === i}
              aria-disabled={disabled || undefined}
              aria-describedby={`${idBase}-row-${i}-state`}
              data-match-row={i}
              onPointerDown={(e) => startDrag(e, i)}
              onClick={() => clickRow(i)}
              onKeyDown={(e) => rowKeyDown(e, i)}
              className={cn(
                'relative min-w-0 rounded-lg border bg-card p-2 pr-5 text-sm outline-none sm:p-3 sm:pr-6 sm:text-base',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                !disabled && 'cursor-grab touch-none select-none hover:bg-accent/50',
                selected && 'border-primary bg-primary/5',
                row.result === true && 'border-green-600 dark:border-green-500 bg-green-500/10',
                row.result === false && 'border-red-600 dark:border-red-500 bg-red-500/10',
                row.result === null && 'border-red-600/50 dark:border-red-500/50'
              )}
            >
              <div className="flex items-start gap-1.5">
                <div className="min-w-0 flex-1 wrap-break-word [&_.katex-display]:overflow-x-auto">{row.label}</div>
                {row.result === true && <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" aria-label="Correct" />}
                {row.result === false && <X className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-label="Incorrect" />}
                {target && !disabled && (
                  <button
                    type="button"
                    aria-label="Remove connection"
                    title="Remove connection"
                    className="-mr-1 -mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onDisconnect(i) }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <span id={`${idBase}-row-${i}-state`} className="sr-only">
                {target ? `Connected to ${target}` : 'Not connected'}
              </span>
              {row.extra}
              {/* Connector dot on the right edge. */}
              <span
                ref={(el) => { rowDotRefs.current[i] = el }}
                aria-hidden="true"
                className={cn(
                  'absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 bg-background',
                  target || selected ? 'border-primary bg-primary' : 'border-muted-foreground/50'
                )}
              />
            </div>
          )
        })}
      </div>

      {/* Right column: targets */}
      <div className="flex min-w-0 flex-col gap-2">
        {targets.map((t, i) => (
          <button
            key={t}
            type="button"
            ref={(el) => { targetRefs.current[i] = el }}
            data-match-target={t}
            disabled={disabled}
            tabIndex={selectedRow != null ? 0 : -1}
            aria-label={selectedRow != null ? `Connect to ${t}` : t}
            onClick={() => connectSelected(i)}
            onKeyDown={(e) => targetKeyDown(e, i)}
            className={cn(
              'relative min-w-0 rounded-lg border bg-card p-2 pl-5 text-left text-sm wrap-break-word outline-none sm:p-3 sm:pl-6 sm:text-base',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              'disabled:cursor-default',
              !disabled && (selectedRow != null || drag?.moved) && 'border-primary/60 hover:bg-primary/10 cursor-pointer'
            )}
          >
            <span
              ref={(el) => { targetDotRefs.current[i] = el }}
              aria-hidden="true"
              className={cn(
                'absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 bg-background',
                Object.values(answer).includes(t) ? 'border-primary bg-primary' : 'border-muted-foreground/50'
              )}
            />
            {t}
          </button>
        ))}
      </div>

      {/* Connection lines. pointer-events-none: the items stay clickable. */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        {rows.map((row, i) => {
          const a = rowAnchors[i]
          if (!a) return null
          const paths: ReactNode[] = []
          const target = answer[String(i)]
          const ti = target ? targets.indexOf(target) : -1
          if (ti >= 0 && targetAnchors[ti] && drag?.row !== i) {
            paths.push(
              <path key="a" data-match-line={i} d={curve(a, targetAnchors[ti])} fill="none" strokeWidth={2.5} strokeLinecap="round" className={lineClass(row.result)} />
            )
          }
          const ki = row.keyTarget ? targets.indexOf(row.keyTarget) : -1
          if (ki >= 0 && targetAnchors[ki]) {
            paths.push(
              <path key="k" data-match-key-line={i} d={curve(a, targetAnchors[ki])} fill="none" strokeWidth={2} strokeDasharray="6 5" strokeLinecap="round" className="stroke-green-600/80 dark:stroke-green-500/80" />
            )
          }
          return paths
        })}
        {drag?.moved && rowAnchors[drag.row] && (
          <path d={curve(rowAnchors[drag.row], drag.at)} fill="none" strokeWidth={2.5} strokeDasharray="4 4" strokeLinecap="round" className="stroke-primary" />
        )}
      </svg>
    </div>
  )
}
