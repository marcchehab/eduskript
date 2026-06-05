'use client'

/**
 * Teacher grade-mode scoring panel for ONE python-check coding exercise.
 *
 * Two tabs reflecting source precedence: Unit tests (check) and Score. The Score
 * tab is rubric-driven and unifies AI + manual. Each rubric criterion is ONE row:
 *   [ student comment ] [ student pts ] / [ max ] [ criterion description ] [bin]
 * i.e. the LEFT side is THIS student's scoring (AI-filled, manually overridable
 * per criterion with a reset), the RIGHT side is the rubric (all students). A
 * "Re-score" action sits in the student-side header, "Regenerate" in the rubric-
 * side header. A general feedback field spans the full width below. With no
 * rubric the tab falls back to a single absolute manual score.
 *
 * Shows points (Punkte), never a grade. Editor-owned data (live test results,
 * snapshots) comes in via props; score sources + edit actions from the exam-
 * review context. Python only — quizzes keep the simpler ScoreBadge.
 */

import { useEffect, useRef, useState } from 'react'
import { Check, X, Clock, RotateCcw, Trash2, Wand2, Loader2, AlertTriangle, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useComponentReview, type ComponentScoreSource } from '@/contexts/exam-review-context'

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
interface RubricCriterion {
  id: string
  description: string
  points: number
}
interface AiCriterion {
  id: string
  points: number
  comment?: string
}
interface OverrideCriterion {
  id: string
  points?: number
  comment?: string
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const pt = (n: number | null | undefined) => (n == null ? '–' : `${fmt(n)}P`)

// Side tints: the LEFT side scores THIS student (plain background); the RIGHT side
// is the rubric shared by ALL students (blue) — the tint flags the shared scope.
const STUDENT_BG = '' // plain (inherits the card) — only the rubric side is tinted
const RUBRIC_BG = 'bg-sky-50 dark:bg-sky-950/30'

type Tab = 'tests' | 'score'

/**
 * One criterion row: LEFT = this student (comment + points, editable, AI-filled,
 * resettable); RIGHT = the rubric (max + description + remove, all students).
 * Student fields use a focus-gated draft so async reloads don't fight typing,
 * with no ref reads during render (react-hooks/refs) and no setState-in-effect.
 */
function CriterionRow({
  rc,
  aiC,
  ovC,
  onRubricChange,
  onRubricRemove,
  onSet,
  onReset,
}: {
  rc: RubricCriterion
  aiC?: AiCriterion
  ovC?: OverrideCriterion
  onRubricChange: (patch: Partial<RubricCriterion>) => void
  onRubricRemove: () => void
  onSet: (value: { points?: number | null; comment?: string | null }) => void
  onReset: () => void
}) {
  const max = Number(rc.points) || 0
  const effPoints = ovC?.points ?? aiC?.points ?? null
  const effComment = ovC?.comment ?? aiC?.comment ?? ''
  const overridden = !!(ovC && (ovC.points != null || ovC.comment != null))

  const [editingPts, setEditingPts] = useState(false)
  const [editingCmt, setEditingCmt] = useState(false)
  const [ptsDraft, setPtsDraft] = useState('')
  const [cmtDraft, setCmtDraft] = useState('')
  const pts = editingPts ? ptsDraft : effPoints == null ? '' : fmt(effPoints)
  const cmt = editingCmt ? cmtDraft : effComment

  const savePts = (raw: string) => {
    const norm = raw.trim()
    if (norm === (effPoints == null ? '' : fmt(effPoints))) return
    if (norm === '') onSet({ points: null })
    else { const v = Number(norm); if (Number.isFinite(v)) onSet({ points: v }) }
  }
  const saveCmt = (raw: string) => {
    if (raw === effComment) return
    onSet({ comment: raw.trim() === '' ? null : raw })
  }
  useEffect(() => {
    if (!editingPts) return
    const t = setTimeout(() => savePts(ptsDraft), 400)
    return () => clearTimeout(t)
  }, [ptsDraft, editingPts]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editingCmt) return
    const t = setTimeout(() => saveCmt(cmtDraft), 600)
    return () => clearTimeout(t)
  }, [cmtDraft, editingCmt]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex items-stretch">
      {/* LEFT — this student */}
      <div className={cn('flex flex-1 items-start gap-1.5 px-2 py-1.5', STUDENT_BG)}>
        <textarea
          value={cmt}
          onFocus={() => { setCmtDraft(effComment); setEditingCmt(true) }}
          onChange={(e) => setCmtDraft(e.target.value)}
          onBlur={() => { setEditingCmt(false); saveCmt(cmtDraft) }}
          placeholder="Comment for this student…"
          rows={2}
          className={cn('min-w-0 flex-1 resize-y rounded border bg-background px-2 py-1 text-sm', overridden && 'border-foreground/40')}
        />
        <input
          type="number"
          step="0.5"
          className={cn('mt-1 h-7 w-12 rounded border bg-background px-1 text-right text-sm tabular-nums', overridden && 'border-foreground/40')}
          value={pts}
          placeholder="–"
          title="Points this student gets"
          onFocus={() => { setPtsDraft(effPoints == null ? '' : fmt(effPoints)); setEditingPts(true) }}
          onChange={(e) => setPtsDraft(e.target.value)}
          onBlur={() => { setEditingPts(false); savePts(ptsDraft) }}
        />
        {overridden ? (
          <button type="button" title="Reset this criterion to the AI score" className="mt-2 text-muted-foreground hover:text-foreground" onClick={onReset}>
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span className="mt-2 w-3.5" />
        )}
      </div>

