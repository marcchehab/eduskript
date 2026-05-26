#!/usr/bin/env node
// Seeds a FRESH end-to-end exam scenario under the dev teacher:
//   collection → skript → non-SEB STAGED exam page covering every question type
//   (text/single/multiple/number/range) + a <next-stage> + a python editor with
//   a python-check, and a class with THREE enrolled students.
//
// No answers are pre-seeded — drive the students through the UI to exercise the
// real autosave + hand-in flow. Re-runnable: resets the page + all 3 attempts.
//
// Prereq: scripts/seed-dev-teacher.mjs (teacher@eduskript.test).
import { config } from 'dotenv'
config({ path: '.env.local' })
config()

const bcrypt = (await import('bcryptjs')).default
const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const pg = (await import('pg')).default

const TEACHER_EMAIL = 'teacher@eduskript.test'
const SKRIPT_SLUG = 'e2e-exam'
const PAGE_SLUG = 'klassenarbeit2'
const INVITE = 'E2EEXAM'
const STUDENTS = [
  { email: 'student1@eduskript.test', name: 'Student One', pseudonym: 'dev-student-1' },
  { email: 'student2@eduskript.test', name: 'Student Two', pseudonym: 'dev-student-2' },
  { email: 'student3@eduskript.test', name: 'Student Three', pseudonym: 'dev-student-3' },
]
const STUDENT_PASSWORD = 'student123'

const content = `# Klassenarbeit 2 (E2E)

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

## Aufgabe 4 — Schätzung (2 Punkte)

<question id="q4" type="number" points="2" minValue="0" maxValue="100" step="1">
Schätze: wie viele Prozent des Tages schläfst du?
</question>

## Aufgabe 5 — Bereich (2 Punkte)

<question id="q5" type="range" points="2" minValue="0" maxValue="40">
In welchem Bereich liegt die ideale Raumtemperatur (°C)?
</question>

<next-stage label="Teil 1 abgeben & weiter" title="Teil 1 abgeben?" confirm="Ja, weiter" cancel="Zurück">

## Aufgabe 6 — Funktion schreiben (4 Punkte)

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
  if (!teacher) throw new Error(`${TEACHER_EMAIL} not found (run scripts/seed-dev-teacher.mjs)`)
  const site = await prisma.site.findFirst({ where: { userId: teacher.id }, select: { id: true, slug: true } })
  if (!site) throw new Error(`No site for ${TEACHER_EMAIL}`)

  // Ensure all 3 students exist (credentials login).
  const hashedPassword = await bcrypt.hash(STUDENT_PASSWORD, 12)
  const students = []
  for (const s of STUDENTS) {
    const u = await prisma.user.upsert({
      where: { email: s.email },
      update: { hashedPassword, emailVerified: new Date() },
      create: {
        email: s.email, name: s.name, accountType: 'student',
        studentPseudonym: s.pseudonym, hashedPassword, emailVerified: new Date(),
      },
      select: { id: true, email: true },
    })
    students.push(u)
  }

  let collection = await prisma.collection.findFirst({ where: { siteId: site.id, title: 'E2E Exam' } })
  if (!collection) collection = await prisma.collection.create({ data: { siteId: site.id, title: 'E2E Exam' } })

  const cs = await prisma.collectionSkript.findFirst({
    where: { collectionId: collection.id, skript: { slug: SKRIPT_SLUG } },
    select: { skript: { select: { id: true } } },
  })
  let skript = cs?.skript ?? null
  if (!skript) {
    skript = await prisma.skript.create({ data: { title: 'E2E Exam', slug: SKRIPT_SLUG, isPublished: true } })
    await prisma.collectionSkript.create({ data: { collectionId: collection.id, skriptId: skript.id, order: 0 } })
  }
  const hasAuthor = await prisma.skriptAuthor.findFirst({ where: { skriptId: skript.id, userId: teacher.id } })
  if (!hasAuthor) await prisma.skriptAuthor.create({ data: { skriptId: skript.id, userId: teacher.id, permission: 'author' } })

  await prisma.page.deleteMany({ where: { slug: PAGE_SLUG, skriptId: skript.id } })
  const page = await prisma.page.create({
    data: {
      title: 'Klassenarbeit 2 (E2E)', slug: PAGE_SLUG, content, order: 0,
      isPublished: true, pageType: 'exam', examSettings, skriptId: skript.id,
      authors: { create: { userId: teacher.id, permission: 'author' } },
    },
  })

  const klass = await prisma.class.upsert({
    where: { inviteCode: INVITE },
    update: { teacherId: teacher.id },
    create: { name: 'E2E Class', teacherId: teacher.id, inviteCode: INVITE },
  })
  for (const s of students) {
    await prisma.classMembership.upsert({
      where: { classId_studentId: { classId: klass.id, studentId: s.id } },
      create: { classId: klass.id, studentId: s.id, identityConsent: true, consentedAt: new Date() },
      update: { identityConsent: true },
    })
  }

  await prisma.pageUnlock.deleteMany({ where: { pageId: page.id } })
  await prisma.pageUnlock.create({ data: { pageId: page.id, classId: klass.id, unlockedBy: teacher.id } })
  await prisma.examState.upsert({
    where: { pageId_classId: { pageId: page.id, classId: klass.id } },
    create: { pageId: page.id, classId: klass.id, state: 'open', openedAt: new Date() },
    update: { state: 'open', openedAt: new Date(), closedAt: null },
  })

  // Fresh slate for every student.
  for (const s of students) {
    await prisma.examSubmission.deleteMany({ where: { pageId: page.id, studentId: s.id } })
    await prisma.examQuestionGrade.deleteMany({ where: { pageId: page.id, studentId: s.id } })
    await prisma.examCheckRun.deleteMany({ where: { pageId: page.id, studentId: s.id } })
    await prisma.userData.deleteMany({ where: { userId: s.id, itemId: page.id } })
    await prisma.userDataCheckpoint.deleteMany({ where: { userId: s.id, pageId: page.id } })
  }
  await prisma.examGradeConfig.deleteMany({ where: { pageId: page.id } })

  console.log('\n✅ E2E exam seeded\n')
  console.log(`   pageId   : ${page.id}`)
  console.log(`   classId  : ${klass.id}`)
  console.log(`   exam URL : http://localhost:3000/exam/${site.slug}/${SKRIPT_SLUG}/${PAGE_SLUG}`)
  console.log(`   students : ${students.map((s) => s.email).join(', ')} / ${STUDENT_PASSWORD}`)
  console.log(`   grade URL: http://localhost:3000/dashboard/exams/${page.id}/grading?classId=${klass.id}`)
  console.log(`   hand-in  : await fetch('/api/exams/${page.id}/hand-in', {method:'POST'}).then(r=>r.json())\n`)
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
  await pool.end()
}
