/**
 * Grading prompt test-bench. Evaluates system-prompt variants for rubric
 * generation and/or scoring over the real-submission fixture, on three axes:
 *  - leniency: mean awarded fraction (earned/max) — current grading is "too harsh"
 *  - tone: deterministic flags for condescending/harsh phrasing
 *  - fairness: an LLM judge rating fairness + tone for Gymnasium/FMS level
 *
 * Rubrics are generated once per (exercise × rubric-variant) and cached on disk.
 * Reuses the REAL user-prompt builders + parser; only the SYSTEM prompt is swapped.
 *
 * Run:  npx tsx scripts/grading-bench/bench.ts <runId> [limit]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { config } from 'dotenv'
import OpenAI from 'openai'
import { buildRubricUserPrompt, buildScoreUserPrompt, parseAiScore, type RubricCriterion } from '@/lib/ai/scoring'
import { RUBRIC_VARIANTS, SCORE_VARIANTS, JUDGE_SYSTEM, type Variant } from './variants'

config({ path: '.env.local' }); config()

const o = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1', defaultHeaders: { 'HTTP-Referer': 'https://eduskript.org', 'X-Title': 'Eduskript' } })
const PROVIDERS = (process.env.OPENROUTER_PROVIDERS || '').split(',').map((s) => s.trim()).filter(Boolean)
const ROUTING = PROVIDERS.length ? { provider: { order: PROVIDERS, allow_fallbacks: true } } : {}
const MODEL = process.env.OPENROUTER_MODEL!

interface Example { exId: string; pageSlug: string; label: string; maxPoints: number; exerciseContext: string; starterCode: string | null; checkCode: string | null; studentKey: string; code: string }

function extractJson(text: string): any {
  const c = text.trim().replace(/^```[a-z0-9]*\s*/i, '').replace(/\s*```$/i, '').trim()
  const tp = (s: string) => { try { return JSON.parse(s) } catch { return undefined } }
  let v = tp(c)
  if (v === undefined) { const m = c.match(/\{[\s\S]*\}/); if (m) v = tp(m[0]) }
  if (v === undefined) { const m = c.match(/\[[\s\S]*\]/); if (m) v = tp(m[0]) }
  return v ?? null
}
async function complete(system: string, user: string, maxTokens: number, opts: Record<string, unknown> = {}): Promise<string> {
  const r = await o.chat.completions.create({ model: MODEL, max_tokens: maxTokens, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], ...opts, ...ROUTING } as any)
  return r.choices[0]?.message?.content ?? ''
}
async function pool<T, R>(items: T[], n: number, fn: (it: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let idx = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i) }
  }))
  return out
}

const SCORING_SEED = 7
const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12)

// ---- rubric generation (cached per exercise × rubric-variant) ----
async function getRubric(ex: Example, samples: string[], rv: Variant): Promise<RubricCriterion[]> {
  const cacheKey = `${ex.exId}__${rv.id}__${hash(rv.system)}`
  const path = `.bench-data/rubrics/${cacheKey.replace(/[^\w.-]/g, '_')}.json`
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'))
  const user = buildRubricUserPrompt({ pageContext: ex.exerciseContext, label: ex.label, maxPoints: ex.maxPoints, reference: ex.checkCode, starterCode: ex.starterCode, samples })
  const text = await complete(rv.system, user, 8192)
  const raw = extractJson(text)
  const arr = Array.isArray(raw) ? raw : raw?.criteria
  const criteria: RubricCriterion[] = (Array.isArray(arr) ? arr : [])
    .map((c: any, i: number) => ({ id: `c${i + 1}`, description: String(c?.description ?? ''), points: Number(c?.points) }))
    .filter((c: RubricCriterion) => c.description && Number.isFinite(c.points))
  mkdirSync('.bench-data/rubrics', { recursive: true })
  writeFileSync(path, JSON.stringify(criteria))
  return criteria
}

// ---- tone flags (deterministic) ----
const CONCESSIVE = /\b(immerhin|wenigstens|zumindest|at least|at any rate)\b/i
const HARSH = /\b(falsch|fehlerhaft|ungültig|ungenügend|völlig|komplett falsch|wrong|incorrect|fails?|useless)\b/gi
function toneFlags(text: string) {
  return { concessive: CONCESSIVE.test(text), harshHits: (text.match(HARSH) || []).length }
}

// ---- fairness judge ----
async function judge(ex: Example, code: string, earned: number, max: number, feedback: string): Promise<{ fairness: number; tone: number; verdict: string }> {
  const user = `## Aufgabe\n${ex.label}\n${(ex.exerciseContext || '').slice(0, 1500)}\n## Lösung des Schülers\n${code}\n## KI-Bewertung\nPunkte: ${earned} / ${max}\nFeedback: ${feedback}\n\nBewerte Fairness + Ton.`
  try {
    const t = await complete(JUDGE_SYSTEM, user, 700, { temperature: 0, seed: 11 })
    const j = extractJson(t) || {}
    return { fairness: Number(j.fairness) || 0, tone: Number(j.tone) || 0, verdict: String(j.verdict || '?') }
  } catch { return { fairness: 0, tone: 0, verdict: 'err' } }
}

