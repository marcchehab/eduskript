/**
 * System-prompt variants for the grading bench. Baselines are read from the
 * live source so "baseline" always == what's shipped; each variant is the
 * baseline plus a distinct CALIBRATION addendum (so comparisons are clean).
 */
import { readFileSync } from 'fs'

export interface Variant { id: string; system: string; note: string }

const src = readFileSync('src/lib/ai/scoring.ts', 'utf8')
const BASE_RUBRIC = src.match(/const RUBRIC_SYSTEM = `([\s\S]*?)`\n/)![1]
const BASE_SCORE = src.match(/const SCORE_SYSTEM = `([\s\S]*?)`\n/)![1]

// Append a calibration block just before the final "Output STRICT JSON" rule so
// it sits among the rules, not after the output spec.
function withScoreCalib(addendum: string): string {
  return BASE_SCORE.replace(/\n- Output STRICT JSON/, `\n${addendum}\n- Output STRICT JSON`)
}
function withRubricCalib(addendum: string): string {
  return BASE_RUBRIC.replace(/\n- Output STRICT JSON/, `\n${addendum}\n- Output STRICT JSON`)
}

// ---------- LEVEL / FAIRNESS calibration snippets (score) ----------
const LEVEL = `- LEVEL & FAIRNESS: these are Swiss Gymnasium / FMS students who started programming from
  zero. Grade fairly for that level — recognise what they HAVE learned, do not grade like a
  university exam or a professional code review. Be neither harsh nor a rubber stamp.`

const PARTIAL = `- BE GENEROUS WITH PARTIAL CREDIT: when a criterion's core idea is present, award most of its
  points; deduct only a little for a small bug or missing edge case. Reserve 0 ONLY when the
  criterion is essentially not addressed. A correct approach with a minor error keeps ~80% of
  the criterion; a right idea with a real bug keeps ~50%; a relevant but flawed attempt ~25%.`

const INTENT = `- CREDIT INTENT/APPROACH: if the student clearly attempted the right approach, credit the
  understanding shown even when the execution has bugs. Demonstrated concept > flawless syntax.`

const ANCHOR = `- SCALE ANCHORS per criterion: fully met = full points; correct idea, minor bug = ~0.8×;
  right approach, one real bug = ~0.5×; partial/relevant attempt = ~0.25×; unrelated/empty = 0.
  Interpolate; prefer the higher anchor when in doubt at this level.`

const UPLIFT = `- TONE: factual, neutral and UPLIFTING — name what works first, then what is missing, plainly.
  Never harsh, never condescending, no "Immerhin"/"at least" put-downs. Encourage the learner.`

export const SCORE_VARIANTS: Variant[] = [
  { id: 'base', note: 'shipped SCORE_SYSTEM', system: BASE_SCORE },
  { id: 'level', note: '+level/fairness', system: withScoreCalib(LEVEL) },
  { id: 'partial', note: '+generous partial', system: withScoreCalib(PARTIAL) },
  { id: 'intent', note: '+credit intent', system: withScoreCalib(INTENT) },
  { id: 'anchor', note: '+scale anchors', system: withScoreCalib(ANCHOR) },
  { id: 'level_uplift', note: 'level+uplift (mild)', system: withScoreCalib(LEVEL + '\n' + UPLIFT) },
  { id: 'level_anchor_uplift', note: 'level+anchors+uplift', system: withScoreCalib(LEVEL + '\n' + ANCHOR + '\n' + UPLIFT) },
  { id: 'level_partial', note: 'level+partial', system: withScoreCalib(LEVEL + '\n' + PARTIAL) },
  { id: 'level_partial_uplift', note: 'level+partial+uplift', system: withScoreCalib(LEVEL + '\n' + PARTIAL + '\n' + UPLIFT) },
  { id: 'full', note: 'level+partial+intent+anchor+uplift', system: withScoreCalib([LEVEL, PARTIAL, INTENT, ANCHOR, UPLIFT].join('\n')) },
]

// ---------- rubric-gen calibration snippets ----------
const R_FEWER = `- Prefer FEWER, higher-level criteria (3-5) that capture the core learning goals, rather than
  many fine-grained nitpicks — fine-grained rubrics aggregate into harsh all-or-nothing scores.`
const R_LEVEL = `- These are beginners (Gymnasium/FMS, from zero). Criteria should reward the core idea and the
  main steps; do NOT add criteria for edge cases, style, or robustness a beginner isn't expected to handle.`
const R_STEPS = `- Distribute the points across the main STEPS / CONCEPTS the task requires — e.g. for a loop task:
  (a) uses an appropriate loop, (b) uses the correct condition/operator, (c) accumulates/collects,
  (d) returns/produces the result — NOT only the flawless final output. This lets a beginner who
  shows the right structure but has a bug earn fair partial credit for what they demonstrably
  learned. Keep ONE criterion for overall correctness, but never let the whole score hinge on it.`

export const RUBRIC_VARIANTS: Variant[] = [
  { id: 'base', note: 'shipped RUBRIC_SYSTEM', system: BASE_RUBRIC },
  { id: 'fewer', note: '+fewer/coarser criteria', system: withRubricCalib(R_FEWER) },
  { id: 'level', note: '+beginner level', system: withRubricCalib(R_LEVEL) },
  { id: 'steps', note: 'points across steps/concepts', system: withRubricCalib(R_STEPS) },
  { id: 'steps_level', note: 'steps + beginner level', system: withRubricCalib(R_STEPS + '\n' + R_LEVEL) },
]

export const JUDGE_SYSTEM = `Du bist eine erfahrene Informatiklehrperson an einem Schweizer Gymnasium/FMS und prüfst die
Ausgabe eines KI-Bewerters. Die Lernenden haben bei NULL angefangen — bewerte nach diesem Massstab
für faire Punktevergabe (nicht wie an der Uni, nicht wie ein Code-Review):
- Im Wesentlichen korrekt (läuft, höchstens winziger Schönheitsfehler) → ~90-100%.
- Richtiger Ansatz mit EINEM echten Bug → ~50-75% (NICHT nahe 0).
- Ernsthafter Versuch, der Teilverständnis des Konzepts zeigt → deutlich >0 (~20-45%).
- Nahe 0 NUR bei leer / themenfremd / keinerlei Verständnis.
- UMGEKEHRT: klar fehlerhafter / logisch falscher Code darf NICHT (fast) volle Punkte bekommen.
"too_harsh" = ein ernsthafter Versuch wurde deutlich unter diesem Massstab bewertet.
"too_lenient" = fehlerhafter/falscher Code wurde deutlich über diesem Massstab bewertet.
Der Ton soll sachlich, neutral, eher ermutigend sein (nicht herablassend/hart).
Gib STRIKT JSON zurück:
{"fairness": <1-5, 5=trifft den Massstab>, "tone": <1-5, 5=neutral/ermutigend>, "verdict": "too_harsh"|"fair"|"too_lenient", "note": "<kurz>"}`