      {/* RIGHT — rubric (all students) */}
      <div className={cn('flex flex-1 items-start gap-1.5 px-2 py-1.5', RUBRIC_BG)}>
        <input
          type="number"
          step="0.5"
          className="mt-1 h-7 w-12 rounded border bg-background px-1 text-right text-sm tabular-nums"
          value={rc.points}
          title="Max points for this criterion (rubric, all students)"
          onChange={(e) => onRubricChange({ points: Number(e.target.value) })}
        />
        <textarea
          value={rc.description}
          onChange={(e) => onRubricChange({ description: e.target.value })}
          placeholder="Criterion…"
          rows={2}
          className="min-w-0 flex-1 resize-y rounded border bg-background px-2 py-1 text-sm"
        />
        <button type="button" className="mt-1.5 text-muted-foreground hover:text-destructive" title="Remove criterion (all students)" onClick={onRubricRemove}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

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
  const {
    active, mode, pageId, studentId, review,
    setOverride, setFeedback, setCriterion, resetCriterion, clearOverride, clearAiScore, refreshGrades,
  } = useComponentReview(componentId)
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
  const aiMeta = ai?.meta as { rubricUpdatedAt?: string; criteria?: AiCriterion[] } | null
  const aiStale = !!(
    ai &&
    rubric &&
    aiMeta?.rubricUpdatedAt &&
    new Date(rubric.updatedAt).getTime() > new Date(aiMeta.rubricUpdatedAt).getTime()
  )

  const hasCheck = !!check || (testResults != null && testResults.length > 0)
  const effective = review?.effectiveSource ?? null
  const effectiveTab: Tab = effective === 'check' ? 'tests' : 'score'

  const [tab, setTab] = useState<Tab>(effectiveTab)
  const [showVersions, setShowVersions] = useState(false)
  useEffect(() => { setTab(effectiveTab) }, [effective]) // eslint-disable-line react-hooks/exhaustive-deps

  // General feedback (full width): effective = override ?? AI; editable.
  const overrideFeedback = override?.feedback ?? null
  const effFeedback = overrideFeedback ?? ai?.feedback ?? ''
  const [editingFb, setEditingFb] = useState(false)
  const [fbDraft, setFbDraft] = useState('')
  const fb = editingFb ? fbDraft : effFeedback
  const saveFb = (raw: string) => { if (raw !== effFeedback) setFeedback(raw.trim() === '' ? null : raw) }
  useEffect(() => {
    if (!editingFb) return
    const t = setTimeout(() => saveFb(fbDraft), 600)
    return () => clearTimeout(t)
  }, [fbDraft, editingFb]) // eslint-disable-line react-hooks/exhaustive-deps

