# Classes and Students

Group your students into classes. Use classes to give different sections different access to the same content, run exams at different times, broadcast annotations live, and track per-student work — all while protecting student privacy by default.

---

## Creating a class

1. **Dashboard → Classes**
2. Click **+ New class**
3. Give it a name (e.g., "CS101 Fall 2026, Section A")
4. Get an **invite code** and a **join URL**

That's it. The class is live; students can join.

---

## How students enroll

Share the invite code or join URL. Students:

1. Visit the join URL (or paste the code into their dashboard)
2. Sign in (Google, GitHub, Microsoft, or email)
3. They're enrolled

Students appear in your class roster within seconds.

> [!tip] Codes work in person too
> The 6-character code can be shared on a slide ("Join with code XYZAB1"), in the lecture hall, in a Slack channel, on a printed handout. They're not secrets — they just need to be communicated.

---

## Class settings

| Setting | What it does |
|---------|--------------|
| **Name** | Display name for the class |
| **Invite code** | Unique 6-character code for joining (regenerable) |
| **Join URL** | Direct link that auto-fills the code |
| **Allow anonymous** | Let unauthenticated visitors access class content (use sparingly) |
| **Pre-authorized roster** | Bulk-import students by pseudonym (for institutional integrations) |

**Regenerate** the invite code if it leaks (an old student shares it after they've left, the URL ends up on Reddit, etc.). Old code stops working immediately.

---

## Student privacy — privacy by default

Eduskript is built for use in regulated educational settings (German Datenschutz especially). Student privacy is the default, not an afterthought:

- **No email required from students** — they sign in via OAuth, no email or other PII stored
- **Pseudonymous by default** — students appear under a hash-based pseudonym (e.g. `student_a4b8c2d1`)
- **Identity consent** — students explicitly opt-in to having their real name visible to you
- **No tracking across teachers** — a student in your class isn't visible to another teacher unless they're also in *that* teacher's class

What you can see by default (without identity consent):
- The student's pseudonym
- Whether they've visited each page
- Their code in editors, scoped per pseudonym
- Their annotations (if they've made any visible)

What you can NOT see without consent:
- Real name
- Email
- Other classes they're in
- Activity outside your class

When a student opts in to identity consent, you see their real name in the roster, alongside the pseudonym.

---

## Anonymous mode (whole-class)

For sensitive topics where you want students to participate without being identified to *each other*:

- **Allow anonymous** in class settings — students can join without authenticating at all
- They get a per-session pseudonym (e.g. `anonymous_3f8a`)
- Useful for: anonymous polling, sensitive discussion topics, demos without enrollment

Their work is saved per-session via cookies; closing the tab loses it. For graded work, students should sign in.

---

## Pre-authorized students (bulk import)

For institutional settings where you have a class roster in advance:

1. **Class settings → Pre-authorized roster → Upload CSV**
2. CSV format: one column `pseudonym` (whatever ID your institution uses)
3. When a student signs in matching that pseudonym, they're auto-enrolled

Useful for institutional SSO integrations where students are identified by an institutional ID rather than a self-chosen username.

---

## What you can see per student

For enrolled students, the class dashboard shows:

- **Pseudonym** (and real name if consented)
- **Last seen** — most recent activity timestamp
- **Pages visited** — which pages they've opened
- **Code work** — what they've written in editors (latest state)
- **Annotations** — what they've drawn (if they've made any visible)
- **Quiz / exercise results** — auto-graded scores from `python-check` and `<question>`
- **Submissions** — exam attempts with code snapshots

Click any student to drill into their per-page work.

---

## Multiple classes for the same student

A student can be in **multiple classes** simultaneously. The same lesson page behaves correctly in each context — annotations, exam state, and per-class unlocks are scoped per class.

This means:
- The same skript can be used across morning + afternoon sections
- An exam can have different open/closed states per class
- A teacher can run a course and a tutoring group on the same content with separate rosters

---

## Archiving classes

At semester end, archive a class to:
- Remove it from your dashboard's main list
- Keep historical data (pseudonyms, submissions, work) for reference
- Stop accepting new joins via the invite code

Archived classes are read-only — students retain access to view their work, but new submissions are blocked.

To fully delete a class (and all its student work), use **Class settings → Delete** — irreversible.

---

## Classes cheat sheet

| Goal | Where |
|------|-------|
| Create a class | Dashboard → Classes → New |
| Get invite code / join URL | Class detail → top toolbar |
| See student roster | Class detail → Students tab |
| Enable anonymous access | Class settings → Allow anonymous |
| Bulk-import roster | Class settings → Pre-authorized roster |
| See a student's work | Click the student in the roster |
| Regenerate the code | Class settings → Regenerate invite code |
| Archive at semester end | Class settings → Archive |