async function main() {
  const runId = process.argv[2] || 'baseline'
  const limit = Number(process.argv[3] || 0)
  let examples: Example[] = JSON.parse(readFileSync('.bench-data/fixtures.json', 'utf8'))
  if (limit) examples = examples.slice(0, limit)

  // a run = a (rubricVariant, scoreVariant) pair, by id
  const [rvId, svId] = runId.split('+')
  const rv = RUBRIC_VARIANTS.find((v) => v.id === rvId) ?? RUBRIC_VARIANTS[0]
  const sv = SCORE_VARIANTS.find((v) => v.id === (svId ?? rvId)) ?? SCORE_VARIANTS[0]
  console.log(`RUN ${runId}  rubric=${rv.id}  score=${sv.id}  · ${examples.length} examples`)

  // samples per exercise (for rubric calibration) = first 3 distinct codes of that exercise
  const byEx = new Map<string, Example[]>()
  for (const e of examples) (byEx.get(e.exId) ?? byEx.set(e.exId, []).get(e.exId)!).push(e)
  const samplesByEx = new Map([...byEx].map(([k, v]) => [k, v.slice(0, 3).map((e) => e.code)]))

  const results = await pool(examples, 8, async (ex) => {
    const rubric = await getRubric(ex, samplesByEx.get(ex.exId) || [ex.code], rv)
    if (!rubric.length) return null
    const user = buildScoreUserPrompt({ pageContext: ex.exerciseContext, label: ex.label, criteria: rubric, submission: ex.code })
    let parsed
    try { parsed = parseAiScore(await complete(sv.system, user, 3072, { temperature: 0, seed: SCORING_SEED }), rubric) } catch { return null }
    if ('error' in parsed) return null
    const max = rubric.reduce((s, c) => s + c.points, 0)
    const fb = parsed.feedback || ''
    const t = toneFlags(fb + ' ' + parsed.criteria.map((c) => c.comment).join(' '))
    const jr = await judge(ex, ex.code, parsed.earned, max, fb)
    return { exId: ex.exId, studentKey: ex.studentKey, earned: parsed.earned, max, frac: max ? parsed.earned / max : 0, ...t, ...jr, feedback: fb }
  })

  const ok = results.filter(Boolean) as NonNullable<(typeof results)[number]>[]
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
  const summary = {
    runId, n: ok.length,
    meanFrac: +mean(ok.map((r) => r.frac)).toFixed(3),
    meanEarnedPct: +(mean(ok.map((r) => r.frac)) * 100).toFixed(1),
    concessivePct: +(100 * ok.filter((r) => r.concessive).length / (ok.length || 1)).toFixed(1),
    meanHarshHits: +mean(ok.map((r) => r.harshHits)).toFixed(2),
    judgeFairness: +mean(ok.map((r) => r.fairness)).toFixed(2),
    judgeTone: +mean(ok.map((r) => r.tone)).toFixed(2),
    verdicts: ok.reduce((m, r) => ((m[r.verdict] = (m[r.verdict] || 0) + 1), m), {} as Record<string, number>),
  }
  mkdirSync('.bench-data/results', { recursive: true })
  writeFileSync(`.bench-data/results/${runId.replace(/[^\w.+-]/g, '_')}.json`, JSON.stringify({ summary, results: ok }, null, 2))
  console.log(JSON.stringify(summary, null, 2))
}
main()
