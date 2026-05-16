#!/usr/bin/env node
/**
 * Seeds a survey test page under teacher@eduskript.org's Markdown Basics
 * skript so the TeacherPageToolbar's anonymous-respondent flow can be
 * exercised end-to-end.
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { config } from 'dotenv'

config()

const isLocal = process.env.DATABASE_URL?.includes('localhost')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/eduskript_dev',
  ssl: isLocal ? false : { rejectUnauthorized: false },
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const SKRIPT_ID = 'cmmbrf9b8001ptac95pxcxf0a' // Markdown Basics
const TEACHER_ID = 'cmmbrf9a4001ktac9l0bz16hn' // teacher@eduskript.org

// Prompts are plain text: the markdown pipeline does NOT re-parse content
// inside <question>/<answer> blocks (rehypeMarkdownChildren is limited to
// stickme/tab-item). Bold/italic markup inside a prompt would render as
// literal asterisks.
const content = `# Teaching Feedback Survey

Help us improve! Your responses are anonymous.

<survey>

<question id="overall" type="number" minValue="1" maxValue="10" step="1" minLabel="awful" maxLabel="excellent">
Overall, how would you rate this skript?
</question>

<question id="favourite" type="single">
Which part did you enjoy most?
<answer>Headings & text</answer>
<answer>Tables & links</answer>
<answer>Code blocks</answer>
<answer>Lists & blockquotes</answer>
</question>

<question id="topics" type="multiple">
Which topics would you like to see covered next? (pick any)
<answer>Math notation (LaTeX)</answer>
<answer>Diagrams (mermaid)</answer>
<answer>Embedded videos</answer>
<answer>Interactive quizzes</answer>
<answer>Python exercises</answer>
</question>

<question id="comment" type="text">
Anything else you'd like to share?
</question>

</survey>

Thank you for your feedback!
`

const page = await prisma.page.upsert({
  where: { skriptId_slug: { skriptId: SKRIPT_ID, slug: 'feedback-survey' } },
  update: { content, title: 'Teaching Feedback Survey', isPublished: true },
  create: {
    skriptId: SKRIPT_ID,
    slug: 'feedback-survey',
    title: 'Teaching Feedback Survey',
    content,
    isPublished: true,
    order: 99,
    pageType: 'standard',
  },
})

await prisma.pageAuthor.upsert({
  where: { pageId_userId: { pageId: page.id, userId: TEACHER_ID } },
  update: {},
  create: { pageId: page.id, userId: TEACHER_ID, permission: 'author' },
})

console.log('Page ready:', { id: page.id, slug: page.slug, title: page.title })
await prisma.$disconnect()
