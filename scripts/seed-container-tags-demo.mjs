#!/usr/bin/env node
/**
 * Seeds a demo page exercising blank-line-robust custom container tags
 * (flex, tabs, center, question) deliberately authored WITHOUT the blank lines
 * that used to be required. Idempotent: re-running replaces the page/skript.
 *
 * URL: http://localhost:3000/<siteSlug>/container-demo/tags
 */
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'

config()

const TEACHER_EMAIL = 'teacher@eduskript.test'
const SKRIPT_SLUG = 'container-demo'
const PAGE_SLUG = 'tags'
const TITLE = 'Container tags — blank-line robustness'

// Deliberately MESSY spacing — random blank lines inside tags, missing blank
// lines after closing tags. This is the content that used to collapse the rest
// of the page into a flex-item/tab-item. It must now render correctly.
const content = `# Blank-line robustness demo

Every tag below has **deliberately messy** spacing — random blank lines inside
tags, missing blank lines after closing tags. It must all render correctly.

## Flex (blank lines inside flex-items)

<flex gap="medium">
<flex-item>
### Left
- **bold** item
- a [link](https://eduskript.org)

</flex-item>



<flex-item>
### Right
Some *italic* prose and \`inline code\`.
</flex-item>
</flex>

## Tabs (nested flex, blank line before "Second column")

<tabs-container data-items='["First","Second"]'>
<tab-item>
## In a tab
- works
- without blank lines
</tab-item>
<tab-item>
<flex>
<flex-item>
**Nested** flex inside a tab.
</flex-item>
<flex-item>

Second column.
</flex-item>
</flex>
</tab-item>
</tabs-container>

## Center alignment (blank lines after open tag)

<center>


### Centered heading
A centered **paragraph** rendered from markdown.
</center>

## Single-choice question (stray blank line between answers)

<question id="demo-single" type="single">
Was gibt diese Schleife aus?
<answer>Eine Zahl zwischen 1 und 6</answer>
<answer correct="true">Eine Zahl zwischen 11 und 16</answer>

<answer>Immer genau 16</answer>
<answer>Eine Zahl zwischen 10 und 16</answer>




</question>
## Multiple-choice (NO blank line before this heading — used to get absorbed)

<question id="demo-multi" type="multiple">
Welche sind Programmiersprachen?

<answer correct="true">Python</answer>
<answer>HTML</answer>
<answer correct="true">JavaScript</answer>

</question>

## The end

This final paragraph must NOT end up inside a tab or a question.
`

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

try {
  await client.query('BEGIN')

  const { rows: userRows } = await client.query('SELECT id FROM users WHERE email = $1', [TEACHER_EMAIL])
  if (userRows.length === 0) throw new Error(`User ${TEACHER_EMAIL} not found`)
  const userId = userRows[0].id

  const { rows: siteRows } = await client.query('SELECT id, slug FROM sites WHERE user_id = $1', [userId])
  if (siteRows.length === 0) throw new Error(`No site for ${TEACHER_EMAIL}`)
  const siteId = siteRows[0].id
  const siteSlug = siteRows[0].slug

  // Clean prior run (page → skript → collection).
  await client.query(
    `DELETE FROM pages WHERE "skriptId" IN (SELECT id FROM skripts WHERE slug = $1)`,
    [SKRIPT_SLUG]
  )
  await client.query('DELETE FROM skripts WHERE slug = $1', [SKRIPT_SLUG])
  await client.query(
    `DELETE FROM collections WHERE site_id = $1 AND title = $2`,
    [siteId, TITLE]
  )

  const collectionId = randomUUID()
  await client.query(
    `INSERT INTO collections (id, title, "createdAt", "updatedAt", site_id) VALUES ($1, $2, NOW(), NOW(), $3)`,
    [collectionId, TITLE, siteId]
  )

  const skriptId = randomUUID()
  await client.query(
    `INSERT INTO skripts (id, title, slug, "isPublished", skript_type, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, 'normal', NOW(), NOW())`,
    [skriptId, TITLE, SKRIPT_SLUG]
  )
  await client.query(
    `INSERT INTO skript_authors (id, "skriptId", "userId", permission, "createdAt") VALUES ($1, $2, $3, 'author', NOW())`,
    [randomUUID(), skriptId, userId]
  )
  await client.query(
    `INSERT INTO collection_skripts (id, "collectionId", "skriptId", "order", "createdAt") VALUES ($1, $2, $3, 0, NOW())`,
    [randomUUID(), collectionId, skriptId]
  )

  const pageId = randomUUID()
  await client.query(
    `INSERT INTO pages (id, title, slug, content, "order", "isPublished", page_type, "skriptId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 0, true, 'normal', $5, NOW(), NOW())`,
    [pageId, TITLE, PAGE_SLUG, content, skriptId]
  )
  await client.query(
    `INSERT INTO page_authors (id, "pageId", "userId", permission, "createdAt") VALUES ($1, $2, $3, 'author', NOW())`,
    [randomUUID(), pageId, userId]
  )

  await client.query('COMMIT')
  console.log('seeded:', `http://localhost:3000/${siteSlug}/${SKRIPT_SLUG}/${PAGE_SLUG}`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error(e)
  process.exitCode = 1
} finally {
  await client.end()
}
