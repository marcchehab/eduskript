# Exams

Run real digital exams in the browser, with real lockdown via Safe Exam Browser. Same editor, same rendering, same auto-graded exercises — just with extra controls for state, timing, and submission tracking.

---

## Exam pages — what makes a page an exam

Any page can be marked as an **exam page**. In the page editor, pick "Exam" from the page-type selector next to the title. Exam pages get:

- **Exam settings panel** — state, time limit, SEB requirement
- **State indicator** in the dashboard — Closed / Lobby / Open
- **Submission tracking** — each student's attempt saved as a snapshot
- **Grading interface** — browse submissions, leave feedback

The content of an exam page is the same as any other page — markdown with code editors, `python-check` blocks, math, callouts. It's just the surrounding machinery that's different.

---

## The three exam states

A page in exam mode can be in one of three states:

> [!abstract] Closed
> Page is not accessible — students see "this exam isn't open yet." Default state.

> [!abstract] Lobby
> Students can connect to the page (auth check passes, SEB launches if required) but the actual content is hidden behind a "waiting for instructor" screen. Use this to get everyone connected before the timer starts.

> [!abstract] Open
> Exam is live. The clock starts (if you set a time limit). Students can write code, submit answers, interact with `python-check` blocks.

You switch states from the page editor's exam settings panel, or from the class dashboard's exam overview. Switching back to "Closed" after time's up locks further submissions.

---

## Per-class state

Different classes can have **different states** for the same exam page. Run the morning section at 9 AM and the afternoon section at 2 PM on the exact same exam, by toggling state per class.

This also enables the "unlock for class X only" pattern — the exam stays Closed for everyone except the class currently sitting it.

```
Exam: "Midterm on Loops"
  ├── CS101 Section A → Open (9:00-10:30)
  ├── CS101 Section B → Closed
  └── CS101 Section C → Lobby (preparing for 11:00 start)
```

---

## Safe Exam Browser (SEB)

For high-stakes exams, integrate with [Safe Exam Browser](https://safeexambrowser.org) — a locked-down browser that prevents students from accessing other applications, websites, or even copy-paste from outside.

- **Token-based authentication** — the exam page only opens inside SEB with the correct configuration token. Pasting the URL into Chrome won't work.
- **No copy-paste from outside** — students can't ferry questions to a friend or paste in pre-prepared answers.
- **No app switching** — SEB takes over the screen; alt-tab is disabled at the OS level.
- **Full-screen mandatory** — student can't shrink or minimize the window.

Enable SEB on a per-page basis via the exam settings panel. Eduskript generates the SEB configuration link automatically — share it with students before the exam. They install SEB once, then use it for every exam.

> [!info] SEB is optional
> For lower-stakes assessments (in-class quizzes, practice tests), you can skip SEB entirely. The `max-checks` option on `python-check` gives you some protection against brute-forcing even without SEB.

---

## Submissions and grading

Each student's exam attempt creates a **submission** — a snapshot of:

- Their code in every editor
- Their `python-check` pass/fail state
- Their `<question>` answers
- Any in-page interactive state (quiz answers, plugin state)

Snapshots are taken at the moment they submit (or when time runs out, whichever comes first).

### The grading interface

Under **Dashboard → Classes → [Class] → Submissions**:

- Browse submissions per page, per class
- See each student's code in the same editor they used, with their last state
- Run their code yourself to verify behavior
- Add a **numeric score** (overrides or augments the auto-graded score)
- Add **rich-text feedback** (per-submission)
- **Comment on individual code blocks** for fine-grained feedback

Auto-graded `python-check` results are shown alongside your manual grading — so you can quickly see who passed all checks vs who needs a closer look.

---

## Code exercises in exams

Everything from the regular code editor — Python, JavaScript, SQL, multi-file editors, `python-check` auto-grading — works in exam pages too. Combined with `max-checks` (limit the number of times a student can run a check), you can build exams that test real coding ability without becoming a guess-and-check exercise:

````markdown
```python editor id="exam-q1"
def solution(n):
    # Your implementation here
    pass
```

```python-check for="exam-q1" max-checks="3" points="15"
assert solution(5) == 25, "solution(5) should return 25."
assert solution(0) == 0, "solution(0) should return 0."
assert solution(-3) == 9, "solution(-3) should return 9."
```
````

Three check attempts before the button locks. Students have to think, not just guess.

---

## Typical exam workflow

1. **Build the exam** — create a skript (or reuse an existing one), mark relevant pages as exam type, write your `python-check` blocks
2. **Set up SEB config** — enable per page, share the config link with students in advance
3. **Test it yourself** — open the exam in your own SEB to make sure everything works
4. **5 minutes before** — switch all exam pages to **Lobby** state for the right class
5. **At start time** — switch to **Open**, students see the exam content and the clock starts
6. **At end time** — switch back to **Closed** to lock further submissions
7. **Grading** — use the submissions interface to review and grade

---

## Time limits

Set a time limit in the exam settings:

- Starts when a student opens the exam in **Open** state
- Per-student countdown timer visible in the page header
- Submissions auto-finalize when time runs out
- Grace period optional (e.g. 2 extra minutes before hard lock)

For students with accommodations (extra time), set individual time extensions per student in the class roster.

---

## Academic integrity features

Beyond SEB:

- **`max-checks` on auto-graded exercises** — limits brute-forcing
- **Per-student randomization** — if you use templated question values (via a plugin), each student can see slightly different numbers
- **Submission snapshots** — you have the exact code the student wrote, when they wrote it
- **Timing data** — see when each student started and submitted
- **Cross-reference with class attendance** — catch "I forgot to submit" after the fact

None of this is foolproof. For truly high-stakes exams, combine SEB + proctoring + in-person invigilation.

---

## Exams cheat sheet

| Goal | Where |
|------|-------|
| Mark a page as an exam | Page editor → page-type dropdown → Exam |
| Per-class exam state | Exam settings panel → state per class |
| Require Safe Exam Browser | Exam settings → Require SEB → get config link |
| Set a time limit | Exam settings → Time limit |
| Individual time extension | Class roster → student → accommodations |
| Limit attempts on auto-graded code | `max-checks="3"` on the `python-check` block |
| Review submissions | Dashboard → Classes → [class] → Submissions |
| Grade + comment | Submissions interface → per-student detail |
