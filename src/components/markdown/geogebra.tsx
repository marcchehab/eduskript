'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { SkriptFilesData } from '@/lib/skript-files'
import { resolveUrl } from '@/lib/skript-files'
import { useSyncedUserData } from '@/lib/userdata'
import { useStudentSnapshot } from '@/contexts/student-snapshot-context'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { GeogebraProgressBar } from './geogebra-progress-bar'

// --- deployggb.js singleton loader -----------------------------------------
// Mirrors the sql.js CDN loader (src/lib/sql-executor.client.ts): one shared
// <script> load for N applets on a page, deduped via the in-flight promise.
let scriptLoaded = false
let scriptLoading: Promise<void> | null = null

/** Subset of the GGBApplet API object (from appletOnLoad / getAppletObject). */
interface GGBApi {
  getBase64(): string
  getValue(objName: string): number
  setBase64(base64: string, callback?: () => void): void
  registerUpdateListener(fn: (objName: string) => void): void
  registerAddListener(fn: (objName: string) => void): void
  registerRemoveListener(fn: (objName: string) => void): void
  registerClearListener(fn: () => void): void
}

declare global {
  interface Window {
    GGBApplet?: new (
      params: Record<string, unknown>,
      html5NoWebSimple?: boolean,
    ) => { inject(containerId: string): void }
  }
}

