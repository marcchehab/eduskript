'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { registerEditor } from './mounted-registry'

// When true, descendant DeferredMounts skip lazy deferral and mount immediately.
// Set by contexts where deferred mounting is unsafe because content is revealed
// dynamically rather than scrolled to — specifically StageFlow (<exam-stage>):
// a later stage isn't in the DOM at all until the student hands in the prior
// one, so it must mount fully-formed the instant it appears (no placeholder
// flash, no dependence on IntersectionObserver firing for just-inserted nodes
// mid-exam). Cheaper and more robust than threading an isExam flag through every
// renderer. Default false so normal pages still lazy-mount.
export const EagerMountContext = createContext(false)

// Defers mounting an expensive child (a full CodeEditor: CodeMirror view +
// language modules + a stack of effects) until it scrolls near the viewport.
//
// Why: each editor's mount runs a heavy passive-effect pass (CodeMirror
// EditorView construction, autosave/version/highlight wiring). A long page with
// many editors mounts them all in a single React commit — measured at ~48% of
// total page-load CPU for 40 editors, producing multi-second main-thread blocks
// on weaker devices. Deferring off-screen editors spreads that work across
// scroll instead of front-loading it.
//
// Once mounted we STAY mounted (no unmount on scroll-away): CodeMirror state and
// unsaved edits live in the view, and remount jank/data-loss would be worse than
// the memory saved. So this is "mount lazily, then persist".
//
// Orphan-detection note: the orphaned-versions feature compares IndexedDB-saved
// componentIds against the set of editors *present on the page* (mounted-registry).
// A deferred editor isn't mounted yet, so we register its id here, eagerly, to
// keep it out of the false-orphan set until the real editor mounts (and registers
// itself too — the registry Set makes the duplicate add/remove idempotent).
export function DeferredMount({
  pageId,
  componentId,
  estimatedHeight,
  placeholder,
  eager = false,
  children,
}: {
  pageId?: string
  componentId: string
  estimatedHeight: number
  placeholder: ReactNode
  // Skip deferral and mount immediately (exam mode, or no IntersectionObserver).
  eager?: boolean
  children: ReactNode
}) {
  // Eager if explicitly requested (exam-tagged block) OR if an ancestor forces
  // it (inside a StageFlow — see EagerMountContext). Read at first render so the
  // editor mounts on the same commit its stage is revealed.
  const forcedEager = useContext(EagerMountContext)
  const [mounted, setMounted] = useState(eager || forcedEager)
  const ref = useRef<HTMLDivElement>(null)

  // Keep this editor id in the mounted-registry for the whole block lifetime so
  // orphan detection doesn't flag a not-yet-scrolled-to editor as orphaned.
  useEffect(() => {
    if (!pageId) return
    return registerEditor(pageId, componentId)
  }, [pageId, componentId])

  useEffect(() => {
    if (mounted) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      // No observer support (ancient browser): mount immediately rather than
      // leave an editor that can never come into existence. One-shot.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional no-IO fallback
      setMounted(true)
      return
    }
    // root: null (viewport). Public/exam pages scroll inside #scroll-container,
    // but viewport-relative intersection still fires correctly for elements
    // inside a nested scroller, and null also covers the fullscreen slide
    // presenter (its own overlay) — verified empirically. rootMargin pre-mounts
    // ~one screenful early so the editor is ready before it's actually seen.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMounted(true)
          io.disconnect()
        }
      },
      { rootMargin: '800px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [mounted])

  // Printing forces every editor to mount so a printed/PDF page isn't a wall of
  // placeholders. (Most public pages print the mounted DOM as-is.)
  useEffect(() => {
    if (mounted || typeof window === 'undefined') return
    const onBeforePrint = () => setMounted(true)
    window.addEventListener('beforeprint', onBeforePrint)
    return () => window.removeEventListener('beforeprint', onBeforePrint)
  }, [mounted])

  if (mounted) return <>{children}</>

  // Fixed height + overflow:hidden bounds the reservation to estimatedHeight
  // (clamped to the editor's min/max). This keeps the placeholder from
  // overshooting on long snippets — an unbounded, content-sized placeholder
  // that's much taller than the editor makes the page shrink on mount, which
  // resizes the full-page annotation canvas and reflows content (severe CLS).
  // The reservation isn't pixel-exact across environments, but the 800px
  // rootMargin means the small swap-time correction happens off-screen, so
  // visible-content shift stays ~0. The code may clip here; that's fine, the
  // placeholder is transient and mostly off-screen.
  return (
    <div ref={ref} style={{ height: estimatedHeight, overflow: 'hidden' }}>
      {placeholder}
    </div>
  )
}
