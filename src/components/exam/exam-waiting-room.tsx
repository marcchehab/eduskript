/**
 * Exam Waiting Room Component
 *
 * Shown to students when the exam state is "closed".
 * Uses SSE for real-time updates when teacher opens the exam.
 *
 * Features:
 * - Pulsing animation to show activity
 * - SSE connection for instant updates
 * - Fallback polling if SSE fails
 * - Hand in & Quit option to leave before exam starts
 */

'use client'

import { useEffect, useState, useRef } from 'react'
import { Clock, Wifi, WifiOff } from 'lucide-react'
import { HandInButton } from './hand-in-button'

interface ExamWaitingRoomProps {
  pageId: string
  classId: string
  examTitle: string
  /** Teacher's active RSA-OAEP public key for the offline backup feature. */
  backupPublicKeyJwk?: JsonWebKey
  backupKeyId?: string
  studentId?: string
  skriptId?: string
}

export function ExamWaitingRoom({
  pageId,
  classId,
  examTitle,
  backupPublicKeyJwk,
  backupKeyId,
  studentId,
  skriptId,
}: ExamWaitingRoomProps) {
  const [isConnected, setIsConnected] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    // Connect to SSE stream for real-time updates
    const url = `/api/exams/${pageId}/state/stream?classId=${classId}`
    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      setIsConnected(true)
    }

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        // If exam is now open, reload the page to show the exam content
        if (data.type === 'exam-state-change' && data.state === 'open') {
          window.location.reload()
        }
      } catch (error) {
        console.error('Error parsing SSE message:', error)
      }
    }

    eventSource.onerror = () => {
      setIsConnected(false)
      // EventSource will automatically try to reconnect
    }

    return () => {
      eventSource.close()
      eventSourceRef.current = null
    }
  }, [pageId, classId])

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4">
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

        {/* Hand in option */}
        <div className="pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground mb-3">
            Need to leave before the exam starts?
          </p>
          <HandInButton
            pageId={pageId}
            publicKeyJwk={backupPublicKeyJwk}
            keyId={backupKeyId}
            studentId={studentId}
            skriptId={skriptId}
          />
        </div>
      </div>
    </div>
  )
}
