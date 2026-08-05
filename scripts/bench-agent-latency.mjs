#!/usr/bin/env node
/**
 * Latency bench for the AI Edit agent route (src/app/api/ai/edit/agent/route.ts).
 *
 * Replicates that route's real request 1:1: same system prompt (built from a
 * real skript pulled out of the dev DB), same TOOLS, same max_tokens, same
 * tool_choice, same provider routing. Measures wall-clock of the NON-streaming
 * call, because the route itself is non-streaming — the user waits for the
 * whole completion, not the first token. TTFT is measured separately via a
 * streaming call for reference only.
 *
 * Two scenarios, mirroring the route's two branches:
 *   question — latest message is a question; correct behaviour is prose, 0 tools
 *   edit     — latest message asks for changes; correct behaviour is >=1 tool call
 *
 * Correctness matters as much as speed here: a fast model that calls a tool on
 * a question, or invents a pageId, is worse than a slow correct one.
 */
import 'dotenv/config'
import OpenAI from 'openai'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const SKRIPT_ID = process.argv[2] ?? 'de4d3e51-4dc2-415b-870d-fba411e4200c'
const TRIALS = parseInt(process.env.TRIALS ?? '5', 10)
const MODELS = ['google/gemini-3.5-flash-lite', 'deepseek/deepseek-v4-flash']

// Copied verbatim from the agent route.
const TOOLS = [
  { type: 'function', function: { name: 'edit_page', description: 'Propose an edit to an EXISTING page in this skript. Use the exact pageId from the context.', parameters: { type: 'object', properties: { pageId: { type: 'string', description: 'Exact ID of the page to edit, as shown in the context.' }, note: { type: 'string', description: 'A short first-person lead-in shown just before this edit card, e.g. "Now tightening the intro." Keep it to one sentence.' }, summary: { type: 'string', description: 'Precise description of the change; this is used to generate the new page content.' } }, required: ['pageId', 'summary'] } } },
  { type: 'function', function: { name: 'create_page', description: 'Propose creating a NEW page in this skript.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Title of the new page.' }, slug: { type: 'string', description: 'URL slug, lowercase and hyphenated.' }, note: { type: 'string', description: 'A short first-person lead-in shown just before this edit card. One sentence.' }, summary: { type: 'string', description: 'What the new page should contain; used to generate its content.' } }, required: ['title', 'slug', 'summary'] } } },
]

function buildSystemPrompt(ctx, orgPrompt, focusedPageId) {
  const pageLines = ctx.pages.map(p => `- ID: ${p.id} | "${p.title}" (slug: ${p.slug})${p.id === focusedPageId ? ' [currently open]' : ''}`).join('\n')
  const focused = focusedPageId ? ctx.pages.find(p => p.id === focusedPageId) : undefined
  return `You are an AI co-author helping a teacher with their Eduskript skript. You can BOTH:
1. Discuss the skript — answer questions, give feedback, suggest ideas — in plain prose.
2. Make changes — when the teacher wants edits, call the edit_page / create_page tools.

Guidelines:
- Act ONLY on the teacher's LATEST message. Earlier messages are context, not a to-do list — never repeat or re-run edits already mentioned earlier in the conversation.
- If the latest message is a QUESTION or discussion (e.g. "which pages do you see?", "what do you think of this?"), answer it in prose with NO tool calls at all. Calling a tool when the teacher only asked a question is wrong.
- Call edit_page / create_page ONLY when the latest message explicitly asks to change, add, or remove content.
- LANGUAGE: write EVERYTHING the teacher reads — your message content AND every \`note\` — in the same language the teacher is writing in (and that the skript content / site guidelines use). Never switch to English for the notes while chatting in another language; keep one consistent language across the whole reply.
- For each tool call, write a short natural lead-in in \`note\` ("Now I'll tighten the intro." — but in the conversation's language). These are shown in order with the edit cards, so your message + notes should read as one flowing explanation.
- Use the EXACT pageId from the context for edit_page. Do not invent IDs.
- You may call multiple tools in one turn (e.g. edit two pages).
${orgPrompt ? `\n${orgPrompt}\n` : ''}
## Skript: "${ctx.skript.title}"${ctx.skript.description ? ` — ${ctx.skript.description}` : ''}
Pages (in order):
${pageLines || '(no pages yet)'}
${focused ? `\n## Currently open page "${focused.title}" content:\n${focused.content}` : ''}`
}

