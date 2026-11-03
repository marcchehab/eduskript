'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Printer, Trash2 } from 'lucide-react'
import { usePrintMode } from '@/lib/print/print-mode'
import { MAX_SPACER_PRINT_PX, PAPER_PX_PER_MM, formatPrintLengthCm, parsePrintLength } from '@/lib/print/geometry'

/**
 * Author-placed writing area baked into page content (unlike the per-user
 * annotation spacer in components/annotations/, which is runtime-only). Renders
 * a blank/checkered/lined/dotted box students write on with the pen tool.
 *
 * Reuses the `.spacer-element`/`.spacer-<pattern>` CSS from globals.css shared
 * with the annotation spacer. In edit mode (onChange provided by the client
 * renderer) it shows a bottom vertical resize handle + a pattern/delete toolbar;
 * public render omits both. Edits round-trip to the markdown source by emitting
 * a full replacement `<spacer .../>` tag — see stableOnSpacerChange in
 * markdown-renderer.client.tsx.
 */

export type SpacerPattern = 'blank' | 'checkered' | 'lines' | 'dots'

const PATTERNS: { key: SpacerPattern; label: string }[] = [
  { key: 'blank', label: 'Blank' },
  { key: 'checkered', label: 'Grid' },
  { key: 'lines', label: 'Lines' },
  { key: 'dots', label: 'Dots' },
]

const MIN_HEIGHT = 40
const MAX_HEIGHT = 1000

interface ContentSpacerProps {
  id?: string
  height: number
  pattern: SpacerPattern
  /** Height in the print view, as written: "6cm", "6" (cm), "60mm" or "400px". Unset = same as online. Capped at MAX_SPACER_PRINT_PX. */
  printHeight?: string
  /** Called with the id and the full replacement tag string (empty = delete). If omitted, the component is read-only (public render). */
  onChange?: (id: string | undefined, markdown: string) => void
  sourceLineStart?: string
  sourceLineEnd?: string
}

function buildTag(id: string | undefined, height: number, pattern: SpacerPattern, printHeight?: string): string {
  const idAttr = id ? ` id="${id}"` : ''
  const printAttr = printHeight ? ` print-height="${printHeight}"` : ''
  return `<spacer${idAttr} pattern="${pattern}" height="${Math.round(height)}"${printAttr} />`
}

