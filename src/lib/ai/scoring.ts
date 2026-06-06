/**
 * AI scoring: shared LLM plumbing + prompt builders for the two-step feature.
 *  1. generate a scoring rubric (criteria + points) for one exercise, from the
 *     question + reference + a sample of student submissions.
 *  2. score one student's submission against a fixed rubric → points + feedback.
 *
 * Reuses the OpenRouter setup from the AI-edit route (OPENROUTER_API_KEY /
 * OPENROUTER_MODEL / OPENROUTER_PROVIDERS). The AI only ever emits POINTS
 * (Punkte) + feedback — never a grade. Output is strict JSON, parsed with
 * parseJsonResponse.
 *
 * Related: [[scoring/submissions]], [[scoring/score-component]].
 */

import OpenAI from 'openai'
import { openrouterProviderRouting } from './openrouter'
import { extractCriterionRegex, runCriterionCheck, stripInlineRegex } from '@/lib/scoring/regex-check'

/**
 * Tolerant JSON extraction for model output. Reasoning models (e.g. minimax)
 * return the answer in `message.content` but its SHAPE is inconsistent — a bare
 * array `[...]`, an object `{...}`, sometimes wrapped in a ```json fence or with
 * stray prose. Strip a fence, try a whole-string parse, else grab the first
 * balanced [...] or {...}. Returns the parsed value or null.
 */
function extractJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```[a-z0-9]*\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s)
    } catch {
      return undefined
    }
  }
  // Whole-string parse first (covers a clean object OR a clean bare array). Only
  // if that fails (stray prose) fall back to extracting the first balanced {...}
  // — preferred, since our canonical shape carries `feedback` — then [...].
  let v = tryParse(cleaned)
  if (v === undefined) {
    const obj = cleaned.match(/\{[\s\S]*\}/)
    if (obj) v = tryParse(obj[0])
  }
  if (v === undefined) {
    const arr = cleaned.match(/\[[\s\S]*\]/)
    if (arr) v = tryParse(arr[0])
  }
  return v ?? null
}

/** Pull a criteria array out of either a bare array or a `{criteria:[...]}` object. */
function asCriteriaArray(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object' && Array.isArray((v as { criteria?: unknown[] }).criteria)) {
    return (v as { criteria: unknown[] }).criteria
  }
  return null
}

export interface RubricCriterion {
  id: string
  description: string
  points: number
}

/** What the LLM returns for one rubric criterion (ids are assigned server-side).
 *  A deterministic regex check, when present, is embedded INLINE in `description`
 *  as "(using Regex: /…/)" — there is no separate field (see regex-check). */
interface RawCriterion {
  description?: unknown
  points?: unknown
}

export interface AiCriterionScore {
  id: string
  points: number
  comment?: string
}

export interface AiScoreResult {
  earned: number
  feedback: string | null
  criteria: AiCriterionScore[]
}

function client(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: { 'HTTP-Referer': 'https://eduskript.org', 'X-Title': 'Eduskript' },
  })
}

export function scoringModel(): string {
  return process.env.OPENROUTER_MODEL ?? 'z-ai/glm-5'
}

/** Append the teacher/org custom guidance (language, style, terminology) so the
 *  scoring + rubric models honour it — e.g. "Swiss German, never ß". */
function withGuidance(base: string, guidance?: string): string {
  if (!guidance) return base
  return `${base}\n\nTEACHER / ORGANIZATION GUIDELINES — follow these for language, spelling, style, and terminology (they override defaults):\n${guidance}`
}

/** Fixed seed for SCORING so re-scoring the same submission is reproducible
 *  (combined with temperature 0). Different submissions are different prompts, so
 *  they still score independently; only an identical re-score is pinned. */
const SCORING_SEED = 7

async function complete(
  system: string,
  user: string,
  maxTokens: number,
  opts: { temperature?: number; seed?: number } = {},
): Promise<string> {
  const res = await client().chat.completions.create({
    model: scoringModel(),
    max_tokens: maxTokens,
    // Force well-formed JSON: the model occasionally emitted slightly malformed
    // JSON (e.g. a dropped "{"), which the parser couldn't recover → a student
    // silently went unscored. (Both prompts already say "Output STRICT JSON".)
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...opts,
    ...(openrouterProviderRouting() as Record<string, unknown>),
  })
  return res.choices[0]?.message?.content ?? ''
}

// ---------------------------------------------------------------------------
// Step 1: rubric generation
// ---------------------------------------------------------------------------

const RUBRIC_SYSTEM = `You are an experienced computer-science teacher writing a fair, point-based SCORING RUBRIC for ONE exam exercise. A rubric is a list of criteria, each worth a number of points; the points must sum to the exercise's maximum.