function loadDeployGGB(): Promise<void> {
  if (scriptLoaded) return Promise.resolve()
  if (scriptLoading) return scriptLoading
  scriptLoading = new Promise<void>((resolve, reject) => {
    if (typeof window !== 'undefined' && window.GGBApplet) {
      scriptLoaded = true
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = 'https://www.geogebra.org/apps/deployggb.js'
    script.async = true
    script.onload = () => {
      scriptLoaded = true
      resolve()
    }
    script.onerror = () => {
      scriptLoading = null
      reject(new Error('Failed to load GeoGebra (deployggb.js)'))
    }
    document.head.appendChild(script)
  })
  return scriptLoading
}

// #paper content width (1280 − 2×192 padding). Mirrors pdf-embed.tsx — the
// applet wants an explicit px width, so we cap the measured container width.
const MAX_WIDTH = 896
const SAVE_DEBOUNCE_MS = 1500

/** Persisted student state — the construction, plus correctness when the
 *  exercise defines a boolean to check (correctWhen). */
interface GeogebraData {
  ggbBase64?: string
  correct?: boolean
  hasAttempted?: boolean
}

interface GeogebraProps {
  /** Online material id (from a geogebra.org share link). Primary source. */
  materialId?: string
  /** Reserved: filename of an uploaded .ggb (resolved via SkriptFiles). */
  src?: string
  /** Pixel height (string from markdown attr). */
  height?: string
  /** Pixel width; defaults to the measured container width (capped). */
  width?: string
  showToolbar?: boolean
  showAlgebraInput?: boolean
  /** Name of a boolean object in the construction that is true when the
   *  student's answer is correct (e.g. a self-checking material's `correct`).
   *  When set, the component captures correctness for the teacher's tally. */
  correctWhen?: string
  pageId?: string
  files: SkriptFilesData
}

/**
 * Embeds an interactive GeoGebra applet via deployggb.js, loading a teacher's
 * online material by id. Lazy-mounts (IntersectionObserver) since the CDN
 * payload is heavy. Persists the student's construction to the page's userData
 * so exam hand-in snapshots it for grading, and — when a teacher is viewing a
 * student's submission — loads that snapshot read-only (mirrors the code
 * editor's snapshot playback).
 */
export function Geogebra({
  materialId,
  src,
  height,
  width,
  showToolbar = false,
  showAlgebraInput = false,
  correctWhen,
  pageId,
  files,
}: GeogebraProps) {
  const rawId = useId()
  const divId = `ggb-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`
  // Unique class on the wrapper: GeoGebra scales the applet to fill this
  // container (scaleContainerClass) and docks the math keyboard inside it
  // (detachedKeyboardParent) — so the applet uses the full page width and the
  // keyboard doesn't span the whole #paper.
  const scalerClass = `${divId}-box`
  // Stable per-block component id for persistence/grading (material/src based so
  // it survives remounts; falls back to the React id for inline constructions).
  const componentId = `geogebra-${materialId || src || rawId.replace(/[^a-zA-Z0-9]/g, '')}`

  const wrapperRef = useRef<HTMLDivElement>(null)
  const injectRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<GGBApi | null>(null)

  const [visible, setVisible] = useState(false)
  const [ready, setReady] = useState(false)

  // An explicit height pins the applet to that pixel height; otherwise we let
  // GeoGebra compute height to fit the material's content (autoHeight) so tall
  // materials aren't clipped (applets don't scroll). heightPx is the skeleton/
  // placeholder floor only.
  const hasExplicitHeight = !!(height && parseInt(height, 10) > 0)
  const heightPx = parseInt(height || '', 10) || 450
  const resolvedSrc = src ? resolveUrl(files, src) || src : undefined

  // Persistence + teacher snapshot playback (no-ops to defaults off exam pages).
  // Synced (not local-only): the construction + correctness reach the server so
  // the teacher's class tally / grading can read them, like quiz & SQL editors.
  const { data: savedData, updateData } = useSyncedUserData<GeogebraData>(pageId || '', componentId, null)
  const { isViewing: isViewingSnapshot, snapshot: studentSnapshot } = useStudentSnapshot(componentId)
  const { selectedClass, isTeacher } = useTeacherClass()

  // Refs so the once-registered GGB listeners read live values.
  const isViewingRef = useRef(isViewingSnapshot)
  useEffect(() => { isViewingRef.current = isViewingSnapshot }, [isViewingSnapshot])
  const updateDataRef = useRef(updateData)
  useEffect(() => { updateDataRef.current = updateData }, [updateData])

  // Lazy: only load + inject once the block scrolls near the viewport.
  useEffect(() => {
    if (visible) return
    const el = wrapperRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      // No observer support (ancient browser): load immediately. One-shot.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional no-IO fallback
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  // Inject the applet once visible. Runs once per instance (deps are stable
  // per markdown block).
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    // Capture the inject node now so cleanup uses the same element (the div is
    // stable for the component's life; this also satisfies the ref-in-cleanup lint).
    const injectEl = injectRef.current

    loadDeployGGB()
      .then(() => {
        if (cancelled || !window.GGBApplet) return
        const measured = wrapperRef.current?.clientWidth || 800
        const px = Math.min(width ? parseInt(width, 10) || measured : measured, MAX_WIDTH)

        const params: Record<string, unknown> = {
          // Scale to fit the wrapper width exactly (no fixed px width, which
          // conflicted with the container scaling and caused a stray internal
          // scrollbar). Small materials scale up via allowUpscale.
          scaleContainerClass: scalerClass,
          allowUpscale: true,
          // Fixed height only when the teacher pinned one; otherwise autoHeight
          // computes the height to fit the material's content (no clipping).
          ...(hasExplicitHeight ? { height: heightPx, width: px } : { autoHeight: true }),
          // Dock the math keyboard inside the wrapper, not across the whole page.
          detachedKeyboardParent: `.${scalerClass}`,
          showToolBar: showToolbar,
          showAlgebraInput,
          showMenuBar: false,
          showResetIcon: true,
          enableRightClick: false,
          borderColor: null,
          appletOnLoad: (api: GGBApi) => {
            if (cancelled) return
            apiRef.current = api
            setReady(true)
            // Capture student work (debounced); never while a teacher is viewing
            // a snapshot, and only when persistence is wired (pageId present).
            const onChange = () => {
              if (isViewingRef.current || !pageId) return
              if (saveTimer) clearTimeout(saveTimer)
              saveTimer = setTimeout(() => {
                try {
                  const payload: GeogebraData = { ggbBase64: api.getBase64() }
                  // When the exercise defines a correctness boolean, capture it
                  // so the teacher's class tally (GeogebraProgressBar) can count.
                  if (correctWhen) {
                    payload.correct = api.getValue(correctWhen) === 1
                    payload.hasAttempted = true
                  }
                  // Sync correctness promptly so the teacher's live tally
                  // updates; plain embeds sync on the batched path.
                  updateDataRef.current(payload, { immediate: !!correctWhen })
                } catch { /* ignore */ }
              }, SAVE_DEBOUNCE_MS)
            }
            api.registerUpdateListener(onChange)
            api.registerAddListener(onChange)
            api.registerRemoveListener(onChange)
            api.registerClearListener(onChange)
          },
        }
        if (materialId) params.material_id = materialId
        else if (resolvedSrc) params.filename = resolvedSrc
        // Only force an app type for a truly blank applet; a material/.ggb keeps
        // its own authored app + view (forcing 'classic' showed the wrong layout).
        else params.appName = 'classic'

        const applet = new window.GGBApplet(params, true)
        applet.inject(divId)
      })
      .catch(() => { /* network/CDN failure — leave the skeleton */ })

    return () => {
      cancelled = true
      if (saveTimer) clearTimeout(saveTimer)
      apiRef.current = null
      // GeoGebra has no destroy() on the wrapper — clear the injected DOM so the
      // applet's canvas/iframe is released on unmount. React never manages this
      // div's children, so clearing it directly is safe.
      if (injectEl) injectEl.innerHTML = ''
      setReady(false)
    }
  }, [visible, materialId, resolvedSrc, divId, scalerClass, hasExplicitHeight, heightPx, width, showToolbar, showAlgebraInput, pageId, correctWhen])

  // Restore the student's own saved construction ONCE after the applet is ready
  // (not while a teacher is viewing, and not on every later save — that would
  // clobber in-progress work).
  const restoredOwnRef = useRef(false)
  useEffect(() => {
    if (!ready || isViewingSnapshot || restoredOwnRef.current) return
    const b64 = savedData?.ggbBase64
    if (b64 && apiRef.current) {
      try { apiRef.current.setBase64(b64) } catch { /* ignore */ }
      restoredOwnRef.current = true
    }
  }, [ready, isViewingSnapshot, savedData])

  // Teacher viewing a student's submission: load that snapshot read-only, and
  // re-apply when switching students. Deduped on the snapshot's createdAt.
  const lastAppliedSnapRef = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || !isViewingSnapshot) {
      lastAppliedSnapRef.current = null
      return
    }
    const payload = studentSnapshot?.payload as GeogebraData | undefined
    const key = studentSnapshot ? `${studentSnapshot.componentId}:${studentSnapshot.createdAt}` : null
    if (!key || lastAppliedSnapRef.current === key) return
    lastAppliedSnapRef.current = key
    if (payload?.ggbBase64 && apiRef.current) {
      try { apiRef.current.setBase64(payload.ggbBase64) } catch { /* ignore */ }
    }
  }, [ready, isViewingSnapshot, studentSnapshot])

  return (
    <div className="my-4">
      <div ref={wrapperRef} className={`relative ${scalerClass}`} style={{ minHeight: heightPx, width: '100%' }}>
        {/* Inject target — React never manages its children (GeoGebra owns them). */}
        <div ref={injectRef} id={divId} />
        {!ready && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
            aria-busy="true"
          >
            Loading GeoGebra…
          </div>
        )}
      </div>
      {/* Teacher with a class selected: live "how many got it right" tally. */}
      {correctWhen && pageId && isTeacher && selectedClass && !isViewingSnapshot && (
        <GeogebraProgressBar
          classId={selectedClass.id}
          className={selectedClass.name}
          pageId={pageId}
          componentId={componentId}
        />
      )}
    </div>
  )
}
