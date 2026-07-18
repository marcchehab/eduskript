#!/usr/bin/env node
// Seeds a page for testing <ai-feedback> on HANDWRITTEN MATH: two exercise
// sections, each with a tall blank area to draw a solution with the toolbar
// pen, followed by an <ai-feedback> tag. The button rasterizes the strokes in
// the enclosing H2 section to a PNG and sends it to OPENROUTER_VISION_MODEL.
// Chain: Collection -> Skript -> Page under the dev teacher's site.
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'

config()

const TEACHER_EMAIL = 'teacher@eduskript.org'
const SKRIPT_SLUG = 'ai-feedback-math'
const SKRIPT_TITLE = 'KI-Feedback: Mathematik'
const COLLECTION_TITLE = 'KI-Feedback Test'
const PAGE_SLUG = 'handschrift'
const PAGE_TITLE = 'KI-Feedback — handschriftliche Mathematik'

// Note: `style` is allowed on all elements by the sanitizer, so a fixed-height
// div gives blank vertical space to write in. The pen draws on #paper; strokes
// whose average y falls between this H2 and the next get captured.
const SPACE = '<div style="height:640px"></div>'

const content = `# KI-Feedback — handschriftliche Mathematik

Aktiviere den **Stift** in der Werkzeugleiste und schreibe deine Lösung von Hand
in den freien Bereich unter der jeweiligen Aufgabe. Klicke danach auf
**«KI-Feedback erhalten»** — deine Notizen dieses Abschnitts werden als Bild an
das Vision-Modell (${'`qwen/qwen3-vl-235b-a22b-instruct`'}) geschickt.

> [!tip] Alternative
> Du kannst auch einen Screenshot in das gestrichelte Feld einfügen (Ctrl+V).

## Aufgabe 1: Quadratische Gleichung

Löse die folgende quadratische Gleichung und zeige jeden Rechenschritt (z. B. mit
der Lösungsformel oder quadratischer Ergänzung):

$$x^2 - 5x + 6 = 0$$

${SPACE}

<ai-feedback prompt="Die Schülerin löst eine quadratische Gleichung von Hand. Transkribiere zuerst kurz, was du auf dem Bild liest, und prüfe dann den Rechenweg Schritt für Schritt. Weise konkret auf Fehler oder Auslassungen hin, aber verrate die finale Lösung nicht sofort — führe zur Selbstkorrektur. Antworte auf Deutsch (Schweizer Hochdeutsch, «ss» statt «ß»)." label="KI-Feedback erhalten" />

## Aufgabe 2: Ableitung

Bestimme die Ableitung der Funktion und notiere die Zwischenschritte:

$$f(x) = 3x^3 - 2x^2 + x - 5$$

${SPACE}

<ai-feedback prompt="Die Schülerin bildet eine Ableitung von Hand. Lies das Bild, prüfe jeden Term einzeln (Potenzregel), und benenne Fehler präzise, ohne die vollständige Lösung sofort vorzugeben. Antworte auf Deutsch (Schweizer Hochdeutsch, «ss» statt «ß»)." label="KI-Feedback erhalten" />
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

  // Idempotent: drop any prior skript with this slug owned by our user.
  const { rows: priorSkripts } = await client.query(
    `SELECT s.id FROM skripts s
     JOIN skript_authors sa ON sa."skriptId" = s.id AND sa."userId" = $1
     WHERE s.slug = $2`,
    [userId, SKRIPT_SLUG]
  )
  for (const s of priorSkripts) {
    await client.query('DELETE FROM skripts WHERE id = $1', [s.id])
  }

  const collectionId = randomUUID()
  await client.query(
    `INSERT INTO collections (id, title, site_id, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, NOW(), NOW())`,
    [collectionId, COLLECTION_TITLE, siteId]
  )

  const skriptId = randomUUID()
  await client.query(
    `INSERT INTO skripts (id, title, description, slug, skript_type, "isPublished", "isUnlisted", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'normal', true, false, NOW(), NOW())`,
    [skriptId, SKRIPT_TITLE, 'Test page for <ai-feedback> on handwritten math', SKRIPT_SLUG]
  )
  await client.query(
    `INSERT INTO skript_authors (id, "skriptId", "userId", permission, "createdAt")
     VALUES ($1, $2, $3, 'author', NOW())`,
    [randomUUID(), skriptId, userId]
  )

  await client.query(
    `INSERT INTO collection_skripts (id, "collectionId", "skriptId", "order", "createdAt")
     VALUES ($1, $2, $3, 0, NOW())`,
    [randomUUID(), collectionId, skriptId]
  )

  const pageId = randomUUID()
  await client.query(
    `INSERT INTO pages (id, title, slug, content, "order", "isPublished", page_type, "skriptId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 0, true, 'normal', $5, NOW(), NOW())`,
    [pageId, PAGE_TITLE, PAGE_SLUG, content, skriptId]
  )
  await client.query(
    `INSERT INTO page_authors (id, "pageId", "userId", permission, "createdAt")
     VALUES ($1, $2, $3, 'author', NOW())`,
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