Rules:
- Award points ONLY for what the STUDENT has to produce. Do NOT create criteria for
  anything the exercise already gives the student — provided function signatures/stubs,
  starter code, imports, scaffolding, or restating the task. Credit the behaviour and
  logic the student must implement, not what was handed to them. If a "Starter code
  already given to the student" section is present, treat EVERYTHING in it as provided:
  never make a criterion that is already satisfied by that starter code (e.g. "defines
  the function with the correct signature" when the signature is in the starter).
- Criteria must be concrete and checkable against a student's answer (e.g. "Handles the empty-list case", "Correct loop bound", "Uses a base case").
- The sum of criterion points MUST equal the given maximum points.
- Use partial-credit granularity that matches the max (e.g. 0.5-point steps are fine).
- Prefer ATOMIC criteria — one independently-awardable thing each.
- Reply in the SAME LANGUAGE as the exercise.
- Output STRICT JSON only, no prose, no code fences:
  {"criteria":[{"description":"...","points":2},{"description":"...","points":1}]}`

export interface RubricPromptInput {
  pageContext: string
  label?: string
  maxPoints: number
  reference?: string | null
  /** The editor's starter/default code (already given to the student). Shown so
   *  the model never makes a criterion for pre-provided scaffolding. */
  starterCode?: string | null
  /** A handful of student submissions to ground the criteria. */
  samples: string[]
  /** Teacher/org custom AI guidance (language, style) — see loadAiGuidance. */
  guidance?: string
}

export function buildRubricUserPrompt(input: RubricPromptInput): string {
  const parts: string[] = []
  parts.push(`# Exercise: ${input.label ?? 'Untitled'}`)
  parts.push(`Maximum points: ${input.maxPoints}`)
  parts.push(`\n## Exam page context (the exercise lives here)\n${input.pageContext}`)
  if (input.starterCode && input.starterCode.trim()) {
    parts.push(
      `\n## Starter code already given to the student (DO NOT make a criterion for any of this — it was provided, not produced by the student)\n${input.starterCode}`,
    )
  }
  if (input.reference && input.reference.trim()) {
    parts.push(`\n## Reference / checks (the teacher's solution or asserts)\n${input.reference}`)
  }
  if (input.samples.length) {
    parts.push(`\n## Sample student submissions (to calibrate the criteria)`)
    input.samples.forEach((s, i) => parts.push(`\n### Submission ${i + 1}\n${s || '(empty)'}`))
  }
  parts.push(`\nWrite the rubric now. The criterion points must sum to ${input.maxPoints}.`)
  return parts.join('\n')
}

export async function generateRubric(
  input: RubricPromptInput,
): Promise<{ criteria: RubricCriterion[] } | { error: string }> {
  let text: string
  try {
    // 8k tokens: the reasoning model (minimax) needs headroom or it truncates
    // mid-reasoning and returns empty content.
    text = await complete(withGuidance(RUBRIC_SYSTEM, input.guidance), buildRubricUserPrompt(input), 8192)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'LLM request failed' }
  }
  const rawCriteria = asCriteriaArray(extractJson(text))
  if (!rawCriteria) return { error: 'Could not parse rubric from the model output.' }
  const criteria: RubricCriterion[] = rawCriteria
    .map((raw, i) => {
      const c = (raw ?? {}) as RawCriterion
      return {
        id: `c${i + 1}`,
        description: typeof c.description === 'string' ? c.description : '',
        points: Number(c.points),
      }
    })
    .filter((c) => c.description && Number.isFinite(c.points))
  if (criteria.length === 0) return { error: 'The model returned no usable criteria.' }
  return { criteria }
}

