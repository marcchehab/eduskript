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
): Promise<{ content: string; finishReason: string | null; diag: ResponseDiag }> {
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
  // Reasoning models (minimax) put their chain-of-thought in message.reasoning and
  // the answer in message.content; OpenRouter may add native_finish_reason + a
  // top-level error. Capture all of it so an EMPTY content (rawLength 0) is
  // explainable: reasoning ate the budget, the provider refused, or returned no
  // choices. finishReason 'length' = truncated; 'stop' = finished (so a parse
  // failure is malformed JSON, not truncation).
  const choice = res.choices?.[0] as
    | {
        finish_reason?: string | null
        native_finish_reason?: string | null
        message?: { content?: string | null; reasoning?: string | null; refusal?: string | null }
      }
    | undefined
  const msg = choice?.message
  const diag: ResponseDiag = {
    choices: res.choices?.length ?? 0,
    finishReason: choice?.finish_reason ?? null,
    nativeFinishReason: choice?.native_finish_reason ?? null,
    reasoningLen: typeof msg?.reasoning === 'string' ? msg.reasoning.length : 0,
    refusal: typeof msg?.refusal === 'string' && msg.refusal ? msg.refusal : null,
    usage: res.usage
      ? { prompt: res.usage.prompt_tokens, completion: res.usage.completion_tokens, total: res.usage.total_tokens }
      : null,
    error: (res as { error?: unknown }).error ?? null,
  }
  return { content: msg?.content ?? '', finishReason: diag.finishReason, diag }
}

/** Raw response diagnostics, captured on every completion (logged on failure). */
interface ResponseDiag {
  choices: number
  finishReason: string | null
  nativeFinishReason: string | null
  /** Length of message.reasoning — large + empty content = reasoning ate the budget. */
  reasoningLen: number
  refusal: string | null
  usage: { prompt?: number; completion?: number; total?: number } | null
  error: unknown
}

/** Diagnostic detail attached to an AI parse/usability failure, so a teacher can
 *  see in the browser console WHY scoring failed — gated client-side behind the
 *  `ai:*` debug namespace (see createLogger). */
export interface AiDebug {
  stage: 'score' | 'rubric'
  /** 'length' = truncated (raise max_tokens); 'stop' = malformed JSON; null = no
   *  finish reported (often empty content — see reasoningLen / refusal / error). */
  finishReason: string | null
  nativeFinishReason?: string | null
  /** Length of the raw model content (0 = the model returned nothing). */
  rawLength: number
  /** Raw model content, capped — the actual text the parser choked on. */
  raw: string
  /** message.reasoning length; large with rawLength 0 = reasoning consumed the budget. */
  reasoningLen?: number
  choices?: number
  refusal?: string | null
  usage?: { prompt?: number; completion?: number; total?: number } | null
  error?: unknown
  model: string
}
const DEBUG_RAW_CAP = 4000

/** Build an AiDebug from a stage + the raw text + response diagnostics. */
function aiDebug(stage: AiDebug['stage'], text: string, diag: ResponseDiag): AiDebug {
  return {
    stage,
    finishReason: diag.finishReason,
    nativeFinishReason: diag.nativeFinishReason,
    rawLength: text.length,
    raw: text.slice(0, DEBUG_RAW_CAP),
    reasoningLen: diag.reasoningLen,
    choices: diag.choices,
    refusal: diag.refusal,
    usage: diag.usage,
    error: diag.error,
    model: scoringModel(),
  }
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
- Score PRINCIPLES and TECHNIQUES, not input/output test cases. Automated tests
  (python-check / asserts) already cover "returns X for input Y" — do NOT duplicate
  them. A criterion must name the programming concept the student had to apply, e.g.
  "Loop over the correct range (1 to n inclusive)", "Tests divisibility with modulo and
  combines the conditions with OR (i % 3 == 0 or i % 5 == 0)", "Initialises an
  accumulator, sums the matching numbers and returns it". NEVER write outcome criteria
  like "Returns 2 when is_member is True" or "Returns 4 when not a member and age < 16".
- Criteria must still be concrete and checkable against the student's CODE (the approach
  they used), e.g. "Uses a base case for the recursion", "Correct loop bound".
