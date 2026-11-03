'use client'

import { useState } from 'react'
import { Eye, EyeOff, KeyRound, Pencil, X } from 'lucide-react'
import { SolutionPickDialog } from '@/components/dashboard/solution-pick-dialog'
import { solutionFilename, type LinkedSolution } from '@/lib/ai/feedback-context'
import type { SkriptFilesData } from '@/lib/skript-files'

/** Source access for the gizmo, provided by the client renderer (editor only). */
export interface AiFeedbackSolutionApi {
  /** Current solution of the tag on `line`: '' none, null tag not found. */
  get: (line: number) => string | null
  set: (line: number, solution: string | null) => void
  /** <solution> blocks the server sends with this tag (feedback-context.ts linkedSolutions). */
  solutions: (line: number) => LinkedSolution[]
  /** Insert a <solution hidden> with this drawing/image below the tag; drops a solution="…" attribute. */
  addHidden: (line: number, name: string) => void
  /** Refresh the editor's file list after an upload. */
  onUploaded: () => void
}

interface AiFeedbackSolutionGizmoProps {
  api: AiFeedbackSolutionApi
  sourceLine: number
  files: SkriptFilesData
  skriptId?: string
}

/**
 * Editor-only bar under an <ai-feedback> tag: shows which reference solutions
 * the AI compares with — the linked <solution> blocks (same function the
 * server uses) and the legacy solution="…" attribute — and lets the teacher
 * pick or upload a drawing, which is inserted as a <solution hidden> block. Rendered
 * only when the renderer passes `aiFeedbackSolution`, i.e. in the dashboard
 * preview — never on public pages.
 */
export function AiFeedbackSolutionGizmo({ api, sourceLine, files, skriptId }: AiFeedbackSolutionGizmoProps) {
  const [open, setOpen] = useState(false)
  const current = api.get(sourceLine)
  if (current === null) return null
  const linked = api.solutions(sourceLine)

  const previewUrl = current ? files.files[solutionFilename(current)]?.url : undefined

  return (
    <div className="not-prose -mt-2 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground">
      {(current || linked.length === 0) && <KeyRound className="h-3.5 w-3.5 shrink-0" />}
      {current ? (
        <>
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- tiny editor thumbnail from S3
            <img src={previewUrl} alt="" className="h-8 w-auto rounded border border-border bg-white" />
          )}
          <span className="min-w-0 break-all">
            Solution attribute (hidden): <span className="font-mono text-foreground">{current}</span>
            {!previewUrl && <span className="text-destructive"> (file not found)</span>}
          </span>
          <button type="button" onClick={() => setOpen(true)} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent" title="Change solution">
            <Pencil className="h-3 w-3" /> Change
          </button>
          <button type="button" onClick={() => api.set(sourceLine, null)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent" title="Remove solution">
            <X className="h-3 w-3" /> Remove
          </button>
        </>
      ) : linked.length === 0 ? (
        <>
          <span>No reference solution. The AI checks against the exercise and prompt only.</span>
          <button type="button" onClick={() => setOpen(true)} className="ml-auto rounded border border-border px-2 py-0.5 text-foreground hover:bg-accent">
            Provide solution
          </button>
        </>
      ) : null}
      {linked.map((sol) => (
        <span key={sol.line} className="flex w-full min-w-0 items-center gap-1.5">
          {sol.hidden ? <EyeOff className="h-3.5 w-3.5 shrink-0" /> : <Eye className="h-3.5 w-3.5 shrink-0" />}
          <span className="min-w-0 truncate">
            Compares with: <span className="text-foreground">{sol.title || `Solution (line ${sol.line + 1})`}</span>
            {sol.hidden ? ' — hidden from students' : ' — visible to students, the AI may reveal it'}
          </span>
        </span>
      ))}
      <SolutionPickDialog
        open={open}
        onOpenChange={setOpen}
        skriptId={skriptId}
        files={Object.values(files.files)}
        current={current || null}
        onSelect={(name) => api.addHidden(sourceLine, name)}
        onUploaded={api.onUploaded}
      />
    </div>
  )
}
