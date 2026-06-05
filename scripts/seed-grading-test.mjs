#!/usr/bin/env node
// Seeds a complete LOCAL grading-test scenario under the eduadmin teacher:
//   collection → skript → non-SEB exam page (text + single + multiple choice)
//   + a class with student1 enrolled + page unlock + exam state "open".
// Re-runnable: it resets the page/class/submission so you get a clean slate.
//
// After seeding: log in as student1, open the exam URL, answer, then hand in
// with the printed fetch() (non-SEB hand-in now accepts a NextAuth student).
// Then log in as eduadmin and open the grading URL.
import { config } from 'dotenv'
config({ path: '.env.local' })
config()

const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const pg = (await import('pg')).default

// A real (paid) teacher — NOT the platform admin (eduadmin), which isn't meant
// to do teacher work. Run scripts/seed-dev-teacher.mjs first.
const TEACHER_EMAIL = 'teacher@eduskript.test'
const STUDENT_EMAIL = 'student1@eduskript.test'
const SKRIPT_SLUG = 'grading-test'
const PAGE_SLUG = 'klassenarbeit'
const INVITE = 'GRADINGTEST'

const content = `# Klassenarbeit (Test)

## Aufgabe 1 — Ausgabe voraussagen (3 Punkte)

\`\`\`python
for i in range(3):
    print(i * 2)
\`\`\`

<question id="q1" type="text" points="3">
Was gibt das Programm aus?

\`\`\`expected
0
2
4
\`\`\`
</question>

## Aufgabe 2 — Einfachauswahl (2 Punkte)

<question id="q2" type="single" points="2">
Was ist \`3 % 2\`?
<answer>0</answer>
<answer correct="true">1</answer>
<answer>2</answer>
</question>

## Aufgabe 3 — Mehrfachauswahl (2 Punkte)

<question id="q3" type="multiple" points="2">
Welche Zahlen sind gerade?
<answer correct="true">2</answer>
<answer>3</answer>
<answer correct="true">4</answer>
</question>

## Aufgabe 4 — Funktion schreiben (4 Punkte)

Schreiben Sie eine Funktion \`doppelt(x)\`, die das Doppelte von \`x\` zurückgibt.

\`\`\`python editor exam id="p1code"
def doppelt(x):
    # Ihr Code
    pass
\`\`\`

\`\`\`python-check for="p1code" points="4"
assert doppelt(2) == 4
assert doppelt(0) == 0
assert doppelt(5) == 10
assert doppelt(-3) == -6
\`\`\`
`

const examSettings = { requireSEB: false }

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

