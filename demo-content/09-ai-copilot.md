# AI Co-pilot

An assistant that knows your skript inside and out — not because it was trained on your content, but because it sees your full skript context every time you ask.

---

## AI Edit

Click the **wand button (✨)** in the page editor toolbar. Describe what you want:

> "Add a *Lernziele* callout at the top of every page that doesn't have one."
>
> "Translate this page to French, keeping all code blocks unchanged."
>
> "Add a `python-check` to the FizzBuzz exercise testing n=15, 30, 100."

Click **Generate Changes**. The AI plans which pages to touch, generates each one, and shows you a **diff** side by side.

---

## Diff editor UX

**Opt-out** — every suggestion is kept by default. You only need to act if you want to revert something:

- **Revert chunk** — click the gutter button
- **Revert all** — top of the diff toolbar
- **Apply** — bottom button: "Apply to page" / "Apply to N pages"

Long jobs are crash-safe — close the tab, come back, the job continues.

---

## Bring your own AI

Don't want to use Eduskript's AI? Click **Copy context** in the AI Edit modal. It copies the entire skript (all pages, focused one tagged, cleanly formatted) to your clipboard. Paste into ChatGPT, Claude.ai, Gemini — bring your own prompt.

---

## Personal and org-wide voice

**Account settings → AI system prompt** lets you set a personal voice: "always reply in German Sie-form," "use the predict-then-verify teaching pattern," etc. Prepended to every AI call.

Org owners can set an **organization-wide prompt** for consistent voice across all teachers in the org.

---

## When it helps

> [!example] Real wins
> - "Add a callout at the top with the learning goals." (single-page)
> - "I renamed `quicksort_pivot` to `partition` — update all references." (multi-page)
> - "Rewrite this page using the same predict-then-verify pattern as page X."
> - "Translate this whole skript to English."

> [!warning] Skip AI Edit for
> Simple find-and-replace (the page editor's find/replace is faster). Highly subjective writing (review can take longer than writing yourself). Drafts where you don't yet know what you want.