- The sum of criterion points MUST equal the given maximum points.
- Use partial-credit granularity that matches the max (e.g. 0.5-point steps are fine).
- Prefer ATOMIC criteria — one independently-awardable thing each.
- Reply in the SAME LANGUAGE as the exercise. Use proper native characters — in German
  write real umlauts (für, Rückgabe, prüft), NEVER ASCII transliterations (fuer,
  Rueckgabe, prueft). Follow any teacher/organization guidance on regional spelling
  (e.g. Swiss German uses "ss", not "ß"); absent such guidance, use standard orthography.
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
): Promise<{ criteria: RubricCriterion[] } | { error: string; debug?: AiDebug }> {
  let text: string
  let diag: ResponseDiag
  try {
    // 8k tokens: the reasoning model (minimax) needs headroom or it truncates
    // mid-reasoning and returns empty content.
    ;({ content: text, diag } = await complete(withGuidance(RUBRIC_SYSTEM, input.guidance), buildRubricUserPrompt(input), 8192))
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'LLM request failed' }
  }
  if (text.trim() === '') {
    // Empty response (no content) — often a transient provider hiccup, so the
    // caller may retry. Distinct message so it ISN'T treated as a deterministic
    // parse failure. See ResponseDiag for why (reasoningLen / refusal / error).
    console.error('[rubric] empty model response', { ...aiDebug('rubric', text, diag), raw: undefined })
    return { error: 'Empty response from the model (no content).', debug: aiDebug('rubric', text, diag) }
  }
  const rawCriteria = asCriteriaArray(extractJson(text))
  if (!rawCriteria) return { error: 'Could not parse rubric from the model output.', debug: aiDebug('rubric', text, diag) }
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
  if (criteria.length === 0) return { error: 'The model returned no usable criteria.', debug: aiDebug('rubric', text, diag) }
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
- REGEX-STYLE judging applies ONLY to a criterion whose OWN WORDING contains a word for
  SYNTAX — English "syntax"/"syntactic"/"syntactically", or German "Syntax"/"syntaktisch".
  For such a criterion (and only such): it asks merely whether a construct is syntactically
  well-formed, so judge it like a regex — "what regular expression would detect that construct,
  and would it match this submission's text?" — and award FULL on match or 0 if not, ignoring
  indentation, surrounding errors, or whether the program runs (e.g. a well-formed
  \`for i in range(…):\` line earns "for-Schleifenkopf syntaktisch korrekt" even if the body is
  mis-indented). If the criterion does NOT contain such a syntax word, do NOT use this
  all-or-nothing/regex treatment — judge it NORMALLY with PARTIAL credit per the rule above,
  even when it names a construct. Criteria about correct logic / the right variable / the right
  result are never regex-style.
- Write a short overall feedback for the student (1-3 sentences), in the SAME LANGUAGE as the submission/exercise. Use proper native characters — in German write real umlauts (für, Rückgabe, prüft), NEVER ASCII transliterations (fuer, Rueckgabe, prueft). Follow any teacher/organization guidance on regional spelling (e.g. Swiss German uses "ss", not "ß"); absent such guidance, use standard orthography.
- This is a SUBMITTED, already-graded exam — the student CANNOT revise it. So do NOT give
  corrective instructions ("Korrigieren Sie…", "Verwenden Sie…", "Bauen Sie … ein", "you
  should…"). Describe what is wrong and, where useful, what WOULD have been correct
  ("Korrekt wäre …", "Richtig gewesen wäre …"). Explain, don't instruct.
- TONE: neutral, factual and respectful — never condescending, grudging, or belittling.
  Do NOT use concessive put-downs like "Immerhin …", "Wenigstens …", "at least …". State
  what is correct and what is wrong plainly and evenly; never praise something and then
  undercut it.
- Use PRECISE, CORRECT programming terminology. An "if"/"elif"/"else" is a CONDITIONAL / selection (German: Bedingung / Verzweigung / Fallunterscheidung), NOT a loop — only "for"/"while" are loops (German: Schleife). Never call an if a loop/Schleife, or vice versa. Name each construct correctly.
- Output STRICT JSON only, no prose, no code fences:
  {"criteria":[{"id":"c1","points":1.5,"comment":"..."}],"feedback":"..."}`

/** Appended to SCORE_SYSTEM on RETRY ONLY (attempt > 0). The first attempt uses
 *  the frozen SCORE_SYSTEM verbatim so the calibration baseline is untouched;
 *  this nudge only ever sees submissions the first pass already failed on (empty
 *  content = minimax spiralling on its own chain-of-thought). It tells the model
 *  to stop deliberating and commit. Appending it changes the input, so the
 *  greedy temp-0 decode diverges from the first attempt without raising
 *  temperature — whether it actually shortens minimax's reasoning is unverified. */
const SCORE_RETRY_NUDGE = `

DECISIVENESS (retry): do NOT over-deliberate. Reason briefly, then output the JSON. If you are uncertain, commit to your best judgment and emit the result immediately — never keep reasoning instead of answering.`

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
  // Retry attempt index (0 = first try). On retries we APPEND A DECISIVENESS
  // NUDGE to the system prompt so the decode actually diverges while staying at
  // temperature 0. The old seed-only perturbation (SCORING_SEED + attempt) was a
  // no-op: greedy temp-0 decoding is deterministic and ignores the seed, so all
  // attempts came back byte-for-byte identical (Koyeb logs, 2026-06-08: 3 retries,
  // same reasoningLen/usage every time). Changing the PROMPT is the only lever
  // that diverges the output without raising temperature — so the class is still
  // graded by one model at temp 0, reproducibly. (We deliberately do NOT raise
  // temperature: a class must be gradeable deterministically.)
  // NOTE: do NOT raise max_tokens on retry — for a reasoning model (minimax) a
  // genuine spiral just reasons LONGER with more headroom (measured: 8k cap →
  // 34k reasoning chars, 16k cap → 69k), making the timeout worse, never
  // emitting content. The first fix for the spiral is scoping the context to the
  // exercise's section (see the scoring route + extractComponentContext); this
  // temperature+nudge retry is the fallback for exercises that spiral on their
  // OWN content, where scoping has nothing to strip.
  attempt = 0,
): Promise<AiScoreResult | { error: string; debug?: AiDebug }> {
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
    let diag: ResponseDiag
    try {
      // Always temperature 0 + fixed seed → fully reproducible, one model for the
      // whole class. Only the AI criteria are sent (smaller, cheaper, and free of
      // the syntax-check noise). 8k tokens: the reasoning model (minimax) spends
      // tokens on reasoning, so a tight cap truncates mid-reasoning and returns
      // empty/partial content → unparseable. Matches generateRubric's headroom.
      // On a RETRY (attempt > 0) the ONLY thing that changes is the system prompt:
      // we append the decisiveness nudge. That alters the input, so even greedy
      // temp-0 decoding produces a DIFFERENT (deterministic) output — which is the
      // point, since seed perturbation alone is inert at temp 0. The first attempt
      // uses the frozen SCORE_SYSTEM verbatim, so the calibration baseline is
      // untouched. Cap stays fixed (see the `attempt` note: more headroom worsens
      // a spiral).
      const system = attempt === 0 ? SCORE_SYSTEM : SCORE_SYSTEM + SCORE_RETRY_NUDGE
      ;({ content: text, diag } = await complete(withGuidance(system, input.guidance), buildScoreUserPrompt({ ...input, criteria: aiCriteria }), 8192, {
        temperature: 0,
        seed: SCORING_SEED,
      }))
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'LLM request failed' }
    }
    if (text.trim() === '') {
      // Empty response (no content). Distinct message so the route RETRIES it
      // (likely a transient provider hiccup) instead of treating it as a
      // deterministic parse failure. The diag explains it: a large reasoningLen
      // with rawLength 0 = reasoning ate the budget; refusal/error = provider-side.
      const debug = aiDebug('score', text, diag)
      console.error('[scoring] empty model response', { ...debug, raw: undefined })
      return { error: 'Empty response from the model (no content).', debug }
    }
    const parsed = parseAiScore(text, aiCriteria)
    if ('error' in parsed) {
      const debug = aiDebug('score', text, diag)
      // Server log (Koyeb). The same detail rides back to the browser console when
      // the teacher enables the `ai:*` debug namespace (see the route + panel).
      console.error('[scoring] parse failed', debug)
      return { ...parsed, debug }
    }
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
