'use client'

/**
 * Teacher grading workspace for one exam page + class. Big table of students ×
 * questions: per-question scores are editable (override → auto greyed until
 * changed), totals + the Swiss grade recompute live as the teacher edits cells
 * or the grade key. Return one student or the whole class.
 *
 * Routed at /dashboard/exams/[pageId]/grading?classId=...
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { ArrowLeft, Send, Loader2, Play } from 'lucide-react'
import { runChecksForStudents } from '@/lib/grading/run-checks.client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import {
  gradeFromPoints,
  type GradeConfigParams,
  type GradeFormula,
} from '@/lib/grading/grade-formula'

interface Question {
  componentId: string
  kind: 'quiz' | 'python'
  questionType: string | null
  label: string | null
  maxPoints: number | null
}
interface ComponentCell {
  componentId: string
  earned: number
  max: number
  answered: boolean
  overridden: boolean
  autoEarned: number
}
interface StudentRow {
  studentId: string
  name: string | null
  email: string | null
  pseudonym: string | null
  className: string | null
  status: 'not_started' | 'submitted' | 'returned'
  submittedAt: string | null
  returnedAt: string | null
  totalEarned: number
  totalMax: number
  grade: number
  components: ComponentCell[]
}
interface ConfigState {
  formula: GradeFormula
  passPercent: number
  passGrade: number
  topGrade: number
  bottomGrade: number
  roundingStep: number
  maxPoints: number | null
}
interface GradingData {
  pageTitle: string
  classes: UnlockedClass[]
  selectedClassId: string
  config: ConfigState
  autoMaxPoints: number
  questions: Question[]
  students: StudentRow[]
}
interface UnlockedClass {
  id: string
  name: string
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

function paramsOf(c: ConfigState): GradeConfigParams {
  return {
    formula: c.formula,
    passPercent: c.passPercent,
    passGrade: c.passGrade,
    topGrade: c.topGrade,
    bottomGrade: c.bottomGrade,
    roundingStep: c.roundingStep,
  }
}

/** Recompute one student's totals + grade from current cell values + config. */
function recompute(student: StudentRow, config: ConfigState): StudentRow {
  const totalEarned = Math.round(student.components.reduce((s, c) => s + c.earned, 0) * 10) / 10
  const summedMax = student.components.reduce((s, c) => s + c.max, 0)
  const totalMax = config.maxPoints ?? Math.round(summedMax * 10) / 10
  const grade = gradeFromPoints(totalEarned, totalMax, paramsOf(config))
  return { ...student, totalEarned, totalMax, grade }
}

interface GradeStats {
  count: number
  average: number
  passRate: number
  dist: { band: number; count: number }[]
}
/** Average grade, pass rate, and a 1–6 distribution over students who handed in. */
function computeStats(students: StudentRow[], passGrade: number): GradeStats | null {
  const graded = students.filter((s) => s.status !== 'not_started')
  if (graded.length === 0) return null
  const average = graded.reduce((a, s) => a + s.grade, 0) / graded.length
  const passing = graded.filter((s) => s.grade >= passGrade).length
  const dist = [1, 2, 3, 4, 5, 6].map((band) => ({
    band,
    count: graded.filter((s) => Math.round(s.grade) === band).length,
  }))
  return {
    count: graded.length,
    average: Math.round(average * 100) / 100,
    passRate: Math.round((passing / graded.length) * 100),
    dist,
  }
}

