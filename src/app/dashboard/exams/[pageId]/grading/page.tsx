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
import { ArrowLeft, Send, Loader2, Play, Wand2, ArrowDownAZ, ArrowUpAZ } from 'lucide-react'
import { runChecksForStudents } from '@/lib/scoring/run-checks.client'
import { AiScoringModal } from '@/components/dashboard/ai-scoring-modal'
import { getReverseMappingsForClass } from '@/lib/email-mapping-db'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import {
  gradeFromPoints,
  type GradeConfigParams,
  type GradeFormula,
} from '@/lib/scoring/grade-formula'

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
  source: string | null
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
  examUrl: string | null
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
/** Half-grade bands from 1 to 6 (1, 1.5, 2, …, 6). */
const GRADE_BANDS = Array.from({ length: 11 }, (_, i) => 1 + i * 0.5)

/** Bar colour for a grade: red at ≤2, yellow at 4, green at ≥6 (hue 0→60→120). */
function gradeColor(grade: number): string {
  const hue = Math.max(0, Math.min(120, ((grade - 2) / 4) * 120))
  return `hsl(${hue} 75% 50%)`
}

/** Average grade, pass rate, and a half-grade distribution over students who handed in.
 *  Band b holds grades in [b-0.25, b+0.25) — e.g. 4.5 covers 4.25–4.74999. */