function openrouterProviderRouting() {
  const raw = process.env.OPENROUTER_PROVIDERS
  if (!raw) return {}
  const providers = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (providers.length === 0) return {}
  return { provider: { order: providers, allow_fallbacks: true } }
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const skript = await prisma.skript.findUnique({
  where: { id: SKRIPT_ID },
  include: { pages: { orderBy: { order: 'asc' } } },
})
if (!skript) { console.error('skript not found'); process.exit(1) }
await prisma.$disconnect()

const ctx = {
  skript: { id: skript.id, title: skript.title, description: skript.description, slug: skript.slug, isPublished: skript.isPublished },
  pages: skript.pages.map(p => ({ id: p.id, title: p.title, slug: p.slug, content: p.content, order: p.order, isPublished: p.isPublished })),
}
const focusedPageId = ctx.pages[0].id
const systemPrompt = buildSystemPrompt(ctx, undefined, focusedPageId)

const SCENARIOS = [
  { name: 'question', expectTools: false, messages: [{ role: 'user', content: 'Welche Seiten siehst du in diesem Skript, und wie ist der Aufbau aus didaktischer Sicht?' }] },
  { name: 'edit', expectTools: true, messages: [{ role: 'user', content: 'Bitte kürze die Einleitung der offenen Seite und füge am Ende eine neue Seite mit Übungsaufgaben hinzu.' }] },
]

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: { 'HTTP-Referer': 'https://eduskript.org', 'X-Title': 'Eduskript' },
})

const validIds = new Set(ctx.pages.map(p => p.id))

async function once(model, scenario, stream) {
  const body = {
    model,
    max_tokens: 2048,
    messages: [{ role: 'system', content: systemPrompt }, ...scenario.messages],
    tools: TOOLS,
    tool_choice: 'auto',
    ...openrouterProviderRouting(),
  }
  const t0 = performance.now()
  if (!stream) {
    const c = await openai.chat.completions.create(body)
    const total = performance.now() - t0
    const msg = c.choices[0]?.message
    const calls = (msg?.tool_calls ?? []).filter(tc => tc.type === 'function')
    const badId = calls.some(tc => {
      if (tc.function.name !== 'edit_page') return false
      try { return !validIds.has(JSON.parse(tc.function.arguments || '{}').pageId) } catch { return true }
    })
    return { total, ttft: null, nTools: calls.length, badId, provider: c.provider, tokens: c.usage?.completion_tokens }
  }
  const s = await openai.chat.completions.create({ ...body, stream: true })
  let ttft = null
  for await (const chunk of s) {
    const d = chunk.choices[0]?.delta
    if (ttft === null && (d?.content || d?.tool_calls)) ttft = performance.now() - t0
  }
  return { total: performance.now() - t0, ttft, nTools: 0, badId: false }
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] }
const fmt = ms => (ms / 1000).toFixed(2) + 's'

console.log(`skript "${skript.title}" — ${ctx.pages.length} pages, system prompt ${systemPrompt.length} chars`)
console.log(`providers: ${process.env.OPENROUTER_PROVIDERS || '(unpinned, prod default)'} | ${TRIALS} trials\n`)

for (const scenario of SCENARIOS) {
  console.log(`## scenario: ${scenario.name} (expect ${scenario.expectTools ? '>=1' : '0'} tool calls)`)
  for (const model of MODELS) {
    const runs = []
    let errs = 0
    for (let i = 0; i < TRIALS; i++) {
      try { runs.push(await once(model, scenario, false)) } catch (e) { errs++; console.log(`   err: ${e.message.slice(0, 90)}`) }
    }
    if (!runs.length) { console.log(`  ${model.padEnd(30)} ALL FAILED`); continue }
    const totals = runs.map(r => r.total)
    const ok = runs.filter(r => (scenario.expectTools ? r.nTools > 0 : r.nTools === 0) && !r.badId).length
    let ttft = null
    try { ttft = (await once(model, scenario, true)).ttft } catch {}
    console.log(
      `  ${model.padEnd(30)} median ${fmt(pct(totals, 0.5)).padStart(6)}  p90 ${fmt(pct(totals, 0.9)).padStart(6)}  min ${fmt(Math.min(...totals)).padStart(6)}  max ${fmt(Math.max(...totals)).padStart(6)}` +
      `  | ttft(stream) ${ttft ? fmt(ttft) : 'n/a'}` +
      `  | correct ${ok}/${runs.length}${errs ? ` errs ${errs}` : ''}` +
      `  | out~${Math.round(runs.reduce((s, r) => s + (r.tokens ?? 0), 0) / runs.length)}tok  via ${runs[0].provider ?? '?'}`
    )
  }
  console.log()
}