// ---------------------------------------------------------------------------
// Step 2: score one submission against a rubric
// ---------------------------------------------------------------------------

const SCORE_SYSTEM = `You are grading ONE student's answer against a FIXED scoring rubric. For each criterion, award between 0 and that criterion's max points, judging only what the rubric asks. Be fair, consistent, and concise.

Rules:
- Award points per criterion id; never exceed a criterion's max.
- Judge each criterion INDEPENDENTLY, strictly on what IT asks. Do NOT dock a criterion
  for a flaw that belongs to a DIFFERENT criterion. If the answer satisfies a criterion
  as worded, give it FULL points even when other parts of the solution are wrong — e.g. a
  syntactically correct condition earns the full "condition" criterion even if the loop
  bounds or the return are wrong (those cost their own criteria).
- Give PARTIAL credit — do NOT be all-or-nothing, and don't be stingy. When a criterion is
  partially met, award a proportional fraction of its points (criterion max may be > 1, so
  use decimals, e.g. 1.5 of 3, or 0.5 of 1). Examples of partial: the right approach with a
  small bug, most cases handled but an edge case missed, a hardcoded value that is
  partially correct, or a correct structure with a wrong detail. Reserve 0 only for a
  criterion that is essentially not addressed; give full points when the criterion as
  worded is met.
- SYNTAX/PRESENCE criteria — judge them like a REGEX, not holistically. When a criterion
  asks only whether a construct is syntactically PRESENT or well-formed (a loop/if header,
  an operator, a call, a return statement) — NOT whether the logic, variable, or result is
  correct — do NOT weigh it against the whole (possibly broken) program. Instead think:
  "what regular expression would detect this construct in the source text, and would it
  match THIS submission?" Award FULL points if such a regex would match, 0 only if it would
  not. A regex matches text patterns and ignores indentation, surrounding errors, or whether
  the program even runs (e.g. a well-formed \`for i in range(…):\` header earns a
  "for-loop header is syntactically correct" criterion even if the loop body is mis-indented).
  Criteria about CORRECT logic, the RIGHT variable, or the RIGHT result are NOT regex-style —
  judge those normally.
- Write a short overall feedback for the student (1-3 sentences), in the SAME LANGUAGE as the submission/exercise.
- This is a SUBMITTED, already-graded exam — the student CANNOT revise it. So do NOT give
  corrective instructions ("Korrigieren Sie…", "Verwenden Sie…", "Bauen Sie … ein", "you
  should…"). Describe what is wrong and, where useful, what WOULD have been correct
  ("Korrekt wäre …", "Richtig gewesen wäre …"). Explain, don't instruct.
- Use PRECISE, CORRECT programming terminology. An "if"/"elif"/"else" is a CONDITIONAL / selection (German: Bedingung / Verzweigung / Fallunterscheidung), NOT a loop — only "for"/"while" are loops (German: Schleife). Never call an if a loop/Schleife, or vice versa. Name each construct correctly.
- Output STRICT JSON only, no prose, no code fences:
  {"criteria":[{"id":"c1","points":1.5,"comment":"..."}],"feedback":"..."}`

export interface ScorePromptInput {
  pageContext: string
  label?: string
  criteria: RubricCriterion[]
  submission: string
  /** Teacher/org custom AI guidance (language, style) — see loadAiGuidance. */
  guidance?: string
}

export function buildScoreUserPrompt(input: ScorePromptInput): string {
  const rubric = input.criteria
    .map((c) => `- [${c.id}] (max ${c.points}) ${c.description}`)
    .join('\n')
  return [
    `# Exercise: ${input.label ?? 'Untitled'}`,
    `\n## Exam page context\n${input.pageContext}`,
    `\n## Scoring rubric (award points per criterion id)\n${rubric}`,
    `\n## Student submission\n${input.submission || '(empty — award 0 unless the rubric says otherwise)'}`,
    `\nScore the submission now.`,
  ].join('\n')
}