function computeStats(students: StudentRow[], passGrade: number): GradeStats | null {
  const graded = students.filter((s) => s.status !== 'not_started')
  if (graded.length === 0) return null
  const average = graded.reduce((a, s) => a + s.grade, 0) / graded.length
  const passing = graded.filter((s) => s.grade >= passGrade).length
  const dist = GRADE_BANDS.map((band) => ({
    band,
    count: graded.filter((s) => Math.round(s.grade * 2) / 2 === band).length,
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
  const [aiOpen, setAiOpen] = useState(false)
  const [tab, setTab] = useState<'class' | 'exam'>('class')
  // Teacher's local pseudonym → real-email mapping (IndexedDB), so the roster
  // shows people the teacher can identify — same source the StudentNavigator /
  // ClassToolbar use. The mapping takes precedence over the stored name/pseudonym.
  const [resolvedEmails, setResolvedEmails] = useState<Record<string, string>>({})

  // Load the classes for the picker: those with the exam unlocked OR holding a
  // submitted answer (so a class whose unlock was revoked but still has work to
  // grade stays selectable). Same source as the grading targets — see
  // getExamClassesForTeacher.
  useEffect(() => {
    if (status !== 'authenticated') return
    fetch(`/api/exams/${pageId}/grading?classesOnly=1`)
      .then((r) => (r.ok ? r.json() : { classes: [] }))
      .then((j) => {
        const cls: UnlockedClass[] = j.classes ?? []
        // de-dup
        const seen = new Map(cls.map((c: UnlockedClass) => [c.id, c]))
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

  // Load the teacher's pseudonym→email mappings. For a single class, just that
  // class; for "all", merge every unlocked class's map (pseudonyms are
  // deterministic, so a merged lookup is safe).
  useEffect(() => {
    if (!classId) { setResolvedEmails({}); return }
    const ids = classId === 'all' ? (classes ?? []).map((c) => c.id) : [classId]
    if (ids.length === 0) { setResolvedEmails({}); return }
    let cancelled = false
    Promise.all(ids.map((id) => getReverseMappingsForClass(id).catch(() => ({}))))
      .then((maps) => {
        if (cancelled) return
        setResolvedEmails(Object.assign({}, ...maps))
      })
    return () => { cancelled = true }
  }, [classId, classes])

  // Display name with the teacher's mapping first, then any revealed email,
  // then the generated name / pseudonym.
  const displayName = useCallback(
    (s: StudentRow): string =>
      (s.pseudonym ? resolvedEmails[s.pseudonym] : undefined) || s.email || s.name || s.pseudonym || '—',
    [resolvedEmails],
  )

  // The student's real email if the teacher has one mapped/revealed, else null.
  const mappedEmail = useCallback(
    (s: StudentRow): string | null =>
      (s.pseudonym ? resolvedEmails[s.pseudonym] : undefined) || s.email || null,
    [resolvedEmails],
  )
  const nicknameOf = (s: StudentRow): string => s.name || s.pseudonym || '—'

  // --- roster sorting ---------------------------------------------------
  // 'alpha': mapped emails A–Z, then the email-less by nickname A–Z.
  // 'surname': by lastname parsed from firstname.lastname@… emails, the rest after.
  const [sortKey, setSortKey] = useState<'alpha' | 'surname'>('alpha')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const toggleSort = (key: 'alpha' | 'surname') => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }
  const sortedStudents = useMemo(() => {
    // Lastname from a firstname[.middle].lastname local part; null if no dot.
    const surnameOf = (email: string | null): string | null => {
      if (!email) return null
      const local = email.split('@')[0]
      const parts = local.split('.')
      return parts.length < 2 ? null : parts[parts.length - 1]
    }
    if (!data) return []
    const arr = [...data.students]
    // Build the ascending order, then reverse wholesale for 'desc' so the
    // group ordering (keyed vs un-keyed) flips too.
    arr.sort((a, b) => {
      if (sortKey === 'alpha') {
        const ea = mappedEmail(a), eb = mappedEmail(b)
        if (ea && eb) return ea.localeCompare(eb)
        if (ea) return -1
        if (eb) return 1
        return nicknameOf(a).localeCompare(nicknameOf(b))
      }
      const sa = surnameOf(mappedEmail(a)), sb = surnameOf(mappedEmail(b))
      if (sa && sb) return sa.localeCompare(sb) || mappedEmail(a)!.localeCompare(mappedEmail(b)!)
      if (sa) return -1
      if (sb) return 1
      return nicknameOf(a).localeCompare(nicknameOf(b))
    })
    if (sortDir === 'desc') arr.reverse()
    return arr
  }, [data, sortKey, sortDir, mappedEmail])

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

  // Flip the given students to "returned" in place. The frozen snapshot equals
  // the current live grade at return time, so totals/grade are unchanged — only
  // the status + returnedAt. Updating state directly avoids loadGrading(), which
  // sets loading=true and blanks the whole table to "Loading…" on every return.
  const markReturned = (ids: Set<string>, at: string) =>
    setData((d) =>
      d
        ? { ...d, students: d.students.map((s) => (ids.has(s.studentId) ? { ...s, status: 'returned', returnedAt: at } : s)) }
        : d,
    )

  const returnStudent = (studentId: string) => {
    fetch(`/api/exams/${pageId}/grading/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId }),
    })
      .then((r) => {
        if (!r.ok) throw new Error()
        markReturned(new Set([studentId]), new Date().toISOString())
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
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
          .then((j: { students?: string[] }) => markReturned(new Set(j.students ?? []), new Date().toISOString()))
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
          <Button variant="outline" onClick={() => setAiOpen(true)} disabled={submittedCount === 0} title="Generate scoring rubrics and AI-score all students">
            <Wand2 className="w-4 h-4 mr-2" />AI scoring
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
            <div>
              <div className="text-xs text-muted-foreground mb-1">Distribution (n={stats.count})</div>
              <div className="flex items-end gap-1">
                {stats.dist.map((d) => (
                  <div key={d.band} className="w-10 flex flex-col items-center" title={`Grade ${fmt(d.band)}: ${d.count}`}>
                    {d.count > 0 && <span className="text-[10px] tabular-nums text-muted-foreground leading-none mb-0.5">{d.count}</span>}
                    <div className="w-full h-16 flex items-end">
                      <div
                        className="w-full rounded-t"
                        style={{ height: `${(d.count / peak) * 100}%`, minHeight: d.count > 0 ? 4 : 0, backgroundColor: gradeColor(d.band) }}
                      />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{fmt(d.band)}</div>
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

      {/* Tabs: the student roster (Class overview) vs a per-exercise breakdown
          (Exam overview) — the latter helps gauge difficulty + set max points. */}
      <div className="flex items-center gap-1 border-b">
        {(['class', 'exam'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'class' ? 'Class overview' : 'Exam overview'}
          </button>
        ))}
      </div>

      {tab === 'exam' && <ExamOverview questions={data.questions} students={data.students} />}

      {/* Grading table — overview only: identity, total, grade, status, return.
          Per-question scores are auto-computed (override API exists for a future
          per-student detail view) but omitted here: too many exercises to be
          meaningful per row. */}
      <div className={`overflow-x-auto rounded-lg border ${tab === 'class' ? '' : 'hidden'}`}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="px-3 py-2 font-medium">
                <div className="flex items-center gap-2">
                  <span>Student</span>
                  <button
                    type="button"
                    onClick={() => toggleSort('alpha')}
                    title="Sort A–Z by email, then nickname"
                    aria-label="Sort by email / nickname"
                    className={`inline-flex items-center rounded p-1 transition-colors ${sortKey === 'alpha' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                  >
                    {sortKey === 'alpha' && sortDir === 'desc' ? <ArrowUpAZ className="w-4 h-4" /> : <ArrowDownAZ className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSort('surname')}
                    title="Sort by surname (firstname.lastname@…)"
                    aria-label="Sort by surname"
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors ${sortKey === 'surname' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                  >
                    {sortKey === 'surname' && sortDir === 'desc' ? <ArrowUpAZ className="w-4 h-4" /> : <ArrowDownAZ className="w-4 h-4" />}
                    Surname
                  </button>
                </div>
              </th>
              {allMode && <th className="px-3 py-2 font-medium">Class</th>}
              <th className="px-3 py-2 font-medium text-right">Total</th>
              <th className="px-3 py-2 font-medium text-right">Grade</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sortedStudents.map((s) => (
              <tr key={s.studentId} className="border-t hover:bg-accent/30">
                <td className="px-3 py-2">
                  {/* Links to the in-exam view of this student's graded answers. */}
                  {data.examUrl ? (
                    <Link
                      href={`${data.examUrl}?classId=${classId}&student=${s.studentId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {displayName(s)}
                    </Link>
                  ) : (
                    <span className="font-medium">{displayName(s)}</span>
                  )}
                  {/* When the primary is an email (mapped or revealed), show the
                      pseudonym/name underneath for cross-reference. */}
                  {displayName(s).includes('@') && (s.name || s.pseudonym) && (
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
                  <StatusChip status={s.status} source={s.source} />
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

      <AiScoringModal
        open={aiOpen}
        onOpenChange={setAiOpen}
        pageId={pageId}
        questions={data.questions}
        studentIds={data.students.filter((s) => s.status !== 'not_started').map((s) => s.studentId)}
        studentLabels={Object.fromEntries(data.students.map((s) => [s.studentId, displayName(s)]))}
        onScored={loadGrading}
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

/**
 * Per-exercise breakdown across the class: max points + how students did
 * (full / partial / zero / not answered), as a stacked bar. Helps the teacher
 * see which exercises were hard and sanity-check the max points. Computed from
 * the already-loaded grading data — no extra fetch.
 */
function ExamOverview({ questions, students }: { questions: Question[]; students: StudentRow[] }) {
  const handed = students.filter((s) => s.status !== 'not_started')
  const totalMax = questions.reduce((s, q) => s + (q.maxPoints ?? 0), 0)

  if (questions.length === 0) {
    return <p className="text-sm text-muted-foreground">No gradable exercises on this exam.</p>
  }

  const rows = questions.map((q) => {
    const cells = handed.map((s) => s.components.find((c) => c.componentId === q.componentId)).filter(Boolean) as ComponentCell[]
    const max = q.maxPoints ?? cells[0]?.max ?? 0
    let full = 0, partial = 0, zero = 0, none = 0, sum = 0
    for (const c of cells) {
      if (!c.answered) { none++; continue }
      sum += c.earned
      if (c.max > 0 && c.earned >= c.max) full++
      else if (c.earned > 0) partial++
      else zero++
    }
    return { q, max, full, partial, zero, none, n: cells.length, avg: cells.length ? sum / cells.length : 0 }
  })

  const seg = (count: number, n: number, cls: string, label: string) =>
    count > 0 ? <div className={cls} style={{ width: `${(count / n) * 100}%` }} title={`${label}: ${count}`} /> : null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{questions.length} exercises · {handed.length} handed in</span>
        <span className="tabular-nums">Σ max {fmt(totalMax)} pts</span>
      </div>
      <div className="rounded-lg border divide-y">
        {rows.map(({ q, max, full, partial, zero, none, n, avg }) => (
          <div key={q.componentId} className="p-3 space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium truncate">{q.label ?? q.componentId}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                ⌀ {fmt(Math.round(avg * 10) / 10)} / {fmt(max)} pts
              </span>
            </div>
            {n > 0 ? (
              <>
                <div className="flex h-3 w-full overflow-hidden rounded bg-muted">
                  {seg(full, n, 'bg-green-500', 'Full marks')}
                  {seg(partial, n, 'bg-amber-500', 'Partial')}
                  {seg(zero, n, 'bg-red-500', 'Zero')}
                  {seg(none, n, 'bg-muted-foreground/25', 'Not answered')}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
                  <span><span className="inline-block h-2 w-2 rounded-sm bg-green-500 align-middle" /> {full} full</span>
                  <span><span className="inline-block h-2 w-2 rounded-sm bg-amber-500 align-middle" /> {partial} partial</span>
                  <span><span className="inline-block h-2 w-2 rounded-sm bg-red-500 align-middle" /> {zero} zero</span>
                  <span><span className="inline-block h-2 w-2 rounded-sm bg-muted-foreground/25 align-middle" /> {none} blank</span>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No submissions yet.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusChip({ status, source }: { status: StudentRow['status']; source?: string | null }) {
  // For a handed-in (not yet returned) exam, reflect HOW it was submitted.
  const submittedLabel =
    source === 'teacher' ? 'Ended by teacher' : source === 'recovery' ? 'Recovered' : 'Handed in'
  const map = {
    not_started: { label: 'Not started', cls: 'bg-muted text-muted-foreground' },
    submitted: { label: submittedLabel, cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
    returned: { label: 'Returned', cls: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  }[status]
  return <span className={`inline-block rounded px-2 py-0.5 text-xs ${map.cls}`}>{map.label}</span>
}

