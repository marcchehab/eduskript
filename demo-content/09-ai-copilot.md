# AI Co-pilot

Two different AI features live in Eduskript: **AI Edit** helps you write and revise your own content faster; **AI feedback** gives your students feedback on their own work, in your voice.

---

## AI Edit — a chat that edits your skript

Click the **wand icon (✨)** — leftmost button in the page editor toolbar. Tell it what you want:

> "Add a *Lernziele* callout at the top of every page that doesn't have one."
>
> "Translate this page to French, keeping all code blocks unchanged."
>
> "Add a `python-check` to the FizzBuzz exercise testing n=15, 30, 100."

It's a real conversation, not a one-shot generator. Each proposed change appears as a card inline in the chat — a short lead-in sentence, the target page, and a side-by-side diff you can still hand-edit before applying.

> [!note] Paid feature
> Free accounts see the wand icon locked with an upgrade prompt.

---

## Ask vs Auto

A toggle top-right of the chat picks how much you review:

- **Ask** (default) — one change at a time. **Accept**, **Reject**, or **Respond** with feedback to have it try again.
- **Auto** — writes each change straight to the page as it's generated. Review after the fact — **Reject** undoes it.

Changed your mind mid-generation? Hit **Stop** — it aborts immediately, the in-progress card is discarded, nothing is applied.

> [!warning] Close the tab, lose the chat
> Already-applied edits are safe — they're real page versions. The conversation itself isn't: closing the modal or switching pages resets it.

---

## Personal and org-wide voice

**Page settings → Custom System Prompt** sets your own voice — "always reply in Swiss High German," "use the predict-then-verify teaching pattern," etc. Prepended to every AI Edit call on your content.

Org owners can set an **org-wide prompt** too, for consistent voice across every teacher in the org.

---

## AI feedback for students

Drop `<ai-feedback prompt="...">` inside an exercise's heading section. Students click **Get AI feedback** and the AI reviews their work — code, free text, or their own **pen strokes** drawn on a plot or diagram — against instructions only you see.

```markdown
<ai-feedback prompt="Check each simplification step. Point out the first error, don't reveal the solution." />
```

Requires a logged-in student; rate-limited so nobody burns your AI budget by spamming it.

---

## When AI Edit helps

> [!example] Real wins
> - "Add a callout at the top with the learning goals." (single page)
> - "I renamed `quicksort_pivot` to `partition` — update all references." (multi-page)
> - "Rewrite this page using the same predict-then-verify pattern as page X."

> [!warning] Skip AI Edit for
> Simple find-and-replace (the page editor's find/replace is faster). Highly subjective writing (review can take longer than writing yourself). Drafts where you don't yet know what you want.
