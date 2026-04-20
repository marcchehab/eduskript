# Exams & Classes

Run real digital exams in the browser, with real lockdown via Safe Exam Browser. Group your students into classes, give different classes different access — same exam, different times, no chaos.

---

## Classes

A **class** is a group of students you can address together. Create one in the dashboard with a name, get an **invite code** (and a join URL). Students enter the code on their dashboard and they're in.

Useful classroom mechanics:

- **Invite codes** — share a 6-character code in person, on the slide, in the chat. Students join in seconds.
- **Anonymous mode** — let students join without revealing their identity to other students or even (optionally) to you. Great for sensitive topics, anonymous polling.
- **Identity consent** — students explicitly opt in to having their name visible to you. Until they consent, they appear under a hash-based pseudonym.
- **Pre-authorized roster** — for course settings where you know the list in advance, bulk-import students by pseudonym so they get linked when they sign in.

> [!tip] One student in many classes
> A student can be in multiple classes simultaneously. The same lesson page behaves correctly in each context — annotations, exam state, and per-class unlocks are scoped per class.

---

## Exam pages

Mark any page as an **exam** in the page editor (the "Exam" page-type selector next to the title). Exam pages have extra controls: state, unlocks, time limits, submission tracking.

### Exam states

A page in exam mode can be in one of three states:

> [!abstract] Closed
> Page is not accessible — students see "this exam isn't open." Default state.

> [!abstract] Lobby
> Students can connect to the page (auth check passes, SEB launches if required) but the actual content is hidden behind a "waiting for instructor" screen. Use this to get everyone connected before the timer starts.

> [!abstract] Open
> Exam is live. The clock starts (if you set a time limit). Students can write code, submit answers.

You switch states from the page editor's exam settings panel. Switching to "Closed" after time's up locks further submissions.

### Per-class control

Different classes can have **different states** for the same exam page. Run the morning section at 9 AM and the afternoon section at 2 PM, on the exact same exam, by toggling state per class.

This also enables the "unlock for class X only" pattern — exam stays Closed for everyone except the class currently sitting it.

---

## Safe Exam Browser

For high-stakes exams, integrate with [Safe Exam Browser (SEB)](https://safeexambrowser.org) — a locked-down browser that prevents students from accessing other applications, websites, or even copy-paste from outside.

- **Token-based authentication** — the exam page only opens inside SEB with the correct configuration token. Pasting the URL into Chrome won't work.
- **No copy-paste from outside** — students can't ferry questions to a friend or paste in pre-prepared answers.
- **No app switching** — SEB takes over the screen; alt-tab is disabled at the OS level.

Enable SEB on a per-page basis via the exam settings panel. Eduskript generates the SEB configuration link automatically — share it with students before the exam.

---

## Submission and grading

Each student's exam attempt creates a **submission** — a snapshot of their answers, code, and any in-page interactive state at the moment they submit (or when time runs out, whichever comes first).

The grading interface lets you:
- Browse submissions per class, per page
- See each student's code in the same editor they used (with their last state)
- Run their code yourself to verify behavior
- Add a numeric score and rich-text feedback
- Comment on individual code blocks for fine-grained feedback

Auto-graded `python-check` results are shown alongside your manual grading, so you can quickly see who passed all the checks vs who needs a closer look.

---

## Code exercises in exams

Everything from the regular code editor — Python, JavaScript, SQL, multi-file editors, `python-check` auto-grading — works in exam pages too. Combined with `max-checks` (limit the number of times a student can run a check), you can build exams that test real coding ability without becoming a guess-and-check exercise.

```python-check for="exam-q1" max-checks="3" points="15"
assert solution(5) == 25, "solution(5) should return 25."
assert solution(0) == 0, "solution(0) should return 0."
```

---

## Workflow for a typical exam

1. **Build the exam** — create a skript, mark relevant pages as exam, write your `python-check` blocks
2. **Set up SEB config** — enable per page, share the config link with students in advance
3. **Test it yourself** — open the exam in your own SEB to make sure everything works
4. **5 minutes before** — switch all exam pages to **Lobby** state for the right class
5. **At start time** — switch to **Open**, students see the exam content and the clock starts
6. **At end time** — switch back to **Closed** to lock further submissions
7. **Grading** — use the submissions interface to review and grade

---

## Exams cheat sheet

| Goal | Where |
|------|-------|
| Create a class | Dashboard → Classes → New |
| Mark a page as an exam | Page editor → page-type dropdown → "Exam" |
| Per-class exam state | Exam settings panel → state per class |
| Require Safe Exam Browser | Exam settings → "Require SEB" |
| Limit attempts on auto-graded code | `max-checks="3"` on the `python-check` block |
| Grade submissions | Dashboard → Classes → Submissions |