export default function ExamGradingPage() {
  const params = useParams<{ pageId: string }>()
  const pageId = params.pageId
  const router = useRouter()
  const search = useSearchParams()
  const classId = search.get('classId')
  const { status } = useSession()
  const dialog = useAlertDialog()

  const [classes, setClasses] = useState<UnlockedClass[] | null>(null)
  const [data, setData] = useState<GradingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [returningAll, setReturningAll] = useState(false)
  const [runAll, setRunAll] = useState<{ done: number; total: number } | null>(null)

  // Load the classes that have this exam unlocked (for the class picker).
  useEffect(() => {
    if (status !== 'authenticated') return
    fetch(`/api/pages/${pageId}/unlock`)
      .then((r) => (r.ok ? r.json() : { unlocks: [] }))
      .then((j) => {
        const cls: UnlockedClass[] = (j.unlocks ?? [])
          .filter((u: { class?: UnlockedClass }) => u.class)
          .map((u: { class: UnlockedClass }) => u.class)
        // de-dup
        const seen = new Map(cls.map((c) => [c.id, c]))
        setClasses([...seen.values()])
      })
      .catch(() => setClasses([]))
  }, [pageId, status])

  // Auto-select the only unlocked class when none chosen.
  useEffect(() => {
    if (!classId && classes && classes.length === 1) {
      router.replace(`/dashboard/exams/${pageId}/grading?classId=${classes[0].id}`)
    }
  }, [classId, classes, pageId, router])

  const loadGrading = useCallback(() => {
    if (!classId) {
      setLoading(false)
      return
    }
    setLoading(true)
    fetch(`/api/exams/${pageId}/grading?classId=${classId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Failed to load')
        return r.json()
      })
      .then((j: GradingData) => {
        setData(j)
        setError(null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [pageId, classId])

  useEffect(() => {
    if (status !== 'authenticated') return
    loadGrading()
  }, [status, loadGrading])

  // --- config editing ---------------------------------------------------
  const updateConfig = (patch: Partial<ConfigState>) => {
    setData((d) => {
      if (!d) return d
      const config = { ...d.config, ...patch }
      return { ...d, config, students: d.students.map((s) => recompute(s, config)) }
    })
  }
  const saveConfig = () => {
    if (!data) return
    fetch(`/api/exams/${pageId}/grading/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data.config),
    }).catch(() => dialog.showError('Could not save the grade key.'))
  }

  const returnStudent = (studentId: string) => {
    fetch(`/api/exams/${pageId}/grading/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId }),
    })
      .then((r) => {
        if (!r.ok) throw new Error()
        loadGrading()
      })
      .catch(() => dialog.showError('Could not return the exam.'))
  }
  const returnAll = () => {
    if (!classId) return
    dialog.showConfirm(
      'Return the graded exam to every student who handed in? They will see their score, grade and feedback.',
      () => {
        setReturningAll(true)
        fetch(`/api/exams/${pageId}/grading/return`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true, classId }),
        })
          .then((r) => {
            if (!r.ok) throw new Error()
            loadGrading()
          })
          .catch(() => dialog.showError('Could not return the exams.'))
          .finally(() => setReturningAll(false))
      },
      { title: 'Return all exams', confirmText: 'Return all' },
    )
  }

  const submittedCount = useMemo(
    () => data?.students.filter((s) => s.status !== 'not_started').length ?? 0,
    [data],
  )

  // Re-run code checks for every submitted student on this device, then refresh.
  const runAllChecks = async () => {
    if (!data) return
    const ids = data.students.filter((s) => s.status !== 'not_started').map((s) => s.studentId)
    if (ids.length === 0) {
      dialog.showInfo('No handed-in exams to check yet.')
      return
    }
    setRunAll({ done: 0, total: ids.length })
    try {
      await runChecksForStudents(pageId, ids, (done, total) => setRunAll({ done, total }))
      loadGrading()
    } catch {
      dialog.showError('Could not run all checks.')
    } finally {
      setRunAll(null)
    }
  }

  if (status === 'loading' || loading) {
    return <div className="p-8 text-muted-foreground">Loading…</div>
  }

  // Class picker when no class chosen yet.
  if (!classId) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <Link href="/dashboard/classes" className="text-sm text-muted-foreground inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Classes
        </Link>
        <h1 className="text-2xl font-bold">Grade exam</h1>
        {classes && classes.length === 0 ? (
          <p className="text-muted-foreground">This exam isn’t unlocked for any of your classes yet.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-muted-foreground">Choose a class to grade:</p>
            {classes && classes.length > 1 && (
              <Button variant="outline" asChild className="w-full justify-start font-medium">
                <Link href={`/dashboard/exams/${pageId}/grading?classId=all`}>All classes ({classes.length})</Link>
              </Button>
            )}
            {classes?.map((c) => (
              <Button key={c.id} variant="outline" asChild className="w-full justify-start">
                <Link href={`/dashboard/exams/${pageId}/grading?classId=${c.id}`}>{c.name}</Link>
              </Button>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-destructive">{error}</p>
        <Button onClick={loadGrading}>Retry</Button>
      </div>
    )
  }
  if (!data) return null

  const c = data.config
  const allMode = data.selectedClassId === 'all'

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <Link
            href="/dashboard/classes"
            className="text-sm text-muted-foreground inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-4 h-4" /> Classes
          </Link>
          <h1 className="text-2xl font-bold">{data.pageTitle}</h1>
          <p className="text-sm text-muted-foreground">
            {submittedCount} handed in · max {data.config.maxPoints ?? data.autoMaxPoints} pts
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data.classes.length > 0 && (
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={data.selectedClassId}
              onChange={(e) => router.push(`/dashboard/exams/${pageId}/grading?classId=${e.target.value}`)}
            >
              {data.classes.length > 1 && <option value="all">All classes ({data.classes.length})</option>}
              {data.classes.map((cl) => (
                <option key={cl.id} value={cl.id}>{cl.name}</option>
              ))}
            </select>
          )}
          <Button variant="outline" onClick={runAllChecks} disabled={!!runAll || submittedCount === 0} title="Re-run every submitted student's code checks on this device">
            {runAll ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Checks {runAll.done}/{runAll.total}</>
            ) : (
              <><Play className="w-4 h-4 mr-2" />Run all checks</>
            )}
          </Button>
          <Button onClick={returnAll} disabled={returningAll || submittedCount === 0}>
            {returningAll ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            Return all
          </Button>
        </div>
      </div>

      {/* Class summary: average + grade distribution */}
      {(() => {
        const stats = computeStats(data.students, c.passGrade)
        if (!stats) return null
        const peak = Math.max(...stats.dist.map((d) => d.count), 1)
        return (
          <div className="rounded-lg border p-4 bg-card flex flex-wrap items-end gap-8">
            <div>
              <div className="text-xs text-muted-foreground">Class average</div>
              <div className="text-3xl font-bold tabular-nums">{stats.average.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Pass rate (≥ {fmt(c.passGrade)})</div>
              <div className="text-3xl font-bold tabular-nums">{stats.passRate}%</div>
            </div>
            <div className="flex-1 min-w-[240px]">
              <div className="text-xs text-muted-foreground mb-1">Distribution (n={stats.count})</div>
              <div className="flex items-end gap-1.5 h-16">
                {stats.dist.map((d) => (
                  <div key={d.band} className="flex-1 flex flex-col items-center justify-end" title={`Grade ${d.band}: ${d.count}`}>
                    {d.count > 0 && <span className="text-[10px] tabular-nums text-muted-foreground">{d.count}</span>}
                    <div
                      className={`w-full rounded-t ${d.band >= c.passGrade ? 'bg-green-500/70' : 'bg-amber-500/70'}`}
                      style={{ height: `${(d.count / peak) * 100}%`, minHeight: d.count > 0 ? 4 : 0 }}
                    />
                    <div className="text-[10px] text-muted-foreground mt-0.5">{d.band}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Grade key editor */}
      <div className="rounded-lg border p-4 flex flex-wrap items-end gap-4 bg-card">
        <div className="space-y-1">
          <Label className="text-xs">Formula</Label>
          <select
            className="block h-9 rounded-md border bg-background px-2 text-sm"
            value={c.formula}
            onChange={(e) => updateConfig({ formula: e.target.value as GradeFormula })}
            onBlur={saveConfig}
          >
            <option value="twoSegment">Two-segment</option>
            <option value="linear">Linear</option>
          </select>
        </div>
        <NumField label="Max points" value={c.maxPoints ?? ''} placeholder={String(data.autoMaxPoints)}
          onChange={(v) => updateConfig({ maxPoints: v === '' ? null : Number(v) })} onCommit={saveConfig} />
        {c.formula === 'twoSegment' && (
          <NumField label="Pass %" value={c.passPercent}
            onChange={(v) => updateConfig({ passPercent: Number(v) })} onCommit={saveConfig} />
        )}
        <div className="space-y-1">
          <Label className="text-xs">Rounding</Label>
          <select
            className="block h-9 rounded-md border bg-background px-2 text-sm"
            value={c.roundingStep}
            onChange={(e) => updateConfig({ roundingStep: Number(e.target.value) })}
            onBlur={saveConfig}
          >
            <option value={0.1}>0.1</option>
            <option value={0.25}>0.25</option>
            <option value={0.5}>0.5</option>
          </select>
        </div>
      </div>

      {/* Grading table — overview only: identity, total, grade, status, return.
          Per-question scores are auto-computed (override API exists for a future
          per-student detail view) but omitted here: too many exercises to be
          meaningful per row. */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="px-3 py-2 font-medium">Student</th>
              {allMode && <th className="px-3 py-2 font-medium">Class</th>}
              <th className="px-3 py-2 font-medium text-right">Total</th>
              <th className="px-3 py-2 font-medium text-right">Grade</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.students.map((s) => (
              <tr key={s.studentId} className="border-t hover:bg-accent/30">
                <td className="px-3 py-2">
                  <span className="font-medium">{s.email || s.name || s.pseudonym || '—'}</span>
                  {s.email && (s.name || s.pseudonym) && (
                    <span className="block text-xs text-muted-foreground">{s.name || s.pseudonym}</span>
                  )}
                </td>
                {allMode && <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{s.className ?? '—'}</td>}
                <td className="px-3 py-2 text-right tabular-nums">
                  {s.status === 'not_started' ? '—' : `${fmt(s.totalEarned)}/${fmt(s.totalMax)}`}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {s.status === 'not_started' ? '—' : fmt(s.grade)}
                </td>
                <td className="px-3 py-2">
                  <StatusChip status={s.status} />
                </td>
                <td className="px-3 py-2 text-right">
                  {s.status !== 'not_started' && (
                    <Button size="sm" variant="outline" onClick={() => returnStudent(s.studentId)}>
                      {s.status === 'returned' ? 'Re-return' : 'Return'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialogModal
        open={dialog.open}
        onOpenChange={dialog.setOpen}
        type={dialog.type}
        title={dialog.title}
        message={dialog.message}
        onConfirm={dialog.onConfirm}
        showCancel={dialog.showCancel}
        confirmText={dialog.confirmText}
        cancelText={dialog.cancelText}
        destructive={dialog.destructive}
      />
    </div>
  )
}

function NumField({
  label, value, placeholder, onChange, onCommit,
}: {
  label: string
  value: number | string
  placeholder?: string
  onChange: (v: string) => void
  onCommit: () => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        className="h-9 w-24"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
      />
    </div>
  )
}

function StatusChip({ status }: { status: StudentRow['status'] }) {
  const map = {
    not_started: { label: 'Not started', cls: 'bg-muted text-muted-foreground' },
    submitted: { label: 'Handed in', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
    returned: { label: 'Returned', cls: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  }[status]
  return <span className={`inline-block rounded px-2 py-0.5 text-xs ${map.cls}`}>{map.label}</span>
}

