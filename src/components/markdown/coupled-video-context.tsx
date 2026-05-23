'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react'
import { Link2, Link2Off } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * CoupledVideoContext — the page-level glue for the "gated video" format.
 *
 * A video (YouTube or Mux) auto-pauses at author-defined marks and resumes
 * when the student clears a check. The gate lives on the *check*, not the
 * video: a `<question gate-at="1:30">` or a code-editor stage carries its own
 * timestamp and calls `markPassed` when it transitions to passing.
 *
 * Design mirrors SurveyProvider (survey-provider.tsx): mounted only when the
 * page actually contains a coupled video, collects registrations from
 * descendant components rather than enumerating them up-front.
 *
 * **Soft gating.** The context only holds state (gates, passed set, coupled
 * flag). The *video* owns playback and decides when to pause — see
 * `useVideoGate`. Manual play always works; auto-pause is just the convenient
 * default path. Coupling is a per-page toggle persisted in localStorage; the
 * author sets the initial state, the user can flip it anytime.
 */

export interface VideoGate {
  /** Stable key, e.g. `quiz-q1` or `check-ean-stage-2`. */
  key: string
  /** Mark timestamp in seconds. */
  time: number
}

export interface CoupledVideoContextValue {
  coupled: boolean
  setCoupled: (v: boolean) => void
  /** Register or refresh a gate. Idempotent by key. */
  registerGate: (key: string, time: number) => void
  unregisterGate: (key: string) => void
  /** Mark a gate satisfied (its check passed). No-op if already passed. */
  markPassed: (key: string) => void
  isPassed: (key: string) => boolean
  /** Gates sorted ascending by time. New array identity on every change. */
  gates: VideoGate[]
  /** Bumped whenever the passed-set changes, so the video can re-evaluate. */
  passedVersion: number
}

const CoupledVideoContext = createContext<CoupledVideoContextValue | null>(null)

export function useCoupledVideo(): CoupledVideoContextValue | null {
  return useContext(CoupledVideoContext)
}

const COUPLED_STORAGE_KEY = (pageId: string) => `coupled-video:${pageId}:coupled`

/**
 * Parse an author timecode into seconds. Accepts `"90"`, `"1:30"`, or
 * `"1:02:03"`. Returns NaN for unparseable input (caller should skip).
 */
export function parseTimecode(raw: string | number | undefined): number {
  if (raw == null) return NaN
  if (typeof raw === 'number') return raw
  const trimmed = raw.trim()
  if (trimmed === '') return NaN
  if (!trimmed.includes(':')) return Number(trimmed)
  const parts = trimmed.split(':').map((p) => Number(p))
  if (parts.some((n) => Number.isNaN(n))) return NaN
  // [h, m, s] or [m, s]
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

export function CoupledVideoProvider({
  pageId,
  initialCoupled,
  children,
}: {
  pageId: string
  /** Author-set default (from `coupled="true|false"` on the video tag). */
  initialCoupled: boolean
  children: ReactNode
}) {
  // User toggle wins over the author default, persisted per page. Resolved in
  // an effect (not initial state) so SSR/first paint stays deterministic.
  const [coupled, setCoupledState] = useState(initialCoupled)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(COUPLED_STORAGE_KEY(pageId))
    if (stored === 'true' || stored === 'false') {
      // Persisted user choice overrides the author default after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCoupledState(stored === 'true')
    }
  }, [pageId])

  const setCoupled = useCallback(
    (v: boolean) => {
      setCoupledState(v)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(COUPLED_STORAGE_KEY(pageId), String(v))
      }
    },
    [pageId],
  )

  // Gate registry. Kept in a ref for stable register/unregister callbacks;
  // mirrored into state (sorted) so consumers re-render when gates change.
  const gatesRef = useRef<Map<string, number>>(new Map())
  const [gates, setGates] = useState<VideoGate[]>([])

  const syncGates = useCallback(() => {
    const next = Array.from(gatesRef.current.entries())
      .map(([key, time]) => ({ key, time }))
      .sort((a, b) => a.time - b.time)
    setGates(next)
  }, [])

  const registerGate = useCallback(
    (key: string, time: number) => {
      if (Number.isNaN(time)) return
      if (gatesRef.current.get(key) === time) return
      gatesRef.current.set(key, time)
      syncGates()
    },
    [syncGates],
  )

  const unregisterGate = useCallback(
    (key: string) => {
      if (!gatesRef.current.has(key)) return
      gatesRef.current.delete(key)
      syncGates()
    },
    [syncGates],
  )

  const passedRef = useRef<Set<string>>(new Set())
  const [passedVersion, setPassedVersion] = useState(0)

  const markPassed = useCallback((key: string) => {
    if (passedRef.current.has(key)) return
    passedRef.current.add(key)
    setPassedVersion((v) => v + 1)
  }, [])

  const isPassed = useCallback((key: string) => passedRef.current.has(key), [])

  const value = useMemo<CoupledVideoContextValue>(
    () => ({
      coupled,
      setCoupled,
      registerGate,
      unregisterGate,
      markPassed,
      isPassed,
      gates,
      passedVersion,
    }),
    [coupled, setCoupled, registerGate, unregisterGate, markPassed, isPassed, gates, passedVersion],
  )

  return <CoupledVideoContext.Provider value={value}>{children}</CoupledVideoContext.Provider>
}

