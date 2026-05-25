#!/usr/bin/env node
// Seeds an EXAM page (pageType="exam") with predict-the-output free-text
// questions, to preview how auto-checked questions behave in an exam.
//
// examSettings: requireSEB:false (viewable in a normal browser) and
// unlockForAll:true (any logged-in user can open it; the teacher-author always
// can). Questions need no showFeedback attribute: on exam pages feedback
// defaults OFF, so the partial-credit score is still computed and stored for
// the teacher to grade, but the student sees no correct/wrong during the exam.
//
// URL: /exam/teacher/interactive-code/exam-predict-output
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'

config()

const SKRIPT_SLUG = 'interactive-code'
const PAGE_SLUG = 'exam-predict-output'
const PAGE_TITLE = 'Exam — predict the output'
const TEACHER_EMAIL = 'teacher@eduskript.org'

const content = `# Exam — predict the output

Answer each question by typing exactly what the program prints. You will **not**
see whether your answer is correct — your teacher grades after hand-in.

## Question 1

\`\`\`python
for i in range(4):
    print(i * i)
\`\`\`

<Question id="exam1" type="text" points="3">
Predict the output:

\`\`\`expected
0
1
4
9
\`\`\`

</Question>

## Question 2

\`\`\`python
word = "exam"
print(word.upper())
print(word[::-1])
\`\`\`

<Question id="exam2" type="text" points="2">
Predict the output:

\`\`\`expected
EXAM
maxe
\`\`\`

</Question>
`

const examSettings = { requireSEB: false, unlockForAll: true }

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

try {
  await client.query('BEGIN')

  const { rows: userRows } = await client.query('SELECT id FROM users WHERE email = $1', [TEACHER_EMAIL])
  if (userRows.length === 0) throw new Error(`User ${TEACHER_EMAIL} not found`)
  const userId = userRows[0].id

  const { rows: skriptRows } = await client.query('SELECT id FROM skripts WHERE slug = $1', [SKRIPT_SLUG])
  if (skriptRows.length === 0) throw new Error(`Skript ${SKRIPT_SLUG} not found`)
  const skriptId = skriptRows[0].id

  await client.query('DELETE FROM pages WHERE slug = $1 AND "skriptId" = $2', [PAGE_SLUG, skriptId])

  const pageId = randomUUID()
  await client.query(
    `INSERT INTO pages (id, title, slug, content, "order", "isPublished", page_type, exam_settings, "skriptId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 97, true, 'exam', $5, $6, NOW(), NOW())`,
    [pageId, PAGE_TITLE, PAGE_SLUG, content, JSON.stringify(examSettings), skriptId]
  )
  await client.query(
    `INSERT INTO page_authors (id, "pageId", "userId", permission, "createdAt")
     VALUES ($1, $2, $3, 'author', NOW())`,
    [randomUUID(), pageId, userId]
  )

  await client.query('COMMIT')
  console.log('seeded exam:', `http://localhost:3000/exam/teacher/${SKRIPT_SLUG}/${PAGE_SLUG}`)
  console.log('(open while logged in as the teacher/author, or any logged-in user — unlockForAll is on)')
} catch (e) {
  await client.query('ROLLBACK')
  console.error(e)
  process.exitCode = 1
} finally {
  await client.end()
}
