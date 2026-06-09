/** Validate the final 'steps' rubric addendum: German preserved + fair step-spread
 *  scoring on a correct / partial / broken submission of one real exercise. */
import { readFileSync } from 'fs'
import { config } from 'dotenv'
import OpenAI from 'openai'
import { buildRubricUserPrompt, buildScoreUserPrompt, parseAiScore, type RubricCriterion } from '@/lib/ai/scoring'
config({ path: '.env.local' }); config()
const src = readFileSync('src/lib/ai/scoring.ts', 'utf8')
const BASE_RUBRIC = src.match(/const RUBRIC_SYSTEM = `([\s\S]*?)`\n/)![1]
const SCORE = src.match(/const SCORE_SYSTEM = `([\s\S]*?)`\n/)![1]

// FINAL steps addendum — language-preserving, beginner-level, point-spread.
const STEPS_FINAL = `- VERTEILE DIE PUNKTE über die zentralen SCHRITTE/KONZEPTE der Aufgabe (z.B. bei einer
  Schleifenaufgabe: eine passende Schleife verwenden; die richtige Bedingung/den richtigen Operator;
  sammeln/akkumulieren; das Ergebnis zurückgeben/ausgeben) — NICHT nur das fehlerfreie Endergebnis.
  So erhält ein Anfänger, der die richtige Struktur zeigt, aber einen Fehler hat, faire Teilpunkte für
  das, was er nachweislich gelernt hat. Behalte GENAU EIN Kriterium für die Gesamt-Korrektheit, aber
  lass nie die ganze Punktzahl daran hängen. Diese Lernenden (Gymnasium/FMS) haben bei null begonnen —
  keine Kriterien für Edge-Cases, Stil oder Robustheit, die ein Anfänger nicht leisten muss.
  WICHTIG: Schreibe die Kriterien in DERSELBEN SPRACHE wie die Aufgabe (hier i.d.R. Deutsch).`
const FINAL_RUBRIC = BASE_RUBRIC.replace(/\n- Reply in the SAME LANGUAGE/, `\n${STEPS_FINAL}\n- Reply in the SAME LANGUAGE`)

const o = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1', defaultHeaders: { 'HTTP-Referer': 'https://eduskript.org', 'X-Title': 'Eduskript' } })
const PROV = (process.env.OPENROUTER_PROVIDERS || '').split(',').map(s => s.trim()).filter(Boolean)
const R = PROV.length ? { provider: { order: PROV, allow_fallbacks: true } } : {}
const M = process.env.OPENROUTER_MODEL!
function xj(t: string): any { const c = t.trim().replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, ''); try { return JSON.parse(c) } catch {} const m = c.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null }
const call = async (s: string, u: string, mx: number, o2 = {}) => (await o.chat.completions.create({ model: M, max_tokens: mx, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: s }, { role: 'user', content: u }], ...o2, ...R } as any)).choices[0]?.message?.content ?? ''

const fx = JSON.parse(readFileSync('.bench-data/fixtures.json', 'utf8')) as any[]
const a11 = fx.filter(e => e.exId.includes('a11'))
const ctx = a11[0]
async function genRubric(sys: string): Promise<RubricCriterion[]> {
  const t = await call(sys, buildRubricUserPrompt({ pageContext: ctx.exerciseContext, label: ctx.label, maxPoints: ctx.maxPoints, reference: ctx.checkCode, starterCode: ctx.starterCode, samples: a11.slice(0, 3).map(e => e.code) }), 8192)
  const arr = xj(t)?.criteria ?? xj(t)
  return (Array.isArray(arr) ? arr : []).map((c: any, i: number) => ({ id: `c${i + 1}`, description: String(c?.description ?? ''), points: Number(c?.points) })).filter((c: RubricCriterion) => c.description && Number.isFinite(c.points))
}
const score = async (rub: RubricCriterion[], code: string) => { const p = parseAiScore(await call(SCORE, buildScoreUserPrompt({ pageContext: ctx.exerciseContext, label: ctx.label, criteria: rub, submission: code }), 3072, { temperature: 0, seed: 7 }), rub); return 'error' in p ? null : p }

const finalRub = await genRubric(FINAL_RUBRIC)
console.log('FINAL rubric (lang check):'); finalRub.forEach(c => console.log(`  (${c.points}) ${c.description.slice(0, 80)}`))
console.log('German?', /verwende|Schleife|gibt|zurück|richtig|Zahl/i.test(finalRub.map(c => c.description).join(' ')))
console.log('\nScores under FINAL steps rubric:')
for (const e of a11.slice(0, 4)) {
  const s = await score(finalRub, e.code)
  console.log(`  ${e.studentKey}: ${s?.earned}/${finalRub.reduce((x, c) => x + c.points, 0)}  | ${e.code.replace(/\s+/g, ' ').slice(0, 70)}`)
}
