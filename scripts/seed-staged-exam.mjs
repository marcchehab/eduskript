#!/usr/bin/env node
// Seeds a STAGED exam page demonstrating <next-stage>: a predict-output stage,
// then a runnable Python editor stage. The editor stage isn't reachable (or
// rendered) until the predict-output stage is handed in & locked — so a student
// can't run the shown program to get the prediction answer.
//
// pageType="exam", requireSEB:false + unlockForAll:true so it opens in a normal
// browser (the teacher-author always can).
// URL: /exam/teacher/interactive-code/staged-exam
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'

config()

const SKRIPT_SLUG = 'interactive-code'
const PAGE_SLUG = 'staged-exam'
const PAGE_TITLE = 'Exam — staged (predict, then code)'
const TEACHER_EMAIL = 'teacher@eduskript.org'

const content = `# Staged exam

## Stage 1 — predict the output

Read this program (don't run it) and predict exactly what it prints.

\`\`\`python
for i in range(3):
    print(i * 2)
\`\`\`

<Question id="s1q1" type="text" points="2">
Predict the output:

\`\`\`expected
0
2
4
\`\`\`

</Question>

<next-stage label="Hand in & continue">

## Stage 2 — write a program

Now write and run a program that prints the squares of 0, 1, 2, 3.

\`\`\`python editor id="task"
# your code here
\`\`\`
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
     VALUES ($1, $2, $3, $4, 96, true, 'exam', $5, $6, NOW(), NOW())`,
    [pageId, PAGE_TITLE, PAGE_SLUG, content, JSON.stringify(examSettings), skriptId]
  )
  await client.query(
    `INSERT INTO page_authors (id, "pageId", "userId", permission, "createdAt")
     VALUES ($1, $2, $3, 'author', NOW())`,
    [randomUUID(), pageId, userId]
  )

  await client.query('COMMIT')
  console.log('seeded staged exam:', `http://localhost:3000/exam/teacher/${SKRIPT_SLUG}/${PAGE_SLUG}`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error(e)
  process.exitCode = 1
} finally {
  await client.end()
}
