# AI Editing

Eduskript ships with an AI assistant that knows your skript inside and out — not because it was trained on your content, but because it sees your full skript context every time you ask. It can rewrite a single page, propose changes across multiple pages, or just hand you a clean dump of your content to paste into an external chatbot like ChatGPT or Claude.ai.

---

## AI Edit, in the editor

In the page editor's toolbar, the **wand button (✨)** opens AI Edit. Type what you want changed:

> "Add a callout at the top with the learning goals."
>
> "Translate this page to French, keeping all code blocks unchanged."
>
> "Rewrite the first section in a more conversational tone."
>
> "Add a `python-check` to the FizzBuzz exercise that tests outputs for n=15, 30, and 100."

Click **Generate Changes**. The AI plans which pages it wants to change, then generates each one. Every proposed change opens in a **diff editor** showing the before-and-after side by side.

> [!info] How wide is the focus?
> When you open AI Edit on a single page, the AI focuses there but has access to the whole skript for context — so cross-references stay consistent. When you open it from the front-page editor, it operates on just that document.

---

## Reviewing AI suggestions

The diff editor is **opt-out**: by default, every AI suggestion is **kept**. You only need to act if you want to revert something.

- **Revert single chunk** — click the gutter button next to that change
- **Revert all to original** — top toolbar of the diff
- **Apply** — bottom button of the modal commits the kept changes to the page(s)

That last button is labeled "Apply to page" / "Apply to N pages" so you can tell exactly what's about to happen.

> [!tip] Front pages don't auto-save
> When you use AI Edit on a front page, "Apply" lands the new content **into the editor** but doesn't save it to the database. Review and `Ctrl+S` yourself. This avoids the AI accidentally publishing changes to your public landing page.

---

## Copy context — bring your own AI

Don't want to use Eduskript's AI? Click **Copy context** in the AI Edit modal. It copies the entire skript content (all pages, with the focused one tagged) to your clipboard, formatted as clean text. Paste into ChatGPT, Claude.ai, Gemini, or anything else, and you've got the full context for whatever question you want to ask.

The dump includes:
- Skript title and description
- Every page's title, slug, status, and full markdown content
- A list of files attached to the skript

It does NOT include Eduskript's internal edit-format prompt — so the external AI won't try to respond in our specific JSON format. You bring your own prompt.

---

## Two-step generation pipeline

Under the hood, AI Edit is a two-step process:

1. **Plan** — given your instruction and the skript context, the AI returns a JSON plan listing which pages it wants to change. You see the plan as a progress bar of pending edits.
2. **Generate** — for each planned page, a separate AI call generates the new content. You see edits stream in one at a time.

Long generation jobs are crash-safe — close the tab, come back later, the job continues. You'll see the same proposal you would have seen.

---

## Personal and organization-wide system prompts

In **Account settings → AI system prompt**, set a personal voice for the AI. Examples:

- "Always write in German (Sie-form for students)."
- "Use the predict-then-verify teaching pattern wherever it fits."
- "Prefer concise explanations over long preamble."

These are prepended to every AI call you make. Set them once, they apply everywhere.

Organization owners can set an **org-wide system prompt** in **Organization settings → AI system prompt** — useful for enforcing a consistent voice across all teachers in the org.

---

## When AI Edit is useful

> [!example] Real use cases
> - "Add a *Lernziele* callout at the top of every page in this skript that doesn't have one."
> - "I just renamed `quicksort_pivot` to `partition` — update all references in the code blocks."
> - "Rewrite the 'Functions' page to use the same predict-then-verify pattern as the 'Loops' page."
> - "Add a `python-check` to every existing exercise that doesn't already have one."
> - "Translate this whole skript to English."

> [!warning] When to skip AI Edit
> - **Simple find-and-replace** — the regular page editor's find-and-replace is faster and more predictable.
> - **Highly subjective writing edits** — review effort sometimes exceeds writing-yourself effort.
> - **Content where you don't yet know what you want** — type your draft yourself first, then use AI to polish.

---

## AI cheat sheet

| Goal | Where |
|------|-------|
| Open AI Edit | Wand button (✨) in the page editor toolbar |
| Edit a single page (with skript context) | Open AI Edit from a page editor |
| Edit a front page only | Open AI Edit from the front-page editor |
| Use a different AI tool | "Copy context" in the AI Edit modal, paste elsewhere |
| Set a personal voice/style | Account settings → AI system prompt |
| Set an org-wide AI voice | Organization settings → AI system prompt |
| Apply AI changes | "Apply to page" / "Apply to N pages" at the bottom of the diff modal |
| Reject a single change | Click the gutter button next to that diff chunk |
| Reject all changes | "Revert all to original" at the top of the diff |