  // Absolute manual score — fallback for components with NO rubric.
  const overrideEarned = override?.earned ?? null
  const hasRubric = rubricDraft.length > 0 || !!rubric
  const [editingAbs, setEditingAbs] = useState(false)
  const [absDraft, setAbsDraft] = useState('')
  const abs = editingAbs ? absDraft : overrideEarned == null ? '' : fmt(overrideEarned)
  const saveAbs = (raw: string) => {
    const v = raw.trim() === '' ? null : Number(raw)
    if ((v === null || Number.isFinite(v)) && v !== overrideEarned) setOverride(v)
  }
  useEffect(() => {
    if (!editingAbs) return
    const t = setTimeout(() => saveAbs(absDraft), 400)
    return () => clearTimeout(t)
  }, [absDraft, editingAbs]) // eslint-disable-line react-hooks/exhaustive-deps

  // Grade mode only; quizzes/student review keep the ScoreBadge.
  if (!active || !review || mode !== 'grade') return null

  const max = review.max
  const aiById = new Map((aiMeta?.criteria ?? []).map((c) => [c.id, c]))
  const ovById = new Map((((override?.meta as { criteria?: OverrideCriterion[] } | null)?.criteria) ?? []).map((c) => [c.id, c]))
  const passedCount = testResults?.filter((r) => r.passed).length ?? 0
  const testTotal = testResults?.length ?? 0
  const rubricSum = Math.round(rubricDraft.reduce((s, c) => s + (Number(c.points) || 0), 0) * 10) / 10

