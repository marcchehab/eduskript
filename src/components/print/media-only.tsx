'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePrintMode } from '@/lib/print/print-mode'

/**
 * `<onlyfor print>` / `<onlyfor screen>`. The CSS classes (globals.css) also
 * cover a plain browser print without the print view. In the print view the
 * element carries data-print-online-height so strokes below it move by the
 * height it adds or removes (section-anchored-strokes.tsx): print-only content
 * was 0px online; screen-only content is replaced by a 0px marker that
 * remembers its online height (unknown, so 0, when the page was opened with
 * ?print and never laid out online).
 *
 * In the editor preview print-only content is shown with a label instead of
 * hidden, so authors see what they wrote.
 */
export function MediaOnly({ media, editor, children }: { media: 'print' | 'screen'; editor?: boolean; children: ReactNode }) {
  const printing = usePrintMode()
  const ref = useRef<HTMLDivElement>(null)
  const [onlineHeight, setOnlineHeight] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (media !== 'screen' || printing || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setOnlineHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [media, printing])

  if (editor && media === 'print') {
    return (
      <div className="relative rounded border border-dashed border-border px-3 pt-4 opacity-70">
        <span className="absolute left-2 top-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">Print only</span>
        {children}
      </div>
    )
  }
  if (media === 'print') {
    return <div className="only-print" data-print-online-height={printing ? '0' : undefined}>{children}</div>
  }
  if (printing) {
    return <div aria-hidden="true" data-print-online-height={String(onlineHeight)} />
  }
  return <div ref={ref} className="only-screen">{children}</div>
}
