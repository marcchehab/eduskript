'use client'

/**
 * Teacher modal for the two-step AI scoring of an exam page:
 *  1. Generate (or hand-edit) a SCORING RUBRIC per exercise — criteria + points.
 *  2. AI-score all students against the rubrics → ComponentScore(source="ai").
 *
 * The AI only emits points (Punkte) + feedback; the override and the grade key
 * are untouched. After scoring, the caller reloads the grading table (AI scores
 * outrank check scores by default, so totals shift unless a teacher override is
 * in effect). Strings are English per project convention.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RubricCriteriaEditor } from '@/components/exam/rubric-criteria-editor'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

interface Question {
  componentId: string
  kind: 'quiz' | 'python'
  questionType: string | null
  label: string | null
  maxPoints: number | null
}

/** AI scoring fits open-ended work (code, free text); auto-scored choice/number
 *  questions are handled by the deterministic check, so they're off by default. */
function aiScorableByDefault(q: Question): boolean {
  return q.kind === 'python' || q.questionType === 'text'
}
interface Criterion {
  id: string
  description: string
  points: number
}
interface Rubric {
  componentId: string
  criteria: Criterion[]
  maxPoints: number | null
  source: string
  model: string | null
}

const sum = (cs: Criterion[]) => Math.round(cs.reduce((s, c) => s + (Number(c.points) || 0), 0) * 10) / 10

