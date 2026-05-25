#!/usr/bin/env node
// Seeds a demo page for the free-text predict-the-output auto-check.
// URL: /teacher/interactive-code/predict-output-demo
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'

config()

const SKRIPT_SLUG = 'interactive-code'
const PAGE_SLUG = 'predict-output-examples'
const PAGE_TITLE = 'Predict the output — examples'
const TEACHER_EMAIL = 'teacher@eduskript.org'

const content = `# Predict the output — examples

Read each program (don't run it), then type **exactly** what it prints. Your
answer is graded by similarity to the expected output — partial credit, rounded
to 0.1 points — and a diff shows where it differs. Surrounding blank lines and
trailing spaces are ignored.

## 1. A counting loop

\`\`\`python
for i in range(3):
    print(i * 2)
\`\`\`

<Question id="ex1" type="text" points="2">
Predict the output:

\`\`\`expected
0
2
4
\`\`\`

</Question>

## 2. Strings & length

\`\`\`python
name = "Ada"
print("Hi, " + name + "!")
print(len(name))
\`\`\`

<Question id="ex2" type="text" points="1">
What does it print?

\`\`\`expected
Hi, Ada!
3
\`\`\`

</Question>

## 3. Integer vs float division

\`\`\`python
print(7 // 2)
print(7 / 2)
print(7 % 2)
\`\`\`

<Question id="ex3" type="text" points="3">
Three lines of output (this one is worth 3 points):

\`\`\`expected
3
3.5
1
\`\`\`

</Question>

## 4. Accumulating in a loop

\`\`\`python
total = 0
for n in [5, 10, 15]:
    total += n
    print("running total:", total)
\`\`\`

<Question id="ex4" type="text" points="2">
Predict every line:

\`\`\`expected
running total: 5
running total: 15
running total: 30
\`\`\`

</Question>

## 5. Case doesn't matter here

\`\`\`python
print("TRUE" if 3 > 2 else "false")
\`\`\`

<Question id="ex5" type="text" points="1" ignore-case="true">
What prints? (this question ignores letter case)

\`\`\`expected
true
\`\`\`

</Question>

## 6. Spacing-tolerant answer

\`\`\`python
print("a", "b", "c")
\`\`\`

<Question id="ex6" type="text" points="1" ignore-whitespace="true">
What prints? (this question ignores extra spaces)

\`\`\`expected
a b c
\`\`\`

</Question>
`

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
    `INSERT INTO pages (id, title, slug, content, "order", "isPublished", page_type, "skriptId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 98, true, 'normal', $5, NOW(), NOW())`,
    [pageId, PAGE_TITLE, PAGE_SLUG, content, skriptId]
  )
  await client.query(
    `INSERT INTO page_authors (id, "pageId", "userId", permission, "createdAt")
     VALUES ($1, $2, $3, 'author', NOW())`,
    [randomUUID(), pageId, userId]
  )

  await client.query('COMMIT')
  console.log('seeded:', `http://localhost:3000/teacher/${SKRIPT_SLUG}/${PAGE_SLUG}`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error(e)
  process.exitCode = 1
} finally {
  await client.end()
}
