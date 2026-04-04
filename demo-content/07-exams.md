# Exams

Run secure digital exams with Safe Exam Browser integration and per-class exam management.

---

## Safe Exam Browser

Eduskript integrates with [Safe Exam Browser (SEB)](https://safeexambrowser.org) — a locked-down browser that prevents students from accessing other applications or websites during an exam.

- **Token-based authentication**: Only SEB with the correct configuration can access exam pages
- **No copy-paste**: Students can't copy questions or paste answers from outside
- **Full-screen lock**: No switching to other apps or tabs

## Exam Management

Control when and how students access exam pages:

> [!abstract] Exam States
> - **Closed**: Exam page is not accessible
> - **Lobby**: Students can see the page but can't start yet — useful for getting everyone ready
> - **Open**: Exam is live, students can work
> - **Per-class control**: Different classes can have different exam states — run the same exam at different times

## Features

- **Timed exams**: Set time limits per exam session
- **Multi-page exams**: Persistent authentication across all pages in a skript
- **Submission tracking**: See when each student submits
- **Grading interface**: Review and grade submissions with numeric scores and rich text feedback
- **Code exercises in exams**: Students can write and run Python/JS code as part of the exam

> [!tip] Workflow
> 1. Create exam pages in a skript
> 2. Configure SEB settings
> 3. Set exam state to "Lobby" — students connect
> 4. Switch to "Open" — exam begins
> 5. After time is up, close the exam
> 6. Review submissions in the grading interface