/**
 * Register a gate with the context for the lifetime of the calling component.
 * No-op when there is no provider (decoupled / no coupled video on the page).
 */
export function useGate(key: string, timeSeconds: number | undefined) {
  const ctx = useCoupledVideo()
  const time = timeSeconds
  useEffect(() => {
    if (!ctx || time == null || Number.isNaN(time)) return
    ctx.registerGate(key, time)
    return () => ctx.unregisterGate(key)
    // ctx identity changes on every passedVersion bump; we only care about
    // register/unregister, which are stable callbacks, so depend on those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, time, ctx?.registerGate, ctx?.unregisterGate])
}

// Pause slightly before the mark: YouTube's infoDelivery currentTime arrives
// in coarse ~250ms ticks, so without lead time the video can overshoot the
// mark by a noticeable amount before we catch it.
const GATE_LEAD_SECONDS = 0.35

/**
 * Playback-gating logic shared by the YouTube and Mux video components.
 *
 * The video owns its player; this hook tells it *when* to pause and resume.
 * Call `onTimeUpdate(currentTimeSeconds)` from the player's time callback and
 * `onManualPlay()` when the user presses play themselves. Wire `pause`/`play`
 * to the underlying player.
 *
 * Behaviour:
 *  - While coupled, on reaching the earliest un-passed, not-yet-encountered
 *    gate, pause and "park" on it. Each gate auto-pauses at most once, so a
 *    manual resume past an unsatisfied gate sticks (soft gating).
 *  - When the parked gate later passes, auto-resume (only if still coupled).
 */
export function useVideoGate(opts: {
  pause: () => void
  play: () => void
}): {
  ctx: CoupledVideoContextValue | null
  onTimeUpdate: (currentTime: number) => void
  onManualPlay: () => void
} {
  const ctx = useCoupledVideo()
  const { pause, play } = opts
  // Keep the latest pause/play in refs so the callbacks below stay stable.
  // Updated in an effect (not during render) per react-hooks/refs.
  const pauseRef = useRef(pause)
  const playRef = useRef(play)
  useEffect(() => {
    pauseRef.current = pause
    playRef.current = play
  })

  const parkedRef = useRef<string | null>(null)
  const encounteredRef = useRef<Set<string>>(new Set())

  const onTimeUpdate = useCallback(
    (currentTime: number) => {
      if (!ctx || !ctx.coupled) return
      for (const gate of ctx.gates) {
        if (ctx.isPassed(gate.key)) continue
        if (encounteredRef.current.has(gate.key)) continue
        if (currentTime >= gate.time - GATE_LEAD_SECONDS) {
          encounteredRef.current.add(gate.key)
          parkedRef.current = gate.key
          pauseRef.current()
          return
        }
        // gates are sorted; the first un-passed future gate ends the scan
        break
      }
    },
    [ctx],
  )

  const onManualPlay = useCallback(() => {
    // User overrode the pause — release the park so we don't fight them.
    parkedRef.current = null
  }, [])

  // Resume when the parked gate's check passes.
  useEffect(() => {
    if (!ctx) return
    const parked = parkedRef.current
    if (parked && ctx.isPassed(parked) && ctx.coupled) {
      parkedRef.current = null
      playRef.current()
    }
  }, [ctx, ctx?.passedVersion, ctx?.coupled])

  return { ctx, onTimeUpdate, onManualPlay }
}

/**
 * Coupling switch, rendered as a centered pill beneath a video. Renders
 * nothing when there's no provider (decoupled page). Coupled = video and
 * checks talk; unlinked = a plain video.
 */
export function CouplingToggle({ className }: { className?: string }) {
  const ctx = useCoupledVideo()
  if (!ctx) return null
  const { coupled, setCoupled } = ctx
  return (
    <span className={cn('mt-2 flex justify-center', className)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setCoupled(!coupled)
        }}
        aria-pressed={coupled}
        title={
          coupled
            ? 'Coupled — the video pauses for checks. Click to unlink.'
            : 'Unlinked — plays as a normal video. Click to couple with checks.'
        }
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
          coupled
            ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
            : 'border-border bg-muted text-muted-foreground hover:bg-muted/70',
        )}
      >
        {coupled ? <Link2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
        <span>{coupled ? 'Coupled — pauses for checks' : 'Unlinked — plays straight through'}</span>
      </button>
    </span>
  )
}