export function AiScoringModal({
  open,
  onOpenChange,
  pageId,
  questions,
  studentIds,
  onScored,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  pageId: string
  questions: Question[]
  studentIds: string[]
  onScored: () => void
}) {
  const [rubrics, setRubrics] = useState<Record<string, Rubric>>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [scoring, setScoring] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [scoreErrors, setScoreErrors] = useState<{ componentId: string; studentId?: string; error: string }[]>([])

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/exams/${pageId}/scoring/rubric`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        const map: Record<string, Rubric> = {}
        for (const r of j.rubrics as Rubric[]) map[r.componentId] = r
        setRubrics(map)
        setDirty(new Set()) // freshly loaded = clean
      })
      .catch(() => setError('Could not load rubrics.'))
      .finally(() => setLoading(false))
  }, [pageId])

  useEffect(() => {
    if (open) {
      setError(null)
      setNotice(null)
      setScoreErrors([])
      setSelected(new Set(questions.filter(aiScorableByDefault).map((q) => q.componentId)))
      load()
    }
  }, [open, questions, load])

  const toggle = (componentId: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(componentId)) next.delete(componentId)
      else next.add(componentId)
      return next
    })

  const generateAll = async () => {
    setGenerating(true); setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/exams/${pageId}/scoring/rubric`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentIds: [...selected] }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const j = await res.json()
      if (Array.isArray(j.errors) && j.errors.length) {
        setError(`Some rubrics failed: ${j.errors.map((e: { error: string }) => e.error).join('; ')}`)
      }
      load()
    } catch {
      setError('Rubric generation failed.')
    } finally {
      setGenerating(false)
    }
  }

  // Replace a rubric's criteria (from the shared editor) and mark it dirty.
  const setCriteria = (componentId: string, criteria: Criterion[]) => {
    setRubrics((prev) => {
      const r = prev[componentId] ?? { componentId, criteria: [], maxPoints: null, source: 'teacher', model: null }
      return { ...prev, [componentId]: { ...r, criteria } }
    })
    setDirty((prev) => new Set(prev).add(componentId))
  }

  const saveRubric = async (componentId: string) => {
    const r = rubrics[componentId]
    if (!r) return
    setSavingId(componentId); setError(null)
    try {
      const res = await fetch(`/api/exams/${pageId}/scoring/rubric`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentId, criteria: r.criteria }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const j = await res.json()
      setRubrics((prev) => ({ ...prev, [componentId]: j.rubric }))
      setDirty((prev) => {
        const next = new Set(prev)
        next.delete(componentId)
        return next
      })
    } catch {
      setError('Could not save rubric.')
    } finally {
      setSavingId(null)
    }
  }

  const scoreAll = async () => {
    setScoring(true); setError(null); setNotice(null); setScoreErrors([])
    try {
      const res = await fetch(`/api/exams/${pageId}/scoring/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentIds: [...selected], studentIds }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const j = await res.json()
      const errs: typeof scoreErrors = Array.isArray(j.errors) ? j.errors : []
      setScoreErrors(errs)
      setNotice(`AI-scored ${j.scored} submission${j.scored === 1 ? '' : 's'}${errs.length ? ` · ${errs.length} error(s) — see below` : ''}.`)
      onScored()
    } catch {
      setError('AI scoring failed.')
    } finally {
      setScoring(false)
    }
  }

  // Group the failures by question + reason so the teacher sees what to fix /
  // re-score, instead of an opaque "N errors" count.
  const groupedErrors = (() => {
    const labelOf = (id: string) => questions.find((q) => q.componentId === id)?.label ?? id
    const map = new Map<string, { label: string; error: string; count: number }>()
    for (const e of scoreErrors) {
      const key = `${e.componentId}::${e.error}`
      const g = map.get(key) ?? { label: labelOf(e.componentId), error: e.error, count: 0 }
      g.count++
      map.set(key, g)
    }
    return [...map.values()]
  })()

  // A rubric is needed before scoring; count rubrics among the selected set.
  const selectedWithRubric = [...selected].filter((id) => rubrics[id]).length
  const busy = generating || scoring || loading

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="w-5 h-5" /> AI scoring
          </DialogTitle>
          <DialogDescription>
            Tick the exercises to score, generate a rubric per exercise, edit it, then
            AI-score the students. AI awards points + feedback only — your overrides always
            win. Choice/number questions are off by default (the check already scores them).
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={generateAll} disabled={busy || selected.size === 0}>
            {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
            Generate rubrics ({selected.size})
          </Button>
          <Button onClick={scoreAll} disabled={busy || selectedWithRubric === 0}>
            {scoring ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            AI-score selected ({selectedWithRubric})
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && <p className="text-sm text-green-600">{notice}</p>}
        {groupedErrors.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            <p className="mb-1 font-medium text-amber-700 dark:text-amber-400">Not scored — re-run to retry:</p>
            <ul className="!m-0 space-y-0.5 !p-0 !list-none">
              {groupedErrors.map((g, i) => (
                <li key={i} className="!m-0 flex gap-2 !p-0 marker:content-['']">
                  <span className="shrink-0 font-medium">{g.count}×</span>
                  <span className="min-w-0"><span className="text-muted-foreground">{g.label}:</span> {g.error}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{selected.size} / {questions.length} selected</span>
          <span aria-hidden>·</span>
          <button
            type="button"
            className="underline hover:text-foreground disabled:opacity-50"
            onClick={() => setSelected(new Set(questions.map((q) => q.componentId)))}
            disabled={busy}
          >
            Select all
          </button>
          <button
            type="button"
            className="underline hover:text-foreground disabled:opacity-50"
            onClick={() => setSelected(new Set())}
            disabled={busy}
          >
            Select none
          </button>
        </div>

        <div className="space-y-4">
          {questions.map((q) => {
            const r = rubrics[q.componentId]
            return (
              <div key={q.componentId} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0"
                    checked={selected.has(q.componentId)}
                    onChange={() => toggle(q.componentId)}
                    aria-label={`Include ${q.label ?? q.componentId}`}
                  />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{q.label ?? q.componentId}</p>
                    <p className="text-xs text-muted-foreground">
                      {q.questionType ?? q.kind} · max {q.maxPoints ?? '—'} pts
                      {r ? ` · rubric: ${r.source}${r.model ? ` (${r.model})` : ''} · Σ ${sum(r.criteria)}` : ' · no rubric'}
                    </p>
                  </div>
                </div>

                {r && (
                  <div className="mt-3 space-y-2">
                    <RubricCriteriaEditor criteria={r.criteria} onChange={(c) => setCriteria(q.componentId, c)} />
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => saveRubric(q.componentId)}
                        disabled={savingId === q.componentId || !dirty.has(q.componentId)}
                      >
                        {savingId === q.componentId ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                        {dirty.has(q.componentId) ? 'Save rubric' : 'Saved'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
