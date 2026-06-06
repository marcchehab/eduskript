# Return-path test protocol (return → student dashboard → access → feedback)

Page cmq0mkqb20009xfc7kgn96bz2, class cmq0mkqb5000bxfc798w9uz7z, 5 students, max 16.
Scored via the app: MC = check; coding (E1/E2/E3) = AI (effective); manual overrides +
feedback layered on. Effective state below is the GROUND TRUTH the student must see
identically once the exam is returned.

## Predicted per-student returned grade (effective total → twoSegment, pass 60)
| Student | Q1 | Q2 | E1 | E2 | E3 | total/16 | grade |
|---------|----|----|----|----|----|----------|-------|
| s1 | 2(c) | 2(c) | **4(o)** | 3(a) | 5(a) | 16   | **6.0** |
| s2 | 2(c) | 0(c) | 3(a) | 1(a) | 4(a) | 10   | **4.1** |
| s3 | **2(o)** | 2(c) | 1(a) | 0.5(a) | 2(a) | 7.5 | **3.3** |
| s4 | 2(c) | 2(c) | 1(a) | 3(a) | 1(a) | 9    | **3.8** |
| s5 | 0(c) | 0(c) | 0(a) | 0(a) | 0(a) | 0    | **1.0** |

## Predicted per-question FEEDBACK the student should see (effective: override > ai > check)
- **s1**: E1 → teacher "Sehr gut – vollständig korrekt." (override beats AI); E2/E3 → AI rationale.
- **s2**: E1 → AI; **E2 → teacher "Achte auf die ungeraden Zahlen." while points stay AI (1/3)**
  (independent feedback resolution — the key case); E3 → AI.
- **s3**: Q1 → teacher "Nachträglich korrigiert."; E1/E2/E3 → AI.
- **s4 / s5**: coding → AI rationale; MC → no feedback (check).

## Predictions to verify in the browser
1. **Pre-return gate:** before "Return all", a student (s1) opening the exam / hitting
   `/api/exams/<page>/my-grade` gets **403 (Not returned yet)** — no grade visible.
2. **Return:** teacher "Return all" sets `returnedAt` + `score` on all 5 submissions.
3. **Dashboard:** student `/dashboard/my-exams` (and `/api/student/my-exams`) lists the exam
   with status **returned** and an examUrl.
4. **Access + grade:** student opens the exam (review mode) → sees the **grade above** +
   total/16 (ReturnedExamSummary), and per-question **points + the effective feedback above**.
5. **Isolation:** each student sees ONLY their own grade/answers/feedback — never another's.
   (Verify s1 sees 6.0 + their feedback; s2 sees 4.1 + the teacher E2 feedback with AI points.)

## Method
Teacher actions in the default browser context (Dev Teacher). Student verification in an
ISOLATED browser context logged in as student1 / student2 (student123). Compare observed
grade + feedback to this table. `ExamSubmission.score`/`returnedAt` cross-checked via psql.

---

## RESULTS — verified 2026-06-05 (local dev, browser + DB), ALL PASS

- **Pre-return gate:** student1 `/my-grade` → **403**; `/my-exams` status **submitted**. ✓
- **Return all (teacher UI):** wrote `score` = effective total (s1 16, s2 10, s3 7.5, s4 9, s5 0),
  `returnedAt` + `scoredBy` set on all 5. ✓ (matches predicted grades 6.0/4.1/3.3/3.8/1.0)
- **Student dashboard:** `/my-exams` flips to **returned** with examUrl. ✓
- **Student access + grade:** `/my-grade` → 200; student1 sees grade **6.0**, 16/16, per-question
  2/2,2/2,**4/4**(override),3/3,5/5; student2 sees **4.1**, 10/16, 2/2,0/2,3/4,**1/3**,4/5. ✓
- **Feedback (review mode):**
  - s1 E1 → teacher "Sehr gut – vollständig korrekt." (override beats AI); E2/E3 → AI. ✓
  - s2 E2 → teacher "Achte auf die ungeraden Zahlen." with **AI points 1/3** (independent
    feedback/points resolution); E1/E3 → AI matching their code. ✓
- **Isolation:** student2 does NOT see student1's feedback (`leaksStudent1Feedback: false`);
  each student sees only their own grade/answers/feedback. ✓

Conclusion: the unified check/AI/manual scoring + grade-key + return path is correct end-to-end
for both teacher and student, including precedence, independent feedback resolution, the
returnedAt gate, and cross-student isolation.
