# AI model selection — German-writing eval (2026-07-18)

Why the AI Edit / feedback models are **Qwen**, not the composite-ranking winner.

## TL;DR

- A blind German-writing eval across two real use cases (informatikgarten.ch CS
  lessons for Gymnasium Sek II; Swiss job applications) put **`qwen/qwen3.7-max`
  first in both fields** (9.0/10 overall), ahead of gemini-3.5-flash (8.6),
  glm-5.2 (8.3) and gpt-5.6-luna (7.6).
- A live vision check confirmed **`qwen/qwen3-vl-235b-a22b-instruct`** reads
  handwritten math, catches errors, diagnoses misconceptions, and answers in
  correct Swiss Standard German — at ~$0.0005 per feedback.
- **Production now uses these two as the code fallbacks** (see
  `src/app/api/ai/*/route.ts`), with the `OPENROUTER_MODEL` env override
  removed. Both stay overridable via `OPENROUTER_MODEL` /
  `OPENROUTER_VISION_MODEL`.

This matters because the automated composite ranking (`scripts/rank-ai-models.mjs`,
`/model-ranking.html`) scores **intelligence** from the Artificial Analysis
index, which is English STEM/coding-weighted and **does not measure German prose
quality**. On that metric glm-5.2 ranked top for us; hands-on German writing tells
a different story.

## Models tested (OpenRouter pricing, in/out per Mtok)

| Model | In | Out |
|---|--:|--:|
| qwen/qwen3.7-max | $1.48 | $4.42 |
| z-ai/glm-5.2 | $0.41 | $1.28 |
| google/gemini-3.5-flash | ~$0.30 | $9.00 |
| openai/gpt-5.6-luna | — | $6.00 |
| qwen/qwen3-vl-235b-a22b-instruct (vision) | $0.21 | $1.90 |

## Method

- **Two fields, 4 tasks each** (8 prompts), all in **Swiss Standard German** (ss,
  Guillemets). CS = Sek II Gymnasium (recursion, sorting exercises, Big-O,
  Socratic debugging). Applications = an invented persona (Lena Vogt: MSc
  Biomedizin + ~2.5 yr science journalism) applying to Swiss employers
  (Medical Writer, science comm., CRA pivot pitch ≤150 words, spontaneous email).
- Each prompt run against all four models via OpenRouter, `temperature 0.6`,
  `max_tokens 8192` (matching the prod route cap; an initial 2200-token run
  truncated the verbose formatters and was discarded).
- **Judge:** Claude, single rubric per field (correctness/persuasiveness,
  pedagogy/tone, Swiss-German quality, structure/format, instruction-following),
  holistic 1–10 per task.
- Harness + raw outputs: `scripts/` were not committed; the ad-hoc runner and 32
  outputs lived in the session scratchpad. Prompts are reproduced below.

## Results

| Model | CS (Sek II) | Applications | Overall |
|---|:--:|:--:|:--:|
| **qwen3.7-max** | 9.1 | 8.9 | **9.0** |
| gemini-3.5-flash | 8.9 | 8.4 | 8.6 |
| glm-5.2 | 8.5 | 8.1 | 8.3 |
| gpt-5.6-luna | 7.4 | 7.9 | 7.6 |

Per-task:

| Task | gemini | glm-5.2 | qwen | gpt-luna |
|---|:--:|:--:|:--:|:--:|
| cs1 Rekursion | 8.5 | 8.5 | 9.0 | 8.0 |
| cs2 Sortier-Übungen | 8.5 | 8.5 | 9.0 | 7.5 |
| cs3 Big-O | 9.0 | 8.0 | 9.0 | 8.5 |
| cs4 Debugging (don't reveal) | 9.5 | 9.0 | 9.5 | 5.5 |
| app1 Medical Writer | 8.5 | 8.0 | 9.0 | 7.5 |
| app2 Wissenschaftskomm. | 8.5 | 8.0 | 9.0 | 8.0 |
| app3 CRA-Pitch (≤150 W) | 8.0 | 8.5 | 8.5 | 8.0 |
| app4 Spontanbewerbung | 8.5 | 8.0 | 9.0 | 8.0 |

### Why qwen won
- **Most Swiss-authentic**: "Grüezi", Znüni, Matura, Guillemets, and correct CH
  application conventions (Lohnvorstellung, Bewerbungsfoto, Textproben) — it even
  coaches the applicant with accurate Swiss tips.
- **Richest pedagogy**: proves swaps = inversions, teaches the "Tracing/Dry-Run"
  method, gives two analogies per concept.

### Two findings specific to eduskript
- **gpt-5.6-luna is unsuitable on two counts**: (1) it **ignored the "don't
  reveal the fix" constraint** in cs4 and printed the full corrected code — wrong
  for informatikgarten's Socratic style; (2) it emits `\[...\]`, `\(...\)`,
  `\boxed{}` LaTeX, which **won't render in our KaTeX pipeline** (needs `$`/`$$`).
  gemini and qwen correctly use `$`.
- **glm-5.2** is solid but mid-pack for writing, and its reasoning tokens can
  exhaust a tight `max_tokens` before any answer streams (observed: empty output
  at 2200 tokens; the prod routes use 8192).

## Vision test (handwritten math feedback)

`qwen/qwen3-vl-235b-a22b-instruct` on a rendered "solution" to `x²−5x+6=0` with a
deliberate error (`x=5` instead of `x=3`): it transcribed the image, confirmed
the factorisation, **caught the wrong root**, diagnosed the likely misconception
("took the 5 from −5x"), and replied in correct Swiss German. Cost: ~$0.0005.
The **-instruct** (non-reasoning) variant was chosen so reasoning tokens don't
starve the route's 2048-token output cap.

## Production configuration

Set via code fallbacks (commit `6ddee8da`), no env override in prod:

- Text (`OPENROUTER_MODEL` ?? …): **`qwen/qwen3.7-max`** — edit, page generate,
  chat, excalidraw, plugin generate, scoring.
- Vision (`OPENROUTER_VISION_MODEL` ?? …): **`qwen/qwen3-vl-235b-a22b-instruct`**
  — `src/app/api/ai/feedback/route.ts`.

Both remain overridable by the respective env vars.

## Caveats / reproduce

- Single-judge (Claude) scores; no human blind panel. Treat ±0.5 as noise. The
  gaps that drove the decision (gpt's constraint violation + LaTeX issue; qwen's
  Swiss authenticity) are qualitative, not marginal.
- `scripts/rank-ai-models.mjs --html` regenerates the automated composite
  ranking (intelligence/speed/cost) — a different lens that does **not** capture
  German prose; keep both in mind.
- `scripts/seed-ai-feedback-math.mjs` seeds a local page to re-test vision
  feedback on handwritten math.

### Task prompts (Swiss German)

**CS (Sek II):**
1. Explain recursion with an everyday analogy + a commented Python factorial;
   note where it breaks (stack, base case).
2. Three graded exercises (easy/medium/hard) on Bubble/Insertion Sort with
   worked solutions.
3. Explain runtime complexity / Big-O intuitively (O(1), O(n), O(n²)) with
   examples, no unnecessary formalism.
4. A student's buggy averaging function (`summe = z` instead of `summe += z`):
   explain the bug pedagogically and lead to self-correction **without revealing
   the corrected line**.

**Applications (persona: Lena Vogt, MSc Biomedizin + science journalism):**
1. Cover letter for a Medical Writer role at a Basel pharma.
2. Cover letter for a science-communication role at a research institution.
3. ≤150-word pitch for a Clinical Research Associate career pivot.
4. Spontaneous application email to a Zürich biotech startup (with subject line).
