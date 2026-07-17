'use client'

/**
 * Teacher-only timeline of a student's text-answer autosave snapshots for one
 * quiz component, newest first. Mirrors the code editor's snapshot list. Fetches
 * the generic /component-snapshots route (teacher-of-student gated), so this
 * must only be rendered in grade mode — student review mode would 403.
 *
 * Clicking a row expands that snapshot's text inline (read-only); it does not
 * touch the live answer widget rendered above it. Related: [[quiz]].
 */

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { QuizData } from '@/lib/userdata/types'

interface Snapshot {
  id: string
  kind: string
  label: string | null
  createdAt: string
  payload: unknown
}

export function TextAnswerHistory({
  pageId,
  studentId,
  componentId,
}: {
  pageId: string
  studentId: string
  componentId: string
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const url = `/api/exams/${pageId}/component-snapshots?studentId=${encodeURIComponent(
      studentId,
    )}&componentId=${encodeURIComponent(componentId)}`
    fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (active) setSnapshots(j.snapshots as Snapshot[])
      })
      .catch(() => {
        if (active) setSnapshots([])
      })
    return () => {
      active = false
    }
  }, [pageId, studentId, componentId])

  if (!snapshots || snapshots.length === 0) return null

  return (
    <div className="mt-2 rounded-md border bg-card px-2 py-1.5 text-xs">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Answer history ({snapshots.length})
      </div>
      <ul className="m-0! list-none! p-0! max-h-40 space-y-0.5 overflow-y-auto">
        {snapshots.map((s) => {
          const text = (s.payload as QuizData | null)?.textAnswer ?? ''
          const open = openId === s.id
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : s.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-accent/50',
                  open && 'bg-accent/50',
                )}
              >
                <span className="tabular-nums text-[10px] text-muted-foreground">
                  {new Date(s.createdAt).toLocaleTimeString()}
                </span>
                <span className="flex-1 truncate text-muted-foreground">
                  {text.replace(/\s+/g, ' ').trim().slice(0, 80) || '(empty)'}
                </span>
              </button>
              {open && (
                <pre className="mb-1 mt-1 max-h-48 overflow-auto whitespace-pre-wrap wrap-break-word rounded bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
                  {text || '(empty)'}
                </pre>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
