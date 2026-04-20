# Annotations and Live Broadcasting

Draw, highlight, and write notes on top of any page — like marking up a printed handout, except your students can see it live on their own devices. The killer use case: stop fighting flaky classroom AV by broadcasting your annotations directly to every student's screen.

---

## Drawing on a page

Pick the **pen tool** from the page toolbar and draw. Your strokes:

- **Save automatically** — no "did I lose my prep work after the bell?"
- **Reposition with the page layout** — when you edit the underlying content, your annotations stay anchored to the right paragraphs
- **Come in multiple colors and sizes** — toolbar lets you pick stroke width and color
- **Erase precisely** — eraser tool removes individual strokes (not pixels)

By default, annotations are **personal** — only you see them. Great for lecture prep, marking up your own copy of a colleague's content, or working through a difficult problem before showing it to students.

---

## Sticky notes

Drop a sticky note anywhere on a page:
- Drag to position
- Resize from the corner
- Color-code (yellow, pink, blue, green)
- Minimize to a small badge when it's in the way
- Click to expand again

Useful for:
- Marking spots that need revision
- Leaving questions for collaborators
- Reminders to yourself ("re-record this video before next semester")

---

## Snaps — focused annotations on a region

A "snap" is a snapshot of a specific region of the page that you can annotate separately. Click the snap tool, drag a rectangle around the region of interest, then draw inside it.

Snaps live in their own gallery — accessible from your dashboard's **My Snaps** page, organized chronologically with thumbnails.

Useful for:
- Pulling a small diagram out of context to explain it elsewhere
- Comparing before/after of a code refactor
- Building up an annotated walkthrough of a specific concept
- Saving a question/answer screenshot to discuss later

The original page stays untouched — the snap is a separate annotated overlay.

---

## Live broadcasting — the killer feature

This is where it gets interesting for the classroom.

<!-- EXCALIDRAW PLACEHOLDER: broadcast-fanout.excalidraw
     Suggested drawing: a teacher's tablet/laptop at the top with a pen
     drawing strokes on it. Arrows fan out to 3-4 student devices below
     (phone, laptop, tablet) each showing the same strokes appearing in
     real time. Labels: "Your screen (draws)" and "Students see it live"
     on each device. Hand-drawn, friendly feel.
     Once uploaded as broadcast-fanout.excalidraw.{light,dark}.svg, replace
     the code block below with:
     ![Your strokes fan out to every student's device in real time](broadcast-fanout.excalidraw) -->

```
            ┌──────────────┐
            │  Your screen │
            │              │
            │   ✏️ draws    │
            └──────┬───────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌────────┐
   │Student │ │Student │ │Student │
   │  sees  │ │  sees  │ │  sees  │
   │  live  │ │  live  │ │  live  │
   └────────┘ └────────┘ └────────┘
```

Switch your annotations to **broadcast mode** during class. Every stroke you draw appears in real time on every student's device — no projector needed, no "can the back row see this?" Students keep your annotations after class for review.

### Three broadcast scopes

> [!abstract] Class broadcast
> Your annotations stream to every student in the selected class. Like drawing on a shared whiteboard. Great for live problem-solving where you walk through a derivation while everyone follows along on their own screen.

> [!abstract] Individual feedback
> Send annotations to a single student — perfect for personalized feedback on their work. Sit at your desk during a lab, draw corrections on each student's submission, they see it instantly.

> [!abstract] Public annotations
> Visible to everyone visiting the page, including unauthenticated visitors. Useful for adding errata, hints, or "see also" notes to public lessons.

---

## How fast is live broadcasting?

- Latency target: under 100ms in good network conditions
- Strokes are streamed via Server-Sent Events (SSE) — pushed to students, no polling
- Late-joining students load existing annotations from the database, then start streaming
- Works on flaky WiFi (graceful reconnection, no lost strokes)

Per-stroke smoothing reduces visual jitter — the in-flight stroke is smoothed via a moving average before it's sent.

---

## Classroom workflow

A typical live-class flow:

1. **Before class** — open the lesson page, pre-mark anything you want to discuss (e.g. underline key terms)
2. **At start of class** — switch to **class broadcast** mode for the right class
3. **During class** — draw, highlight, circle as you talk; switch tools / colors as needed
4. **Students follow** — on their own device (phone, tablet, laptop, whatever they brought)
5. **After class** — students still see your annotations when they revisit the page

The same lesson can be re-used next semester with fresh annotations — your old annotations are scoped per teacher per session, so they don't leak into the new class.

> [!tip] No projector? No problem.
> If a classroom has flaky AV, broadcast mode is a hard upgrade: students see your work directly on their device, in their preferred theme, at their preferred zoom level. Especially nice for students at the back of the room, students with vision issues, and remote attendees joining via video call.

---

## Annotation lifecycle

| State | What happens |
|-------|--------------|
| **Personal** | Only you see; saved to your account |
| **Class broadcast** | Streamed to a specific class; saved per-class |
| **Individual** | Sent to one student; saved per-student |
| **Public** | Visible to all visitors; saved as page-level metadata |

You can switch a personal annotation to broadcast (or vice versa) — the strokes stay, the visibility scope changes.

To clear annotations, use the toolbar's **Clear** option (with confirmation). Cleared strokes are gone — they're not in version history.

---

## Annotations cheat sheet

| Goal | Where |
|------|-------|
| Draw on a page | Pen tool in the page toolbar |
| Add a sticky note | Sticky tool in the page toolbar |
| Capture and annotate a region | Snap tool in the page toolbar |
| Switch to broadcast mode | Annotation menu → choose scope (class / individual / public) |
| Send annotations to one student | Broadcast scope: Individual → pick student |
| Erase strokes | Eraser tool |
| Clear all annotations on a page | Annotation menu → clear |
| Browse all your snaps | Dashboard → My Snaps |
