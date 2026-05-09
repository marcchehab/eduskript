#!/usr/bin/env node
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

config()

const SLUG = 'flex-sections'
const TITLE = 'Flex sections — annotation test'
const TEACHER_EMAIL = 'teacher@eduskript.org'

const content = readFileSync(new URL('./flex-sections-page.md', import.meta.url), 'utf8')

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

try {
  await client.query('BEGIN')

  const { rows: userRows } = await client.query(
    'SELECT id, "pageSlug" FROM users WHERE email = $1',
    [TEACHER_EMAIL]
  )
  if (userRows.length === 0) throw new Error(`User ${TEACHER_EMAIL} not found`)
  const userId = userRows[0].id
  const pageSlug = userRows[0].pageSlug

  await client.query(
    `DELETE FROM pages WHERE slug = $1 AND "skriptId" IN (
       SELECT id FROM skripts WHERE slug = $1
     )`,
    [SLUG]
  )
  await client.query('DELETE FROM skripts WHERE slug = $1', [SLUG])
  await client.query('DELETE FROM collections WHERE slug = $1', [SLUG])

  const collectionId = randomUUID()
  await client.query(
    `INSERT INTO collections (id, title, slug, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, NOW(), NOW())`,
    [collectionId, TITLE, SLUG]
  )
  await client.query(
    `INSERT INTO collection_authors (id, "collectionId", "userId", permission, "createdAt")
     VALUES ($1, $2, $3, 'author', NOW())`,
    [randomUUID(), collectionId, userId]
  )

  const skriptId = randomUUID()
  await client.query(
    `INSERT INTO skripts (id, title, slug, "isPublished", skript_type, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, 'normal', NOW(), NOW())`,
    [skriptId, TITLE, SLUG]
  )
  await client.query(
    `INSERT INTO skript_authors (id, "skriptId", "userId", permission, "createdAt")
     VALUES ($1, $2, $3, 'author', NOW())`,
    [randomUUID(), skriptId, userId]
  )
  await client.query(
    `INSERT INTO collection_skripts (id, "collectionId", "skriptId", "userId", "order", "createdAt")
     VALUES ($1, $2, $3, $4, 0, NOW())`,
    [randomUUID(), collectionId, skriptId, userId]
  )

  const pageId = randomUUID()
  await client.query(
    `INSERT INTO pages (id, title, slug, content, "order", "isPublished", page_type, "skriptId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 0, true, 'normal', $5, NOW(), NOW())`,
    [pageId, TITLE, SLUG, content, skriptId]
  )
  await client.query(
    `INSERT INTO page_authors (id, "pageId", "userId", permission, "createdAt")
     VALUES ($1, $2, $3, 'author', NOW())`,
    [randomUUID(), pageId, userId]
  )

  await client.query('COMMIT')

  const url = `http://localhost:3000/${pageSlug}/${SLUG}/${SLUG}/${SLUG}`
  console.log('seeded:', url)
} catch (e) {
  await client.query('ROLLBACK')
  console.error(e)
  process.exitCode = 1
} finally {
  await client.end()
}
