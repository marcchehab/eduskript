#!/usr/bin/env node
// One-off: seed a "ping-demo" skript + page for the teacher site so the
// <ping> widget can be tried live at /teacher/ping-demo/ping. Idempotent.
import pg from 'pg'
import { config } from 'dotenv'

config()

const TEACHER_ID = 'cmplmuvl50000jwc7u17iv3m0'
const SKRIPT_ID = 'seed-ping-demo-skript'
const PAGE_ID = 'seed-ping-demo-page'
const AUTHOR_ID = 'seed-ping-demo-author'

const content = `# Ping demo

Type the ping command yourself — works even where school wifi blocks ICMP,
because the measurement runs from the server. Use the button (top-right) to
switch Linux / macOS / Windows output. Up/down arrows recall past commands.

## Try it

Type \`ping wairualodge.co.nz\` (New Zealand — expect ~300 ms), or
\`ping -c 6 8.8.8.8\`. Login required.

<ping />

## With a demo pre-run

This one auto-runs once, then you can keep typing:

<ping host="wairualodge.co.nz" count="4" os="windows" />
`

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
try {
  await client.query(
    `INSERT INTO skripts (id, title, slug, "isPublished", skript_type, "createdAt", "updatedAt", "isUnlisted")
     VALUES ($1,'Ping demo','ping-demo',true,'normal',NOW(),NOW(),false)
     ON CONFLICT (id) DO UPDATE SET "isPublished"=true`,
    [SKRIPT_ID],
  )
  await client.query(
    `INSERT INTO skript_authors (id, "skriptId", "userId", permission, "createdAt")
     VALUES ($1,$2,$3,'author',NOW())
     ON CONFLICT (id) DO NOTHING`,
    [AUTHOR_ID, SKRIPT_ID, TEACHER_ID],
  )
  await client.query(
    `INSERT INTO pages (id, title, slug, content, "order", "isPublished", page_type, "createdAt", "updatedAt", "skriptId", "isUnlisted", presentation_public)
     VALUES ($1,'Ping','ping',$2,0,true,'normal',NOW(),NOW(),$3,false,false)
     ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content, "isPublished"=true`,
    [PAGE_ID, content, SKRIPT_ID],
  )
  console.log('Seeded. URL: /teacher/ping-demo/ping')
} finally {
  await client.end()
}
