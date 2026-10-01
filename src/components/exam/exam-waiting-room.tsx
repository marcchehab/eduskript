/**
 * Exam Waiting Room
 *
 * Rendered by /exam/[domain]/[skriptSlug]/[pageSlug] when the student's
 * effective exam state is 'lobby': they may enter, but the exam hasn't started.
 * ('closed' and 'hidden' show ExamLockedPage instead — a student can't enter.)
 *
 * How it leaves the waiting room: it subscribes to the exam-state SSE channel
 * and reloads the page on any state change that applies to this student; the
 * server then re-resolves the state and renders the exam (or the locked page).
 * A 20s poll and a manual refresh button cover a missed event.
 *
 * Event filtering matters here: the channel carries class-level changes AND
 * per-student overrides for every student in the class, and the stream's initial
 * message always reports the CLASS row. Reloading on an event that doesn't apply
 * to this student would just re-render the waiting room — an endless reload loop
 * when the class row says 'open' but the student's override says 'lobby'.
 */

'use client'

import { useEffect, useState, useRef } from 'react'
import { Clock, Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HandInButton } from './hand-in-button'
import { useIsInSEB } from '@/hooks/use-is-in-seb'

interface ExamWaitingRoomProps {
  pageId: string
  /** Class whose ExamState row produced the 'lobby' state — the SSE channel. */
  classId: string
  examTitle: string
  /** Teacher's active RSA-OAEP public key for the offline backup feature. */
  backupPublicKeyJwk?: JsonWebKey
  backupKeyId?: string
  studentId?: string
  skriptId?: string
  /**
   * True when a per-student ExamState row (not the class row) put this student
   * in the lobby. Class-level events are then ignored — see the file comment.
   */
  hasStudentOverride?: boolean
}

export function ExamWaitingRoom({
  pageId,
  classId,
  examTitle,
  backupPublicKeyJwk,
  backupKeyId,
  studentId,
  skriptId,
  hasStudentOverride = false,
}: ExamWaitingRoomProps) {
  const [isConnected, setIsConnected] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)
  // One reload only — React 18 StrictMode double-mounts in dev, and a burst of
  // events must not stack reloads.
  const reloadedRef = useRef(false)
  // Handing in from the lobby submits an empty exam and locks the student out
  // until the teacher takes it back — only worth offering inside SEB, where it
  // is the only way to quit the kiosk browser before the exam starts.
  const isInSEB = useIsInSEB()

  useEffect(() => {
    const leaveLobby = () => {
      if (reloadedRef.current) return
      reloadedRef.current = true
      window.location.reload()
    }

    /** Does this state change apply to the student sitting in this lobby? */
    const appliesToMe = (data: { studentId?: string | null }) => {
      // A per-student event is only ours if it names us.
      if (data.studentId) return data.studentId === studentId
      // A class-level event is overridden for a student with their own row.
      return !hasStudentOverride
    }

    const eventSource = new EventSource(`/api/exams/${pageId}/state/stream?classId=${classId}`)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      setIsConnected(true)
    }

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type !== 'exam-state-change') return
        // Any state but 'lobby' means the server will now render something else
        // (the exam, or the locked page if the teacher closed/un-assigned it).
        if (appliesToMe(data) && data.state !== 'lobby') leaveLobby()
      } catch (error) {
        console.error('Error parsing SSE message:', error)
      }
    }

    eventSource.onerror = () => {
      setIsConnected(false)
      // EventSource will automatically try to reconnect
    }

    // Poll fallback: covers a dropped stream, a backgrounded tab that missed the
    // event, and a change on another class's row (which this channel never
    // carries). Reads the single row that decides this student's state.
    const pollUrl = `/api/exams/${pageId}/state?classId=${classId}` +
      (hasStudentOverride && studentId ? `&studentId=${encodeURIComponent(studentId)}` : '')
    const poll = setInterval(async () => {
      try {
        const res = await fetch(pollUrl, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (data.state && data.state !== 'lobby') leaveLobby()
      } catch {
        // Offline or transient — the next tick retries.
      }
    }, 20000)

    return () => {
      clearInterval(poll)
      eventSource.close()
      eventSourceRef.current = null
    }
  }, [pageId, classId, studentId, hasStudentOverride])

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Pulsing icon */}
        <div className="flex justify-center">
          <div className="relative">
            <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center">
              <Clock className="w-12 h-12 text-primary" />
            </div>
            {/* Pulse rings - slower animation (3s instead of default 1s) */}
            <div
              className="absolute inset-0 rounded-full bg-primary/20"
              style={{ animation: 'ping 3s cubic-bezier(0, 0, 0.2, 1) infinite' }}
            />
            <div
              className="absolute inset-0 rounded-full bg-primary/10"
              style={{ animation: 'ping 3s cubic-bezier(0, 0, 0.2, 1) infinite', animationDelay: '1.5s' }}
            />
          </div>
        </div>

        {/* Title */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">
            Waiting for Exam to Open
          </h1>
          <p className="text-lg text-muted-foreground">
            {examTitle}
          </p>
        </div>

        {/* Status */}
        <div className="space-y-3">
          <p className="text-muted-foreground">
            The exam will begin when your teacher opens it.
          </p>
          <p className="text-sm text-muted-foreground">
            Please stay on this page. It will automatically update when the exam starts.
          </p>
        </div>

        {/* Manual refresh — fallback when the auto-update event is missed (e.g.
            a backgrounded tab or a dropped connection in Safe Exam Browser).
            Reloads the page, which re-checks the exam state server-side. */}
        <div className="space-y-2">
          <Button
            variant="outline"
            onClick={() => {
              setIsRefreshing(true)
              window.location.reload()
            }}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Checking…' : 'Check if the exam is open'}
          </Button>
          <p className="text-xs text-muted-foreground">
            If the exam doesn&apos;t open on its own, tap to check again.
          </p>
        </div>

        {/* Connection status */}
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          {isConnected ? (
            <>
              <Wifi className="w-4 h-4 text-green-500" />
              <span>Connected - waiting for teacher</span>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4 text-yellow-500" />
              <span>Connecting...</span>
            </>
          )}
        </div>

        {/* Hand in option — SEB only (see isInSEB above) */}
        {isInSEB && (
        <div className="pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground mb-3">
            Need to leave before the exam starts?
          </p>
          <div className="flex flex-col items-center gap-2">
            <HandInButton
              pageId={pageId}
              publicKeyJwk={backupPublicKeyJwk}
              keyId={backupKeyId}
              studentId={studentId}
              skriptId={skriptId}
            />
          </div>
        </div>
        )}
      </div>
    </div>
  )
}