try {
  const teacher = await prisma.user.findUnique({ where: { email: TEACHER_EMAIL }, select: { id: true } })
  if (!teacher) throw new Error(`${TEACHER_EMAIL} not found (run seed-admin / db:reset first)`)
  const student = await prisma.user.findUnique({ where: { email: STUDENT_EMAIL }, select: { id: true } })
  if (!student) throw new Error(`${STUDENT_EMAIL} not found (run scripts/seed-dev-student.mjs)`)
  const site = await prisma.site.findFirst({ where: { userId: teacher.id }, select: { id: true, slug: true } })
  if (!site) throw new Error(`No site for ${TEACHER_EMAIL}`)

  // Collection → Skript → CollectionSkript → SkriptAuthor
  let collection = await prisma.collection.findFirst({ where: { siteId: site.id, title: 'Grading Test' } })
  if (!collection) collection = await prisma.collection.create({ data: { siteId: site.id, title: 'Grading Test' } })

  // Skript must live under THIS teacher's collection + be authored by them, or
  // the exam route won't treat the teacher as author. Scope the lookup to the
  // teacher's collection (a stale same-slug skript under another owner is left
  // alone), and ensure SkriptAuthor either way.
  const cs = await prisma.collectionSkript.findFirst({
    where: { collectionId: collection.id, skript: { slug: SKRIPT_SLUG } },
    select: { skript: { select: { id: true } } },
  })
  let skript = cs?.skript ?? null
  if (!skript) {
    skript = await prisma.skript.create({ data: { title: 'Grading Test', slug: SKRIPT_SLUG, isPublished: true } })
    await prisma.collectionSkript.create({ data: { collectionId: collection.id, skriptId: skript.id, order: 0 } })
  }
  const hasAuthor = await prisma.skriptAuthor.findFirst({ where: { skriptId: skript.id, userId: teacher.id } })
  if (!hasAuthor) {
    await prisma.skriptAuthor.create({ data: { skriptId: skript.id, userId: teacher.id, permission: 'author' } })
  }

  // Page (reset to a clean copy each run)
  await prisma.page.deleteMany({ where: { slug: PAGE_SLUG, skriptId: skript.id } })
  const page = await prisma.page.create({
    data: {
      title: 'Klassenarbeit (Test)',
      slug: PAGE_SLUG,
      content,
      order: 0,
      isPublished: true,
      pageType: 'exam',
      examSettings,
      skriptId: skript.id,
      authors: { create: { userId: teacher.id, permission: 'author' } },
    },
  })

  // Class + membership (upsert by invite code). Always (re)assign to THIS
  // teacher — a class reused from a prior run under another owner must move,
  // or isClassTeacher / isTeacherOfStudentForPage fail.
  const klass = await prisma.class.upsert({
    where: { inviteCode: INVITE },
    update: { teacherId: teacher.id },
    create: { name: 'Test Class (Grading)', teacherId: teacher.id, inviteCode: INVITE },
  })
  await prisma.classMembership.upsert({
    where: { classId_studentId: { classId: klass.id, studentId: student.id } },
    create: { classId: klass.id, studentId: student.id, identityConsent: true, consentedAt: new Date() },
    update: { identityConsent: true },
  })

  // Unlock + open the exam for the class
  await prisma.pageUnlock.deleteMany({ where: { pageId: page.id } })
  await prisma.pageUnlock.create({ data: { pageId: page.id, classId: klass.id, unlockedBy: teacher.id } })
  await prisma.examState.upsert({
    where: { pageId_classId: { pageId: page.id, classId: klass.id } },
    create: { pageId: page.id, classId: klass.id, state: 'open', openedAt: new Date() },
    update: { state: 'open', openedAt: new Date(), closedAt: null },
  })

  // Reset any prior attempt by this student
  await prisma.examSubmission.deleteMany({ where: { pageId: page.id, studentId: student.id } })
  await prisma.componentScore.deleteMany({ where: { pageId: page.id, studentId: student.id } })
  await prisma.userData.deleteMany({ where: { userId: student.id, itemId: page.id } })
  await prisma.userDataCheckpoint.deleteMany({ where: { userId: student.id, pageId: page.id } })

  // The student's SUBMITTED code: a partially-correct solution (handles x>=0,
  // wrong for negatives) → the teacher-side re-run scores 3/4 (fails doppelt(-3)).
  const codeEditorData = {
    files: [{ name: 'main.py', content: 'def doppelt(x):\n    return x * 2 if x >= 0 else 0\n' }],
    activeFileIndex: 0,
  }

  // Seed a sample, immediately-gradable attempt (handed in, not yet returned):
  // text correct (3/3), single correct (2/2), multiple wrong (0/2), python 3/4.
  // componentIds: quiz `id` is clobbered by rehype-sanitize to user-content-*;
  // python lives under python-check-<editor id> (data-* not clobbered).
  const answers = [
    ['quiz-user-content-q1', { isSubmitted: true, textAnswer: '0\n2\n4', textRatio: 1, textScore: 3 }],
    ['quiz-user-content-q2', { isSubmitted: true, selected: [3], choiceScore: 2 }],
    ['quiz-user-content-q3', { isSubmitted: true, selected: [1], choiceScore: 0 }],
    ['code-editor-p1code', codeEditorData],
    // The student ran the check once: real result is 3/4 (doppelt(-3) fails), so
    // the live class overview shows them as attempted/partial. `earnedPoints` is
    // a TAMPERED claim of full marks (4) — authoritative grading ignores this
    // client value and re-runs the asserts teacher-side (→ check score 3).
    ['python-check-p1code', {
      checksUsed: 1, maxChecks: null, points: 4, earnedPoints: 4, lastCheckedAt: Date.now(),
      lastResults: [
        { index: 0, passed: true, label: 'assert doppelt(2) == 4' },
        { index: 1, passed: true, label: 'assert doppelt(0) == 0' },
        { index: 2, passed: true, label: 'assert doppelt(5) == 10' },
        { index: 3, passed: false, label: 'assert doppelt(-3) == -6', error: 'Expected -6, got 0' },
      ],
    }],
  ]
  for (const [adapter, data] of answers) {
    await prisma.userData.create({
      data: { userId: student.id, adapter, itemId: page.id, data, version: 1 },
    })
  }
  // Snapshot history for the code editor, oldest → newest, so the teacher's
  // snapshot list has several scrollable entries to step through. The LAST
  // (handin) is the submitted code the re-run grades; real hand-ins write it,
  // the seed must too, or the display and grade diverge. createdAt is staggered
  // so the list orders sensibly (route sorts desc).
  const code = (body) => ({ files: [{ name: 'main.py', content: body }], activeFileIndex: 0 })
  const t0 = Date.now() - 18 * 60 * 1000 // 18 min ago
  const min = 60 * 1000
  const history = [
    [0, 'run', 'ran code', code('def doppelt(x):\n    pass\n')],
    [3, 'check', 'checked (1/4)', code('def doppelt(x):\n    return x\n')],
    [6, 'run', 'ran code', code('def doppelt(x):\n    return x + x\n')],
    [9, 'check', 'checked (3/4)', code('def doppelt(x):\n    return x * 2 if x >= 0 else 0\n')],
    [12, 'autosave', null, code('def doppelt(x):\n    return x * 2 if x >= 0 else 0\n')],
    [18, 'handin', 'exam hand-in', codeEditorData],
  ]
  for (const [offsetMin, kind, label, payload] of history) {
    await prisma.userDataCheckpoint.create({
      data: {
        userId: student.id, pageId: page.id, componentId: 'code-editor-p1code',
        kind, label, payload, createdAt: new Date(t0 + offsetMin * min),
      },
    })
  }
  await prisma.examSubmission.create({ data: { pageId: page.id, studentId: student.id } })

  console.log('\n✅ Grading-test scenario seeded\n')
  console.log(`   pageId   : ${page.id}`)
  console.log(`   classId  : ${klass.id}`)
  console.log(`   exam URL : http://localhost:3000/exam/${site.slug}/${SKRIPT_SLUG}/${PAGE_SLUG}`)
  console.log(`              (log in as ${STUDENT_EMAIL} / student123, answer the 3 questions)`)
  console.log(`\n   hand in (run in student1's browser console after answering):`)
  console.log(`     await fetch('/api/exams/${page.id}/hand-in', {method:'POST'}).then(r=>r.json())`)
  console.log(`\n   grade URL: http://localhost:3000/dashboard/exams/${page.id}/grading?classId=${klass.id}`)
  console.log(`              (log in as ${TEACHER_EMAIL} / teacher123)\n`)
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
  await pool.end()
}
