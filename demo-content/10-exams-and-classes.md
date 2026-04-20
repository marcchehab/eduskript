# Exams & Classes

Real digital exams in the browser, with real lockdown via **Safe Exam Browser**. Group students into **classes**, give each class different access — same exam, different times, no chaos.

---

## Classes in 30 seconds

**Dashboard → Classes → New**. Get a 6-character invite code + join URL. Students enter the code on their dashboard, they're in.

- **Anonymous mode** — students join without revealing their identity (sensitive topics, anonymous polling)
- **Identity consent** — students opt in to having their real name visible (otherwise: hash pseudonym)
- **Pre-authorized roster** — bulk-import students when you know the list in advance
- **Multiple classes per student** — morning and afternoon sections on the same content, cleanly scoped

---

## Exam pages

Mark any page as an **exam** in the page-type dropdown. You get three states:

> [!abstract] Closed
> Page not accessible. Students see "not open yet." Default.

> [!abstract] Lobby
> Students can connect (auth passes, SEB launches) but content is hidden behind "waiting for instructor." Get everyone connected before the clock starts.

> [!abstract] Open
> Exam is live. Clock starts. Students can write code and submit.

**Per-class state** — run morning section at 9 AM and afternoon at 2 PM on the exact same exam. Toggle state per class independently.

---

## Safe Exam Browser

For high-stakes exams, integrate with [Safe Exam Browser](https://safeexambrowser.org):

- **Token auth** — exam only opens inside SEB with correct config; pasting the URL in Chrome doesn't work
- **No copy-paste from outside** — can't ferry questions out or paste in pre-prepared answers
- **No app switching** — alt-tab disabled at the OS level

Enable per page in exam settings. Eduskript generates the SEB config link automatically.

---

## Coding in exams

Everything from the regular code editor works — Python, JavaScript, SQL, multi-file, `python-check` auto-grading. Add `max-checks` to cap attempts and turn exams into tests of real coding ability instead of guess-and-check:

```python-check for="exam-q1" max-checks="3" points="15"
assert solution(5) == 25, "solution(5) should return 25."
assert solution(0) == 0, "solution(0) should return 0."
```

---

## Grading

Each exam attempt creates a **submission** — a snapshot of code, answers, and interactive state. In the grading interface:

- Browse submissions per class, per page
- See each student's code in the same editor they used
- Run their code yourself
- Add a numeric score + rich-text feedback
- Comment on individual code blocks

Auto-graded `python-check` results sit alongside your manual grading — so you can see who passed all checks vs who needs a closer look at a glance.

---

## Typical exam workflow

1. Build the exam (mark pages as exam type, write `python-check` blocks)
2. Enable SEB per page, share the config link in advance
3. Test it yourself (inside your own SEB)
4. 5 min before: switch pages to **Lobby** for the right class
5. At start: switch to **Open**
6. At end: switch to **Closed** — submissions lock
7. Grade from the submissions interface

---

That's the tour. Welcome to Eduskript.
