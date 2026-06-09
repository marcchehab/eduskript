/**
 * Build the grading test-bench fixture from a RESTORED prod backup DB.
 *
 * Reads (SELECT-only) the eduskript_proddata database, parses each page's
 * python-check coding exercises with the REAL parser, pulls students' handin
 * code, and writes a diverse sample of (exercise × submission) examples to
 * .bench-data/fixtures.json (git-ignored; student ids are hashed).
 *
 * Run: PROD_DB_URL=postgresql://…/eduskript_proddata npx tsx scripts/grading-bench/extract-fixtures.ts
 */
import { writeFileSync, mkdirSync } from 'fs'
import { createHash } from 'crypto'
import pg from 'pg'
import { parseGradableComponents } from '@/lib/scoring/components'

const PER_EXERCISE = 6 // distinct submissions kept per exercise (spread of quality)
const MAX_TOTAL = 160
const MAX_CONTEXT = 9000 // chars of page content used as exercise context (prod passes full content)

const anon = (id: string) => 's_' + createHash('sha1').update(id).digest('hex').slice(0, 8)

function codeText(payload: unknown): string {
  const p = payload as { files?: { name?: string; content?: string }[] } | null
  const files = Array.isArray(p?.files) ? p!.files : []
  const nonEmpty = files.filter((f) => (f.content ?? '').trim() !== '')
  const use = nonEmpty.length ? nonEmpty : files
  if (use.length === 0) return ''
  if (use.length === 1) return use[0].content ?? ''
  return use.map((f) => `# ${f.name ?? 'file.py'}\n${f.content ?? ''}`).join('\n\n')
}

interface Example {
  exId: string
  pageSlug: string
  label: string
  maxPoints: number
  exerciseContext: string
  starterCode: string | null
  checkCode: string | null
  studentKey: string
  code: string
}

const url = process.env.PROD_DB_URL
if (!url) throw new Error('set PROD_DB_URL to the restored proddata DB')
const client = new pg.Client({ connectionString: url })
await client.connect()

const { rows: pages } = await client.query<{ id: string; slug: string; content: string }>(
  `select id, slug, content from pages where content like '%python-check%'`,
)

const examples: Example[] = []
let exercises = 0
for (const page of pages) {
  const comps = parseGradableComponents(page.content).filter((c) => c.kind === 'python' && c.checkCode?.trim())
  for (const c of comps) {
    const editorId = 'code-editor-' + c.componentId.replace(/^python-check-/, '')
    const { rows: subs } = await client.query<{ user_id: string; payload: unknown }>(
      `select user_id, payload from user_data_checkpoints where component_id = $1 and kind = 'handin'`,
      [editorId],
    )
    // A stub/abandoned submission = essentially just the starter (def … : pass + print),
    // no real logic. Those correctly score 0 but are useless for testing harshness on
    // genuine work — so prefer SUBSTANTIVE attempts, keeping at most one stub per exercise.
    const norm = (s: string) => s.replace(/#.*$/gm, '').replace(/\s+/g, ' ').trim()
    const isStub = (code: string) => {
      if (c.starterCode && norm(code) === norm(c.starterCode)) return true
      const body = norm(code).replace(/def\s+\w+\s*\([^)]*\)\s*:/, '').replace(/print\s*\([^)]*\)/g, '')
      return !/(=|return|for |while |if |elif|\.append|range|%|\+|\bsum\b)/.test(body)
    }
    const seen = new Set<string>()
    const subst: { user_id: string; code: string }[] = []
    const stubs: { user_id: string; code: string }[] = []
    for (const s of subs) {
      const code = codeText(s.payload)
      const key = code.trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      ;(isStub(code) ? stubs : subst).push({ user_id: s.user_id, code })
    }
    const picked = [...subst.slice(0, PER_EXERCISE), ...stubs.slice(0, 1)].slice(0, PER_EXERCISE)
    if (subst.length === 0) continue // skip exercises nobody really attempted
    exercises++
    for (const p of picked) {
      examples.push({
        exId: `${page.slug}::${c.componentId}`,
        pageSlug: page.slug,
        label: c.label ?? c.componentId,
        maxPoints: c.maxPoints ?? 1,
        exerciseContext: page.content.length > MAX_CONTEXT ? page.content.slice(0, MAX_CONTEXT) : page.content,
        starterCode: c.starterCode ?? null,
        checkCode: c.checkCode ?? null,
        studentKey: anon(p.user_id),
        code: p.code,
      })
    }
  }
}
await client.end()

// Trim to MAX_TOTAL while keeping exercise diversity (round-robin by exId).
const byEx = new Map<string, Example[]>()
for (const e of examples) (byEx.get(e.exId) ?? byEx.set(e.exId, []).get(e.exId)!).push(e)
const order = [...byEx.values()]
const trimmed: Example[] = []
let i = 0
while (trimmed.length < MAX_TOTAL && order.some((g) => g.length > i)) {
  for (const g of order) if (g[i]) { trimmed.push(g[i]); if (trimmed.length >= MAX_TOTAL) break }
  i++
}

mkdirSync('.bench-data', { recursive: true })
writeFileSync('.bench-data/fixtures.json', JSON.stringify(trimmed, null, 2))
console.log(`exercises with submissions: ${exercises}`)
console.log(`distinct (exercise×submission) examples: ${examples.length}  → kept ${trimmed.length}`)
console.log(`distinct exercises in fixture: ${new Set(trimmed.map((e) => e.exId)).size}`)
console.log(`maxPoints spread: ${[...new Set(trimmed.map((e) => e.maxPoints))].sort((a, b) => a - b).join(', ')}`)
