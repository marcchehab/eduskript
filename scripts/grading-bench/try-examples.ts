import { readFileSync } from 'fs'
import { config } from 'dotenv'
import OpenAI from 'openai'
import { buildRubricUserPrompt, buildScoreUserPrompt, parseAiScore, type RubricCriterion } from '@/lib/ai/scoring'
config({ path: '.env.local' }); config()
const src = readFileSync('src/lib/ai/scoring.ts', 'utf8')
const BASE_RUBRIC = src.match(/const RUBRIC_SYSTEM = `([\s\S]*?)`\n/)![1]
const SCORE = src.match(/const SCORE_SYSTEM = `([\s\S]*?)`\n/)![1]
const STEPS = `- VERTEILE DIE PUNKTE über die zentralen SCHRITTE/KONZEPTE der Aufgabe (z.B. bei einer Schleifenaufgabe: passende Schleife; richtige Bedingung/Operator; sammeln/akkumulieren; Ergebnis zurückgeben) — NICHT nur das fehlerfreie Endergebnis. So erhält ein Anfänger mit richtiger Struktur, aber einem Fehler faire Teilpunkte. Behalte GENAU EIN Kriterium für die Gesamt-Korrektheit, aber lass nie die ganze Punktzahl daran hängen. Diese Lernenden (Gymnasium/FMS) begannen bei null — keine Kriterien für Edge-Cases/Stil/Robustheit. Schreibe die Kriterien in DERSELBEN SPRACHE wie die Aufgabe.`
const STEPS_RUBRIC = BASE_RUBRIC.replace(/\n- Reply in the SAME LANGUAGE/, `\n${STEPS}\n- Reply in the SAME LANGUAGE`)

const o = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1', defaultHeaders: { 'HTTP-Referer': 'https://eduskript.org', 'X-Title': 'Eduskript' } })
const PROV = (process.env.OPENROUTER_PROVIDERS || '').split(',').map(s => s.trim()).filter(Boolean)
const R = PROV.length ? { provider: { order: PROV, allow_fallbacks: true } } : {}
const M = process.env.OPENROUTER_MODEL!
function xj(t: string): any { const c = t.trim().replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, ''); try { return JSON.parse(c) } catch {} const m = c.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null }
const call = async (s: string, u: string, mx: number, o2 = {}) => (await o.chat.completions.create({ model: M, max_tokens: mx, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: s }, { role: 'user', content: u }], ...o2, ...R } as any)).choices[0]?.message?.content ?? ''

const fx = JSON.parse(readFileSync('.bench-data/fixtures.json', 'utf8')) as any[]
const find = (frag: string) => fx.find(e => (e.checkCode || '').includes(frag + '(') || (e.label || '').includes(frag))

const CASES = [
  { name: 'gerade_zahlen (prod: 2.8/4)', ctx: find('gerade_zahlen'),
    code: `def gerade_zahlen(n):\n    ergebnis = [2, 4, 6, 8]\n    for n in range(n):\n        if n % 2 == 0:\n            ergebnis.append(n)\n    return ergebnis\n\nprint(gerade_zahlen(10))` },
  { name: 'summe_3_oder_5 (prod: 2.5/5)', ctx: find('summe_3_oder_5'),
    code: `summe = 0\ndef summe_3_oder_5(n):\n    for n in range(0, 11):\n        if n % 3 == 0 or n % 5 == 0:\n            return summe = summe + n\n\nprint(summe_3_oder_5(10)) # 3+5+6+9+10 = 33` },
]

for (const c of CASES) {
  if (!c.ctx) { console.log(c.name, '— exercise not found in fixtures'); continue }
  const rt = await call(STEPS_RUBRIC, buildRubricUserPrompt({ pageContext: c.ctx.exerciseContext, label: c.ctx.label, maxPoints: c.ctx.maxPoints, reference: c.ctx.checkCode, starterCode: c.ctx.starterCode, samples: [c.code] }), 8192)
  const arr = xj(rt)?.criteria ?? xj(rt)
  const rubric: RubricCriterion[] = (Array.isArray(arr) ? arr : []).map((x: any, i: number) => ({ id: `c${i + 1}`, description: String(x?.description ?? ''), points: Number(x?.points) })).filter((x: RubricCriterion) => x.description && Number.isFinite(x.points))
  const max = rubric.reduce((s, x) => s + x.points, 0)
  const p: any = parseAiScore(await call(SCORE, buildScoreUserPrompt({ pageContext: c.ctx.exerciseContext, label: c.ctx.label, criteria: rubric, submission: c.code }), 3072, { temperature: 0, seed: 7 }), rubric)
  console.log(`\n=================== ${c.name} ===================`)
  console.log(`matched exercise: ${c.ctx.label} (maxPoints ${c.ctx.maxPoints})`)
  console.log(`STEPS rubric (Σ${max}):`); rubric.forEach(x => console.log(`  (${x.points}) ${x.description.slice(0, 86)}`))
  console.log(`\n→ STEPS score: ${p.earned}/${max}`)
  for (const cr of p.criteria) console.log(`   ${cr.id}=${cr.points}  ${(cr.comment || '').slice(0, 90)}`)
  console.log(`   feedback: ${(p.feedback || '').slice(0, 220)}`)
}
