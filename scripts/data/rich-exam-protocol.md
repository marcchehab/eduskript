# Rich-exam rigorous test protocol

Exam: 2 MC (Q1 single 2pts, Q2 multiple 2pts) + 3 coding (E1 doppelt 4, E2 ist_gerade 3,
E3 summe 5). Max = 16. Grade key: twoSegment, pass 60% → 4.0; `≤60%: 1+3·(p/60)`,
`>60%: 4+2·((p−60)/40)`, round 0.1. Coding check = passed asserts (points == assert count).

## Baseline (check source only — after checks run + MC auto-graded)

| Student | Q1 | Q2 | E1 | E2 | E3 | total/16 |  %     | grade |
|---------|----|----|----|----|----|----------|--------|-------|
| s1      | 2  | 2  | 4  | 3  | 5  | **16**   | 100%   | **6.0** |
| s2      | 2  | 0  | 3  | 2  | 4  | **11**   | 68.75% | **4.4** |
| s3      | 0  | 2  | 2  | 1  | 2  | **7**    | 43.75% | **3.2** |
| s4      | 2  | 2  | 1  | 3  | 1  | **9**    | 56.25% | **3.8** |
| s5      | 0  | 0  | 0  | 0  | 0  | **0**    | 0%     | **1.0** |

## Cascade rule
Effective per component = highest-priority source present: **override (100) > ai (20) > check (10)**.
Total = Σ effective. AI point values are non-deterministic → for AI steps we verify the
SOURCE cascades + recompute the total from the OBSERVED AI value, not an exact number.

## Mutation sequence (≥5 changes; each verified via DB ComponentScore + computed effective)

- **M1 — AI-score E1, all students.** E1 effective → `ai` (Vᵢ observed). Verify source='ai'
  for E1 on every student; total = baseline − checkE1 + Vᵢ.
- **M2 — override s2 E2 = 3** (was check 2). E2(s2) eff → 3 (override > check).
  s2 total 11 → **12** (75%) → grade **4.8**.
- **M3 — override s1 E1 = 1** (E1 has ai V1). E1(s1) eff → 1 (override > ai). Verify override wins.
  s1 total = 16 − 4(check shown as eff was ai V1 after M1) … recompute from current eff.
- **M4 — clear override s1 E1.** E1(s1) eff → **V1** (ai) — clear override cascades to AI.
- **M5 — clear AI s1 E1.** E1(s1) eff → **4** (check) — clear AI cascades to check. s1 total → 16, grade 6.0.
- **M6 — override s3 Q1 = 2** (MC, was check 0). Q1(s3) eff → 2. s3 total 7 → **9** (56.25%) → **3.8**.
- **M7 (staleness) — edit E1 rubric, then check s2's E1 ai.** After saving the rubric, s2's
  E1 ai score (from M1) shows the "rubric changed" stale flag; **re-score** clears it.

## Verification method
After each mutation: `node scripts/db-query.mjs` (or psql) reads ComponentScore rows for the
page; compute effective = max-priority row per (student,component); sum → total; apply grade
formula. Compare to prediction. Browser performs the real mutations (UI panel / AI tab).

---

## RESULTS (verified 2026-06-05, page cmq0mkqb20009xfc7kgn96bz2)

**Baseline coding check scores (real Pyodide via "Run all checks"): EXACT match.**
s1 E1/E2/E3 = 4/3/5 · s2 = 3/2/4 · s3 = 2/1/2 · s4 = 1/3/1 · s5 = 0/0/0. Dashboard
roster totals matched the independent calc (s1 12/4.8, s2 9/3.8, s3 5/2.6, s4 5/2.6, s5 0/1.0).

**Mutations (all verified in UI + DB ground truth):**
- M1 AI-score all (UI modal): every coding exercise → effective `ai`. AI gave rubric-based
  partial credit, bounded [0,max], sometimes ≠ binary asserts (s2 E1 2.5 vs check 3; s4 E1 0.5 vs 1).
- M2 override s2 E2=3: effective `override` (beats ai 2). UI panel shows "Manual 3P — counts towards the score".
- M3 override s1 E1=1: effective `override` (beats ai 4). UI: "Manual 1P — counts…"; GradingBar 13/5.1.
- M4 clear override s1 E1 (UI button): → effective `ai` 4; GradingBar 16/6.0. (clearOverride race-fix OK.)
- M5 clear ai s1 E1: → effective `check` 4. UI: "Unit tests 4P — counts…".
- M6 override s3 Q1=2 (MC, no check/ai): effective `override` 2.
- M7 edit/re-save E1 rubric: all prior E1 ai scores flagged stale (DB: rubric.updatedAt > meta.rubricUpdatedAt);
  UI shows amber "Rubric changed since this score was computed — re-score to update."

**Grade-formula spot checks (twoSegment, pass 60):** s2 11.5/16 → 71.875% → 4.6 ✓ (UI matched);
s1 13/16 (override state) → 81.25% → 5.1 ✓; s1 16/16 → 6.0 ✓.

Full cascade chain demonstrated end-to-end for s1/E1 in the live UI:
check(4) → AI(4) → override(1, wins) → clear→AI(4) → clear→check(4).

Conclusion: precedence (override > ai > check), clears cascading down, totals, the 1-6 grade,
and staleness detection all behave exactly as predicted, in both the dashboard and the in-exam panel.