  const updateRubric = (i: number, patch: Partial<RubricCriterion>) => {
    setRubricDraft((d) => d.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
    setRubricDirty(true)
  }
  const removeRubric = (i: number) => { setRubricDraft((d) => d.filter((_, idx) => idx !== i)); setRubricDirty(true) }
  const addRubric = () => {
    setRubricDraft((d) => {
      const nums = d.map((c) => Number(c.id.replace(/^c/, ''))).filter(Number.isFinite)
      const next = (nums.length ? Math.max(...nums) : 0) + 1
      return [...d, { id: `c${next}`, description: '', points: 0 }]
    })
    setRubricDirty(true)
  }

  const tabButton = (id: Tab, label: string, points: number | null, enabled: boolean) => {
    const activeTab = tab === id
    const isEffective = effectiveTab === id && (id !== 'score' || ai != null || override != null)
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
      {/* Tab bar: precedence; effective source highlighted. */}
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
        {tabButton('tests', 'Unit tests', hasCheck ? review.autoEarned : null, hasCheck)}
        {tabButton('score', 'Score', review.earned, true)}
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

        {tab === 'score' && (
          <div className="space-y-3">
            {aiStale && (
              <div className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                Rubric changed since this score was computed — re-score to update.
              </div>
            )}

            {hasRubric ? (
              <div className="overflow-hidden rounded-md border">
                {/* Title row (tinted): LEFT = this student + scoring actions,
                    RIGHT = rubric (all students) + regenerate. */}
                <div className="flex border-b text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <div className={cn('flex flex-1 items-center justify-between gap-2 px-2 py-1', STUDENT_BG)}>
                    <span>This student</span>
                    <span className="flex items-center gap-1">
                      {hasRubric && (
                        <button type="button" onClick={scoreThisStudent} disabled={scoreBusy} className="inline-flex items-center gap-1 rounded px-1 py-0.5 normal-case hover:bg-background/60 disabled:opacity-50" title="AI-score this student against the rubric">
                          {scoreBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                          {ai ? 'Re-score' : 'AI-score'}
                        </button>
                      )}
                      {ai && (
                        <button type="button" onClick={() => clearAiScore()} className="inline-flex items-center gap-1 rounded px-1 py-0.5 normal-case hover:bg-background/60 hover:text-destructive" title="Clear this AI score">
                          <Trash2 className="h-3.5 w-3.5" /> Clear AI
                        </button>
                      )}
                    </span>
                  </div>
                  <div className={cn('flex flex-1 items-center justify-between gap-2 px-2 py-1', RUBRIC_BG)}>
                    <span>Rubric for all students</span>
                    <button type="button" onClick={generateRubric} disabled={rubricBusy} className="inline-flex items-center gap-1 rounded px-1 py-0.5 normal-case hover:bg-background/60 disabled:opacity-50" title={rubric ? 'Regenerate the rubric from the AI' : 'Generate a rubric from the AI'}>
                      {rubricBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                      {rubric ? 'Regenerate' : 'Generate'}
                    </button>
                  </div>
                </div>
                {rubricDraft.map((rc, i) => (
                  <div key={rc.id} className={cn(i > 0 && 'border-t')}>
                    <CriterionRow
                      rc={rc}
                      aiC={aiById.get(rc.id)}
                      ovC={ovById.get(rc.id)}
                      onRubricChange={(patch) => updateRubric(i, patch)}
                      onRubricRemove={() => removeRubric(i)}
                      onSet={(value) => setCriterion(rc.id, value)}
                      onReset={() => resetCriterion(rc.id)}
                    />
                  </div>
                ))}
                {/* Footer totals, aligned beneath their respective points columns. */}
                <div className="flex border-t text-xs">
                  {/* student total, under the student points column (+ reset spacer) */}
                  <div className={cn('flex flex-1 items-center justify-end gap-1.5 px-2 py-1.5', STUDENT_BG)}>
                    <span className="font-semibold tabular-nums">Σ {fmt(review.earned)} pts</span>
                    <span className="w-3.5" />
                  </div>
                  {/* rubric total under the max column; Add + Save grouped at the right */}
                  <div className={cn('flex flex-1 items-center gap-1.5 px-2 py-1.5', RUBRIC_BG)}>
                    <span className="w-12 text-right font-semibold tabular-nums">Σ {fmt(rubricSum)}</span>
                    <span className="text-muted-foreground">pts</span>
                    <span className="ml-auto flex items-center gap-2">
                      <button type="button" onClick={addRubric} className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground hover:bg-background/60">
                        <Plus className="h-3.5 w-3.5" /> Add
                      </button>
                      <button
                        type="button"
                        onClick={saveRubric}
                        disabled={rubricBusy || !rubricDirty}
                        className="rounded border bg-background px-2 py-0.5 hover:bg-accent/50 disabled:opacity-50"
                      >
                        {rubricDirty ? 'Save' : 'Saved'}
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              /* No rubric yet → offer to generate/start one, plus a single
                 absolute manual score as a fallback. */
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>No rubric yet.</span>
                  <button
                    type="button"
                    onClick={generateRubric}
                    disabled={rubricBusy}
                    className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 hover:bg-accent/50 disabled:opacity-50"
                    title="Generate a rubric from the AI (samples the class)"
                  >
                    {rubricBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                    Generate rubric
                  </button>
                  <span>or</span>
                  <button
                    type="button"
                    onClick={() => { setRubricDraft([{ id: 'c1', description: '', points: 0 }]); setRubricDirty(true) }}
                    className="rounded border px-1.5 py-0.5 hover:bg-accent/50"
                  >
                    start one manually
                  </button>
                </div>
                <div className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm">
                  <span className="text-xs text-muted-foreground">Points</span>
                  <input
                    type="number"
                    step="0.1"
                    className="h-7 w-12 rounded border bg-background px-1 text-right tabular-nums"
                    value={abs}
                    onFocus={() => { setAbsDraft(overrideEarned == null ? '' : fmt(overrideEarned)); setEditingAbs(true) }}
                    onChange={(e) => setAbsDraft(e.target.value)}
                    onBlur={() => { setEditingAbs(false); saveAbs(absDraft) }}
                  />
                  <span className="tabular-nums text-muted-foreground">/ {fmt(max)}</span>
                  {override != null && (
                    <button type="button" title="Clear manual score" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => clearOverride()}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <span className="ml-2 text-xs text-muted-foreground">or score manually without a rubric.</span>
                </div>
                {aiErr && <p className="text-xs text-destructive">{aiErr}</p>}
              </div>
            )}

            {/* General feedback — full width; AI-filled, overridable. */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Feedback (shown to the student)</span>
                {overrideFeedback != null && (
                  <button type="button" onClick={() => setFeedback(null)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent/50" title="Reset feedback to the AI text">
                    <RotateCcw className="h-3.5 w-3.5" /> Reset
                  </button>
                )}
              </div>
              <textarea
                value={fb}
                onFocus={() => { setFbDraft(effFeedback); setEditingFb(true) }}
                onChange={(e) => setFbDraft(e.target.value)}
                onBlur={() => { setEditingFb(false); saveFb(fbDraft) }}
                placeholder="General feedback for this answer…"
                rows={2}
                className="w-full resize-y rounded border bg-background px-2 py-1 text-sm"
              />
            </div>

            {aiErr && <p className="text-xs text-destructive">{aiErr}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
