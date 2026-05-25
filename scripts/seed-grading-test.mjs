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

const TEACHER_EMAIL = 'eduadmin@eduskript.org'
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

  let skript = await prisma.skript.findFirst({ where: { slug: SKRIPT_SLUG } })
  if (!skript) {
    skript = await prisma.skript.create({ data: { title: 'Grading Test', slug: SKRIPT_SLUG, isPublished: true } })
    await prisma.collectionSkript.create({ data: { collectionId: collection.id, skriptId: skript.id, order: 0 } })
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

  // Class + membership (upsert by invite code)
  let klass = await prisma.class.findUnique({ where: { inviteCode: INVITE } })
  if (!klass) {
    klass = await prisma.class.create({
      data: { name: 'Test Class (Grading)', teacherId: teacher.id, inviteCode: INVITE },
    })
  }
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
  await prisma.examQuestionGrade.deleteMany({ where: { pageId: page.id, studentId: student.id } })
  await prisma.userData.deleteMany({ where: { userId: student.id, itemId: page.id } })

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