export function ContentSpacer({ id, height, pattern, printHeight, onChange, sourceLineStart, sourceLineEnd }: ContentSpacerProps) {
  const [currentHeight, setCurrentHeight] = useState(height)
  const printing = usePrintMode()
  const parsedPrintPx = parsePrintLength(printHeight)
  const printPx = parsedPrintPx === undefined ? undefined : Math.min(parsedPrintPx, MAX_SPACER_PRINT_PX)
  // The gizmo shows and takes centimetres; "60mm" in the source shows as "6".
  const cmText = (v: string | undefined) => {
    const px = parsePrintLength(v)
    return px === undefined ? (v ?? '') : String(Math.round((px / PAPER_PX_PER_MM / 10) * 10) / 10)
  }
  const [printDraft, setPrintDraft] = useState(cmText(printHeight))
  // Re-sync the field when the source changes (reset during render, no effect).
  const [printSyncedFor, setPrintSyncedFor] = useState(printHeight)
  if (printSyncedFor !== printHeight) {
    setPrintSyncedFor(printHeight)
    setPrintDraft(cmText(printHeight))
  }
  const commitPrintHeight = () => {
    const draft = printDraft.trim()
    const px = draft ? parsePrintLength(draft) : undefined
    // Unparseable input reverts to the current value.
    if (draft && px === undefined) { setPrintDraft(cmText(printHeight)); return }
    const normalized = px === undefined ? undefined : formatPrintLengthCm(Math.min(px, MAX_SPACER_PRINT_PX))
    setPrintDraft(cmText(normalized))
    if ((normalized ?? '') !== (printHeight ?? '')) onChange?.(id, buildTag(id, currentHeight, pattern, normalized))
  }
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef<{ startY: number; startHeight: number } | null>(null)

  // Follow external edits (e.g. source typed by hand)
  useEffect(() => {
    setCurrentHeight(height)
  }, [height])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStartRef.current = { startY: e.clientY, startHeight: currentHeight }
    setIsDragging(true)
  }, [currentHeight])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragStartRef.current) return
    const { startY, startHeight } = dragStartRef.current
    const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeight + (e.clientY - startY)))
    setCurrentHeight(Math.round(next))
  }, [])

  const handleMouseUp = useCallback(() => {
    if (isDragging && onChange) {
      onChange(id, buildTag(id, currentHeight, pattern, printHeight))
    }
    setIsDragging(false)
    dragStartRef.current = null
  }, [isDragging, onChange, id, currentHeight, pattern, printHeight])

  useEffect(() => {
    if (!isDragging) return
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const changePattern = useCallback((p: SpacerPattern) => {
    onChange?.(id, buildTag(id, currentHeight, p, printHeight))
  }, [onChange, id, currentHeight, printHeight])

  const handleDelete = useCallback(() => {
    onChange?.(id, '')
  }, [onChange, id])

  const dataAttrs: Record<string, string> = {}
  if (sourceLineStart) dataAttrs['data-source-line-start'] = sourceLineStart
  if (sourceLineEnd) dataAttrs['data-source-line-end'] = sourceLineEnd

  return (
    <div
      className={`spacer-element spacer-${pattern} group relative my-4 rounded-md ${onChange ? 'ring-1 ring-border/60' : ''}`}
      style={{ height: `${printing && printPx ? printPx : currentHeight}px` }}
      // Print view: strokes below this spacer move by the height difference
      // (section-anchored-strokes.tsx, data-print-online-height).
      data-print-online-height={printing && printPx ? currentHeight : undefined}
      {...dataAttrs}
    >
      {/* Editor chrome — only when onChange is provided */}
      {onChange && (
        <>
          {/* Pattern + delete toolbar (always visible on hover) */}
          <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded border border-border/50 bg-background/95 p-0.5 opacity-60 backdrop-blur-sm transition-opacity group-hover:opacity-100">
            {PATTERNS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => changePattern(key)}
                title={label}
                className={`h-6 w-6 overflow-hidden rounded transition-colors ${
                  pattern === key ? 'ring-2 ring-primary' : 'hover:bg-accent'
                }`}
              >
                <span className="spacer-preview block h-full w-full">
                  <span className={`spacer-element spacer-${key} block h-full w-full`} />
                </span>
              </button>
            ))}
            <span className="mx-0.5 w-px self-stretch bg-border" />
            <label className="flex items-center gap-0.5 px-1 text-[11px] text-muted-foreground" title={`Height when printed, in cm, at most ${formatPrintLengthCm(MAX_SPACER_PRINT_PX).replace('cm', '')} (empty = same as online)`}>
              <Printer className="h-3.5 w-3.5" />
              <input
                aria-label="Print height in cm"
                value={printDraft}
                placeholder="auto"
                onChange={(e) => setPrintDraft(e.target.value)}
                onBlur={commitPrintHeight}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitPrintHeight() } }}
                className="w-9 rounded border border-border bg-background px-1 py-0 text-[11px]"
              />
              cm
            </label>
            <span className="mx-0.5 w-px self-stretch bg-border" />
            <button
              type="button"
              onClick={handleDelete}
              title="Delete spacer"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Height indicator */}
          <div className={`pointer-events-none absolute left-2 top-2 z-10 rounded bg-background/95 px-1.5 py-0.5 font-mono text-[10px] text-foreground transition-opacity ${
            isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}>
            {Math.round(currentHeight)}px
          </div>

          {/* Bottom vertical resize handle */}
          <div
            onMouseDown={handleMouseDown}
            className={`absolute inset-x-0 bottom-0 flex h-5 cursor-ns-resize items-end justify-center transition-opacity ${
              isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            <span className="mb-1 h-1 w-8 rounded-full bg-primary/50" />
          </div>
        </>
      )}
    </div>
  )
}