/**
 * Pure: turn the model's raw JSON text into a validated AiScoreResult. Each
 * criterion is clamped to [0, its rubric max] and ids the rubric doesn't define
 * are dropped, so a hallucinated/over-generous model can never award more than
 * the rubric allows. `earned` is the (rounded) sum of the clamped criteria.
 */
export function parseAiScore(
  text: string,
  rubric: RubricCriterion[],
): AiScoreResult | { error: string } {
  const parsed = extractJson(text)
  const rawCriteria = asCriteriaArray(parsed)
  if (!rawCriteria) {
    return { error: 'Could not parse the AI score from the model output.' }
  }
  const maxById = new Map(rubric.map((c) => [c.id, c.points]))
  const criteria: AiCriterionScore[] = []
  for (const raw of rawCriteria) {
    const c = (raw ?? {}) as { id?: unknown; points?: unknown; comment?: unknown }
    const id = String(c.id ?? '')
    const max = maxById.get(id)
    const points = Number(c.points)
    if (max == null || !Number.isFinite(points)) continue
    const scored: AiCriterionScore = { id, points: Math.max(0, Math.min(points, max)) }
    if (typeof c.comment === 'string' && c.comment.trim()) scored.comment = c.comment.trim()
    criteria.push(scored)
  }
  const earned = Math.round(criteria.reduce((s, c) => s + c.points, 0) * 10) / 10
  // feedback only exists on the object form, not a bare array.
  const feedbackVal =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as { feedback?: unknown }).feedback
      : undefined
  const feedback = typeof feedbackVal === 'string' && feedbackVal.trim() ? feedbackVal.trim() : null
  return { earned, feedback, criteria }
}

export async function scoreSubmission(
  input: ScorePromptInput,
): Promise<AiScoreResult | { error: string }> {
  // Split: a criterion with an INLINE regex in its description is scored
  // DETERMINISTICALLY (full points on match, else 0 — no LLM, so no multi-criterion
  // context bleed); the rest are judged by the model. The regex is re-extracted from
  // the (possibly teacher-edited) description on every score, so editing it and
  // re-scoring always reflects the current pattern.
  const checkScores = new Map<string, AiCriterionScore>()
  const aiCriteria: RubricCriterion[] = []
  for (const c of input.criteria) {
    const rx = extractCriterionRegex(c.description)
    if (!rx) {
      // AI-judged: hand the model the human prose only (regex annotation stripped,
      // though a non-check criterion normally has none).
      aiCriteria.push({ ...c, description: stripInlineRegex(c.description) })
      continue
    }
    const r = runCriterionCheck(rx.pattern, rx.flags, input.submission)
    checkScores.set(c.id, {
      id: c.id,
      points: r.matched ? c.points : 0,
      comment: r.matched
        ? 'Automatische Prüfung: Muster gefunden.'
        : 'Automatische Prüfung: Muster nicht gefunden.',
    })
  }

  let aiResult: AiScoreResult = { earned: 0, feedback: null, criteria: [] }
  if (aiCriteria.length > 0) {
    let text: string
    try {
      // temperature 0 + fixed seed → reproducible. Only the AI criteria are sent
      // (smaller, cheaper, and free of the syntax-check noise).
      text = await complete(withGuidance(SCORE_SYSTEM, input.guidance), buildScoreUserPrompt({ ...input, criteria: aiCriteria }), 3072, {
        temperature: 0,
        seed: SCORING_SEED,
      })
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'LLM request failed' }
    }
    const parsed = parseAiScore(text, aiCriteria)
    if ('error' in parsed) return parsed
    aiResult = parsed
  }

  // Merge in the rubric's original order.
  const aiById = new Map(aiResult.criteria.map((c) => [c.id, c]))
  const criteria: AiCriterionScore[] = input.criteria
    .map((c) => checkScores.get(c.id) ?? aiById.get(c.id))
    .filter((c): c is AiCriterionScore => !!c)
  const earned = Math.round(criteria.reduce((s, c) => s + c.points, 0) * 10) / 10
  return { earned, feedback: aiResult.feedback, criteria }
}
