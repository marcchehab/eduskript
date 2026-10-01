'use client'

import { useState } from 'react'
import { KeyRound, Pencil, X } from 'lucide-react'
import { SolutionPickDialog } from '@/components/dashboard/solution-pick-dialog'
import { solutionFilename } from '@/lib/ai/feedback-context'
import type { SkriptFilesData } from '@/lib/skript-files'

/** Source access for the gizmo, provided by the client renderer (editor only). */
export interface AiFeedbackSolutionApi {
  /** Current solution of the tag on `line`: '' none, null tag not found. */
  get: (line: number) => string | null
  set: (line: number, solution: string | null) => void
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
 * Editor-only bar under an <ai-feedback> tag: shows the hidden reference
 * solution (solution="…") and lets the teacher pick or upload one. Rendered
 * only when the renderer passes `aiFeedbackSolution`, i.e. in the dashboard
 * preview — never on public pages.
 */
export function AiFeedbackSolutionGizmo({ api, sourceLine, files, skriptId }: AiFeedbackSolutionGizmoProps) {
  const [open, setOpen] = useState(false)
  const current = api.get(sourceLine)
  if (current === null) return null

  const previewUrl = current ? files.files[solutionFilename(current)]?.url : undefined

  return (
    <div className="not-prose -mt-2 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground">
      <KeyRound className="h-3.5 w-3.5 shrink-0" />
      {current ? (
        <>
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- tiny editor thumbnail from S3
            <img src={previewUrl} alt="" className="h-8 w-auto rounded border border-border bg-white" />
          )}
          <span className="min-w-0 break-all">
            Solution: <span className="font-mono text-foreground">{current}</span>
            {!previewUrl && <span className="text-destructive"> (file not found)</span>}
          </span>
          <button type="button" onClick={() => setOpen(true)} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent" title="Change solution">
            <Pencil className="h-3 w-3" /> Change
          </button>
          <button type="button" onClick={() => api.set(sourceLine, null)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent" title="Remove solution">
            <X className="h-3 w-3" /> Remove
          </button>
        </>
      ) : (
        <>
          <span>No reference solution. The AI checks without one.</span>
          <button type="button" onClick={() => setOpen(true)} className="ml-auto rounded border border-border px-2 py-0.5 text-foreground hover:bg-accent">
            Provide solution
          </button>
        </>
      )}
      <SolutionPickDialog
        open={open}
        onOpenChange={setOpen}
        skriptId={skriptId}
        files={Object.values(files.files)}
        current={current || null}
        onSelect={(name) => api.set(sourceLine, name)}
        onUploaded={api.onUploaded}
      />
    </div>
  )
}
