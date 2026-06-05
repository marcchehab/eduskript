#!/usr/bin/env node
/**
 * Rigorous grading-test scenario: ONE exam with 2 multiple-choice questions and
 * 3 python coding exercises, plus 5 students with DETERMINISTIC submissions
 * chosen so each coding exercise's check score = (passed asserts), because every
 * exercise's declared points == its assert count. See docs predictions protocol.
 *
 *   Q1 single   (2 pts)  — correct = the "1" answer (dense index 1)
 *   Q2 multiple (2 pts)  — correct = {"2","4"} (dense indices {0,2})
 *   E1 doppelt  (4 pts, 4 asserts)
 *   E2 ist_gerade (3 pts, 3 asserts)
 *   E3 summe    (5 pts, 5 asserts)   max total = 16
 *
 * Re-runnable: reuses the page id (stable URL), recreates content, resets all
 * five students' data, and cleans orphaned component UserData for this skript.
 * Does NOT write ComponentScore — the real flow creates check scores when the
 * teacher runs checks / views students.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config()

const bcrypt = (await import('bcryptjs')).default
const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const pg = (await import('pg')).default

const TEACHER_EMAIL = 'teacher@eduskript.test'
const SKRIPT_SLUG = 'rich-exam'
const PAGE_SLUG = 'pruefung'
const INVITE = 'RICHEXAM'

const content = `# Rigorose Prüfung

## Aufgabe 1 — Einfachauswahl (2 Punkte)

<question id="q1" type="single" points="2">
Was ist \`3 % 2\`?
<answer>0</answer>
<answer correct="true">1</answer>
<answer>2</answer>
</question>

## Aufgabe 2 — Mehrfachauswahl (2 Punkte)

<question id="q2" type="multiple" points="2">
Welche Zahlen sind gerade?
<answer correct="true">2</answer>
<answer>3</answer>
<answer correct="true">4</answer>
</question>

## Aufgabe 3 — doppelt (4 Punkte)

Schreiben Sie \`doppelt(x)\`, das das Doppelte von \`x\` zurückgibt.

\`\`\`python editor exam id="e1code"
def doppelt(x):
    pass
\`\`\`

\`\`\`python-check for="e1code" points="4"
assert doppelt(2) == 4
assert doppelt(0) == 0
assert doppelt(5) == 10
assert doppelt(-3) == -6
\`\`\`

## Aufgabe 4 — ist_gerade (3 Punkte)

Schreiben Sie \`ist_gerade(n)\`, das \`True\` zurückgibt, wenn \`n\` gerade ist.

\`\`\`python editor exam id="e2code"
def ist_gerade(n):
    pass
\`\`\`

\`\`\`python-check for="e2code" points="3"
assert ist_gerade(4) == True
assert ist_gerade(7) == False
assert ist_gerade(0) == True
\`\`\`

## Aufgabe 5 — summe (5 Punkte)

Schreiben Sie \`summe(liste)\`, das die Summe der Listenelemente zurückgibt.

\`\`\`python editor exam id="e3code"
def summe(liste):
    pass
\`\`\`

\`\`\`python-check for="e3code" points="5"
assert summe([]) == 0
assert summe([1, 2, 3]) == 6
assert summe([5]) == 5
assert summe([-1, 1]) == 0
assert summe([10, 20, 30]) == 60
\`\`\`
`

// Deterministic code per pass-count (verified by hand against the asserts above).
const E1 = {
  4: 'def doppelt(x):\n    return x * 2\n',
  3: 'def doppelt(x):\n    return x * 2 if x >= 0 else 0\n', // fails -3
  2: 'def doppelt(x):\n    return x * 2 if x > 0 else 99\n', // 2,5 pass; 0,-3 fail
  1: 'def doppelt(x):\n    return 0\n', // only doppelt(0)==0
  0: 'def doppelt(x):\n    return 7\n',
}
const E2 = {
  3: 'def ist_gerade(n):\n    return n % 2 == 0\n',
  2: 'def ist_gerade(n):\n    return True\n', // 4,0 pass; 7 fails
  1: 'def ist_gerade(n):\n    return False\n', // only 7
  0: 'def ist_gerade(n):\n    return n\n', // n==True is False for 4/7/0
}
const E3 = {
  5: 'def summe(liste):\n    return sum(liste)\n',
  4: 'def summe(liste):\n    return sum(liste) if liste else 1\n', // [] fails
  2: 'def summe(liste):\n    return liste[0] if liste else 0\n', // [], [5] pass
  1: 'def summe(liste):\n    return len(liste)\n', // only []
  0: 'def summe(liste):\n    return 42\n',
}

// [Q1 correct?, Q2 correct?, E1 pass, E2 pass, E3 pass]
const MATRIX = {
  'student1@eduskript.test': { name: 'Student One',   q1: true,  q2: true,  e1: 4, e2: 3, e3: 5 },
  'student2@eduskript.test': { name: 'Student Two',   q1: true,  q2: false, e1: 3, e2: 2, e3: 4 },
  'student3@eduskript.test': { name: 'Student Three', q1: false, q2: true,  e1: 2, e2: 1, e3: 2 },
  'student4@eduskript.test': { name: 'Student Four',  q1: true,  q2: true,  e1: 1, e2: 3, e3: 1 },
  'student5@eduskript.test': { name: 'Student Five',  q1: false, q2: false, e1: 0, e2: 0, e3: 0 },
}

const examSettings = { requireSEB: false }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function ensureStudent(email, name, n) {
  const hashedPassword = await bcrypt.hash('student123', 12)
  return prisma.user.upsert({
    where: { email },
    update: { emailVerified: new Date() },
    create: {
      email, name, accountType: 'student',
      studentPseudonym: `dev-student-${n}`, hashedPassword, emailVerified: new Date(),
    },
    select: { id: true },
  })
}

try {
  const teacher = await prisma.user.findUnique({ where: { email: TEACHER_EMAIL }, select: { id: true } })
  if (!teacher) throw new Error(`${TEACHER_EMAIL} not found`)
  const site = await prisma.site.findFirst({ where: { userId: teacher.id }, select: { id: true, slug: true } })
  if (!site) throw new Error(`No site for ${TEACHER_EMAIL}`)

  const emails = Object.keys(MATRIX)
  const students = {}
  for (let i = 0; i < emails.length; i++) {
    const s = await ensureStudent(emails[i], MATRIX[emails[i]].name, i + 1)
    students[emails[i]] = s.id
  }

  let collection = await prisma.collection.findFirst({ where: { siteId: site.id, title: 'Rich Exam' } })
  if (!collection) collection = await prisma.collection.create({ data: { siteId: site.id, title: 'Rich Exam' } })

  const cs = await prisma.collectionSkript.findFirst({
    where: { collectionId: collection.id, skript: { slug: SKRIPT_SLUG } },
    select: { skript: { select: { id: true } } },
  })
  let skript = cs?.skript ?? null
  if (!skript) {
    skript = await prisma.skript.create({ data: { title: 'Rich Exam', slug: SKRIPT_SLUG, isPublished: true } })
    await prisma.collectionSkript.create({ data: { collectionId: collection.id, skriptId: skript.id, order: 0 } })
  }
  if (!(await prisma.skriptAuthor.findFirst({ where: { skriptId: skript.id, userId: teacher.id } }))) {
    await prisma.skriptAuthor.create({ data: { skriptId: skript.id, userId: teacher.id, permission: 'author' } })
  }

  // Reuse the page id across runs (stable URL). Clean its old data first.
  let page = await prisma.page.findFirst({ where: { slug: PAGE_SLUG, skriptId: skript.id }, select: { id: true } })
  if (page) {
    await prisma.page.update({ where: { id: page.id }, data: { title: 'Rigorose Prüfung', content, pageType: 'exam', examSettings, isPublished: true } })
  } else {
    page = await prisma.page.create({
      data: {
        title: 'Rigorose Prüfung', slug: PAGE_SLUG, content, order: 0, isPublished: true,
        pageType: 'exam', examSettings, skriptId: skript.id,
        authors: { create: { userId: teacher.id, permission: 'author' } },
      },
      select: { id: true },
    })
  }
  const pageId = page.id

  const klass = await prisma.class.upsert({
    where: { inviteCode: INVITE },
    update: { teacherId: teacher.id },
    create: { name: 'Rich Exam Class', teacherId: teacher.id, inviteCode: INVITE },
  })

  await prisma.pageUnlock.deleteMany({ where: { pageId } })
  await prisma.pageUnlock.create({ data: { pageId, classId: klass.id, unlockedBy: teacher.id } })
  await prisma.examState.upsert({
    where: { pageId_classId: { pageId, classId: klass.id } },
    create: { pageId, classId: klass.id, state: 'open', openedAt: new Date() },
    update: { state: 'open', openedAt: new Date(), closedAt: null },
  })

  // Wipe all prior data for this exam (any student) + clean orphaned component
  // UserData for this skript's pages (avoids the accumulate-orphans problem).
  await prisma.componentScore.deleteMany({ where: { pageId } })
  await prisma.scoringRubric.deleteMany({ where: { pageId } })
  await prisma.examSubmission.deleteMany({ where: { pageId } })
  await prisma.userData.deleteMany({ where: { itemId: pageId } })
  await prisma.userDataCheckpoint.deleteMany({ where: { pageId } })

  const editorData = (body) => ({ files: [{ name: 'main.py', content: body }], activeFileIndex: 0 })
  const t0 = Date.now() - 20 * 60 * 1000

  for (const email of emails) {
    const m = MATRIX[email]
    const sid = students[email]
    await prisma.classMembership.upsert({
      where: { classId_studentId: { classId: klass.id, studentId: sid } },
      create: { classId: klass.id, studentId: sid, identityConsent: true, consentedAt: new Date() },
      update: { identityConsent: true },
    })

    const e1 = E1[m.e1], e2 = E2[m.e2], e3 = E3[m.e3]
    const rows = [
      // MC: dense element-only indices. single q1 correct = [1]; multiple q2 correct = [0,2].
      ['quiz-user-content-q1', { isSubmitted: true, selected: m.q1 ? [1] : [0], choiceScore: m.q1 ? 2 : 0 }],
      ['quiz-user-content-q2', { isSubmitted: true, selected: m.q2 ? [0, 2] : [1], choiceScore: m.q2 ? 2 : 0 }],
      ['code-editor-e1code', editorData(e1)],
      ['code-editor-e2code', editorData(e2)],
      ['code-editor-e3code', editorData(e3)],
    ]
    for (const [adapter, data] of rows) {
      await prisma.userData.create({ data: { userId: sid, adapter, itemId: pageId, data, version: 1 } })
    }
    // Handin checkpoints for each editor (the re-run grades these).
    for (const [adapter, body] of [['code-editor-e1code', e1], ['code-editor-e2code', e2], ['code-editor-e3code', e3]]) {
      await prisma.userDataCheckpoint.create({
        data: { userId: sid, pageId, componentId: adapter, kind: 'handin', label: 'exam hand-in', payload: editorData(body), createdAt: new Date(t0) },
      })
    }
    await prisma.examSubmission.create({ data: { pageId, studentId: sid } })
  }

  console.log('\n✅ Rich exam seeded — 5 students, 2 MC + 3 coding, max 16 pts\n')
  console.log(`   pageId   : ${pageId}`)
  console.log(`   classId  : ${klass.id}`)
  console.log(`   exam URL : http://localhost:3000/exam/${site.slug}/${SKRIPT_SLUG}/${PAGE_SLUG}`)
  console.log(`   grade URL: http://localhost:3000/dashboard/exams/${pageId}/grading?classId=${klass.id}`)
  console.log(`              (teacher@eduskript.test / teacher123)\n`)
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
  await pool.end()
}
