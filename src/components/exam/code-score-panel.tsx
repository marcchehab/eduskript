'use client'

/**
 * Teacher grade-mode scoring panel for ONE python-check coding exercise.
 *
 * Reflects the score-source precedence as tabs — Unit tests (check) is beaten by
 * AI score is beaten by Manual (override). The effective source (highest present)
 * is auto-selected; sources with no score are greyed. A clock toggles the
 * student's version history (snapshots). Shows points (Punkte), never a grade.
 *
 * Editor-owned data (live test results, snapshots) comes in via props; the score
 * sources + edit actions come from the exam-review context. Python only — quizzes
 * keep the simpler ScoreBadge.
 */

import { useEffect, useRef, useState } from 'react'
import { Check, X, Clock, RotateCcw, Trash2, Wand2, Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useComponentReview, type ComponentScoreSource } from '@/contexts/exam-review-context'
import { RubricCriteriaEditor, type RubricCriterion } from '@/components/exam/rubric-criteria-editor'

export interface CodeSnapshot {
  id: number
  kind: string
  label: string | null
  createdAt: string
  payload: unknown
}
interface TestResult {
  index: number
  passed: boolean
  label: string
  error?: string
}
interface AiCriterion {
  id: string
  points: number
  comment?: string
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const pt = (n: number | null | undefined) => (n == null ? '–' : `${fmt(n)}P`)

type Tab = 'tests' | 'ai' | 'manual'

export function CodeScorePanel({
  componentId,
  testResults,
  checkPoints,
  snapshots,
  snapshotsLoading,
  viewedSnapshotId,
  editedSinceSnapshot,
  onViewSnapshot,
  onRevertSnapshot,
}: {
  componentId: string
  testResults: TestResult[] | null
  checkPoints: number
  snapshots: CodeSnapshot[]
  snapshotsLoading: boolean
  viewedSnapshotId: number | null
  editedSinceSnapshot: boolean
  onViewSnapshot: (s: CodeSnapshot) => void
  onRevertSnapshot: () => void
}) {
  const { active, mode, pageId, studentId, review, setOverride, setFeedback, clearOverride, clearAiScore, refreshGrades } =
    useComponentReview(componentId)
  const [rubricBusy, setRubricBusy] = useState(false)
  const [scoreBusy, setScoreBusy] = useState(false)
  const [aiErr, setAiErr] = useState<string | null>(null)
  const [rubricDraft, setRubricDraft] = useState<RubricCriterion[]>([])
  const [rubricDirty, setRubricDirty] = useState(false)

  const rubric = review?.rubric ?? null
  const rubricUpdatedAt = rubric?.updatedAt

  // (Re)generate the rubric for THIS exercise from the AI (samples the class).
  const generateRubric = async () => {
    setRubricBusy(true)
    setAiErr(null)
    try {
      const r = await fetch(`/api/exams/${pageId}/scoring/rubric`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentIds: [componentId] }),
      }).then((res) => res.json())
      if (r.errors?.length && !r.rubrics?.length) throw new Error(r.errors[0].error)
      setRubricDirty(false)
      refreshGrades()
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : 'Rubric generation failed')
    } finally {
      setRubricBusy(false)
    }
  }

  // Save the (edited) rubric for this exercise — applies to all students.
  const saveRubric = async () => {
    setRubricBusy(true)
    setAiErr(null)
    try {
      const res = await fetch(`/api/exams/${pageId}/scoring/rubric`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentId, criteria: rubricDraft }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setRubricDirty(false)
      refreshGrades()
    } catch {
      setAiErr('Could not save rubric.')
    } finally {
      setRubricBusy(false)
    }
  }

  // AI-score the CURRENT student against the saved rubric.
  const scoreThisStudent = async () => {
    if (!studentId) return
    setScoreBusy(true)
    setAiErr(null)
    try {
      const res = await fetch(`/api/exams/${pageId}/scoring/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentIds: [componentId], studentIds: [studentId] }),
      }).then((r) => r.json())
      if (res.scored === 0 && res.errors?.length) throw new Error(res.errors[0].error)
      refreshGrades()
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : 'AI scoring failed')
    } finally {
      setScoreBusy(false)
    }
  }

  const source = (s: string): ComponentScoreSource | undefined => review?.sources?.find((x) => x.source === s)
  const check = source('check')
  const ai = source('ai')
  const override = source('override')

  // Sync the editable rubric draft from the loaded rubric (unless mid-edit).
  useEffect(() => {
    if (!rubricDirty) setRubricDraft(rubric?.criteria ?? [])
  }, [rubricUpdatedAt, componentId]) // eslint-disable-line react-hooks/exhaustive-deps

  // An AI score is stale if the rubric was saved after the score was computed.
  const aiMeta = ai?.meta as { rubricUpdatedAt?: string } | null
  const aiStale = !!(
    ai &&
    rubric &&
    aiMeta?.rubricUpdatedAt &&
    new Date(rubric.updatedAt).getTime() > new Date(aiMeta.rubricUpdatedAt).getTime()
  )

  const hasCheck = !!check || (testResults != null && testResults.length > 0)
  const hasAi = !!ai
  const effective = review?.effectiveSource ?? null
  const effectiveTab: Tab = effective === 'override' ? 'manual' : effective === 'ai' ? 'ai' : 'tests'

  const [tab, setTab] = useState<Tab>(effectiveTab)
  const [showVersions, setShowVersions] = useState(false)
  // Re-select the effective tab whenever precedence changes (e.g. after AI
  // scoring or an override), so the active source is always front-and-centre.
  useEffect(() => {
    setTab(effectiveTab)
  }, [effective]) // eslint-disable-line react-hooks/exhaustive-deps

  // Manual (override) editing — debounced, mirrors the old ScoreBadge.
  const [draft, setDraft] = useState('')
  const [fb, setFb] = useState('')
  const ptsFocused = useRef(false)
  const fbFocused = useRef(false)
  const overrideEarned = override?.earned ?? null
  const overrideFeedback = override?.feedback ?? null
  useEffect(() => {
    if (!ptsFocused.current) setDraft(overrideEarned == null ? '' : fmt(overrideEarned))
  }, [overrideEarned, componentId])
  useEffect(() => {
    if (!fbFocused.current) setFb(overrideFeedback ?? '')
  }, [overrideFeedback, componentId])
  useEffect(() => {
    if (draft === '') return
    const v = Number(draft)
    if (!Number.isFinite(v) || v === overrideEarned) return
    const t = setTimeout(() => setOverride(v), 400)
    return () => clearTimeout(t)
  }, [draft]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (fb === (overrideFeedback ?? '')) return
    const t = setTimeout(() => setFeedback(fb.trim() === '' ? null : fb), 600)
    return () => clearTimeout(t)
  }, [fb]) // eslint-disable-line react-hooks/exhaustive-deps

  // Grade mode only; quizzes/student review keep the ScoreBadge.
  if (!active || !review || mode !== 'grade') return null

  const max = review.max
  const aiCriteria = (ai?.meta as { criteria?: AiCriterion[] } | null)?.criteria ?? []
  const passedCount = testResults?.filter((r) => r.passed).length ?? 0
  const testTotal = testResults?.length ?? 0

  // A render helper (NOT a nested component, which would remount each render).
  const tabButton = (id: Tab, label: string, points: number | null, enabled: boolean) => {
    const activeTab = tab === id
    const isEffective = effectiveTab === id && (id !== 'manual' || override != null)
    return (
      <button
        type="button"
        disabled={!enabled}
        onClick={() => enabled && setTab(id)}
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors',
          activeTab ? 'border-foreground/30 bg-accent font-medium' : 'border-transparent hover:bg-accent/50',
          !enabled && 'opacity-40 cursor-not-allowed',
          isEffective && !activeTab && 'border-green-500/40',
        )}
        title={isEffective ? `${label} — counts towards the score` : label}
      >
        <span>{label}</span>
        <span className={cn('tabular-nums', isEffective ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground')}>
          {pt(points)}
        </span>
      </button>
    )
  }

  return (
    <div className="mt-2 rounded-lg border bg-card">
      {/* Tab bar: precedence left→right; effective source highlighted. */}
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
        {tabButton('tests', 'Unit tests', hasCheck ? review.autoEarned : null, hasCheck)}
        {/* AI tab stays clickable even with no score, so the teacher can generate one. */}
        {tabButton('ai', 'AI score', ai?.earned ?? null, true)}
        {tabButton('manual', 'Manual', overrideEarned, true)}
        <button
          type="button"
          onClick={() => setShowVersions((v) => !v)}
          className={cn('ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-accent/50', showVersions && 'bg-accent text-foreground')}
          title="Version history (snapshots)"
        >
          <Clock className="h-4 w-4" />
        </button>
      </div>

      {/* Version history (snapshots) — toggled by the clock. */}
      {showVersions && (
        <div className="border-b px-3 py-2 text-[11px]">
          <div className="mb-1 flex items-center justify-between text-muted-foreground">
            <span className="font-medium uppercase tracking-wide text-[10px]">
              Snapshots
              {editedSinceSnapshot && (
                <span className="ml-1 normal-case tracking-normal text-amber-600 dark:text-amber-400">· edited (not saved)</span>
              )}
            </span>
            {editedSinceSnapshot && (
              <button type="button" onClick={onRevertSnapshot} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent/50">
                <RotateCcw className="h-3 w-3" /> Revert
              </button>
            )}
          </div>
          {snapshots.length === 0 ? (
            <div className="text-muted-foreground">{snapshotsLoading ? 'Loading…' : 'No saved snapshots for this student.'}</div>
          ) : (
            <ul className="!m-0 max-h-[6rem] !list-none overflow-y-auto !p-0">
              {snapshots.map((s) => {
                const isActive = (viewedSnapshotId ?? snapshots[0].id) === s.id
                return (
                  <li key={s.id} className="!m-0 !list-none !p-0 marker:content-['']">
                    <button
                      type="button"
                      onClick={() => onViewSnapshot(s)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-1 py-0.5 text-left leading-tight hover:bg-accent/50',
                        isActive && 'bg-amber-50 font-medium dark:bg-amber-950/30',
                      )}
                    >
                      <span className="w-14 flex-shrink-0 whitespace-nowrap text-[9px] uppercase tracking-wide text-muted-foreground">{s.kind}</span>
                      <span className="flex-1 truncate">{s.label ?? ''}</span>
                      <span className="flex-shrink-0 tabular-nums text-[10px] text-muted-foreground">{new Date(s.createdAt).toLocaleTimeString()}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* Active tab body */}
      <div className="px-3 py-2.5">
        {tab === 'tests' &&
          (hasCheck ? (
            <div className="space-y-1.5">
              <div className="text-sm text-muted-foreground">
                {testTotal > 0 ? `${passedCount}/${testTotal} tests passed · ` : ''}
                <span className="tabular-nums">{fmt(review.autoEarned)} / {fmt(checkPoints)}</span> pts
              </div>
              {testResults && testResults.length > 0 ? (
                <ul className="!m-0 space-y-1 !p-0 !list-none">
                  {testResults.map((r) => (
                    <li key={r.index} className="!m-0 flex items-start gap-1.5 !p-0 text-sm marker:content-['']">
                      {r.passed ? <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" /> : <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />}
                      <span className="min-w-0">
                        <span className="break-words">{r.label}</span>
                        {!r.passed && r.error && <span className="block font-mono text-xs text-muted-foreground">{r.error}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Run the check (above) to see the per-test breakdown.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No check has been run for this student yet.</p>
          ))}

        {tab === 'ai' && (
          <div className="space-y-3">
            {/* Rubric — per exercise, applies to ALL students. Editable here so
                you can adapt it when a student does something unanticipated. */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Rubric · this exercise, all students
                  {rubric && <span className="ml-1 normal-case tracking-normal">({rubric.source}{rubric.model ? `, ${rubric.model}` : ''})</span>}
                </span>
                <button
                  type="button"
                  onClick={generateRubric}
                  disabled={rubricBusy}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-accent/50 disabled:opacity-50"
                  title={rubric ? 'Regenerate the rubric from the AI' : 'Generate a rubric from the AI'}
                >
                  {rubricBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  {rubric ? 'Regenerate' : 'Generate rubric'}
                </button>
              </div>
              {rubricDraft.length > 0 || rubric ? (
                <>
                  <RubricCriteriaEditor
                    criteria={rubricDraft}
                    onChange={(c) => { setRubricDraft(c); setRubricDirty(true) }}
                  />
                  <button
                    type="button"
                    onClick={saveRubric}
                    disabled={rubricBusy || !rubricDirty}
                    className="rounded-md border px-2 py-1 text-xs hover:bg-accent/50 disabled:opacity-50"
                  >
                    {rubricDirty ? 'Save rubric' : 'Saved'}
                  </button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No rubric yet. Generate one, or{' '}
                  <button type="button" className="underline" onClick={() => { setRubricDraft([{ id: 'c1', description: '', points: 0 }]); setRubricDirty(true) }}>
                    start one manually
                  </button>.
                </p>
              )}
            </div>

            <div className="border-t pt-3">
              {ai ? (
                <div className="space-y-2">
                  {aiStale && (
                    <div className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                      Rubric changed since this score was computed — re-score to update.
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm tabular-nums">
                      <span className="font-medium">{fmt(ai.earned ?? 0)}</span> / {fmt(max)} pts
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={scoreThisStudent}
                        disabled={scoreBusy}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-accent/50 disabled:opacity-50"
                        title="Re-score this student against the current rubric"
                      >
                        {scoreBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Re-score
                      </button>
                      <button
                        type="button"
                        onClick={() => clearAiScore()}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-destructive"
                        title="Clear this AI score (reverts to the unit-test score)"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Clear
                      </button>
                    </div>
                  </div>
                  {ai.feedback && <p className="whitespace-pre-wrap rounded border bg-muted/40 px-2 py-1.5 text-sm">{ai.feedback}</p>}
                  {aiCriteria.length > 0 && (
                    <ul className="!m-0 space-y-0.5 !p-0 !list-none text-xs text-muted-foreground">
                      {aiCriteria.map((c) => (
                        <li key={c.id} className="!m-0 flex gap-1.5 !p-0 marker:content-['']">
                          <span className="tabular-nums">+{fmt(c.points)}</span>
                          {c.comment && <span className="min-w-0">{c.comment}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={scoreThisStudent}
                  disabled={scoreBusy || !rubric}
                  className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm hover:bg-accent/50 disabled:opacity-50"
                  title={rubric ? 'AI-score this student against the rubric' : 'Generate or save a rubric first'}
                >
                  {scoreBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  AI-score this student
                </button>
              )}
            </div>
            {aiErr && <p className="text-xs text-destructive">{aiErr}</p>}
          </div>
        )}

        {tab === 'manual' && (
          <div className="flex items-start gap-2">
            <div className="flex w-40 shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-sm">
              <span className="text-xs text-muted-foreground">Points</span>
              <input
                type="number"
                step="0.1"
                className="h-7 w-12 rounded border bg-background px-1 text-right tabular-nums"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={() => { ptsFocused.current = true }}
                onBlur={() => {
                  ptsFocused.current = false
                  const v = draft === '' ? null : Number(draft)
                  if (v === null || Number.isFinite(v)) if (v !== overrideEarned) setOverride(v)
                }}
              />
              <span className="tabular-nums text-muted-foreground">/ {fmt(max)}</span>
              {override != null && (
                <button
                  type="button"
                  title="Clear manual score"
                  className="ml-auto text-muted-foreground hover:text-destructive"
                  onClick={() => clearOverride()}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <textarea
              value={fb}
              onChange={(e) => setFb(e.target.value)}
              onFocus={() => { fbFocused.current = true }}
              onBlur={() => { fbFocused.current = false }}
              placeholder="Feedback for this question (shown to the student)…"
              rows={2}
              className="min-w-0 flex-1 resize-y rounded border bg-background px-2 py-1 text-sm"
            />
          </div>
        )}
      </div>
    </div>
  )
}
