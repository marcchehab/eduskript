# Welcome to Eduskript

You write a markdown file. Your students get a beautiful, interactive lesson — math that renders, code they can run, exercises that grade themselves, diagrams that adapt to dark mode.

No slide deck. No PDF. No "please install Python first." Just a URL.

> [!tip] How this manual works
> This is your starter content. **Every page in this manual is itself an Eduskript page** — formatted with the same syntax you'll learn here. Click "Edit" to peek behind the curtain on any page that catches your eye.

---

## What you can do on a page

Eduskript pages are **markdown** with extras. Standard markdown works as you'd expect, plus you get math, callouts, drawings, code editors, videos, custom plugins, and more — covered in the rest of this manual.

### Text formatting

Standard markdown — but here it is for reference:

| Syntax | Result |
|--------|--------|
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `***both***` | ***both*** |
| `` `inline code` `` | `inline code` |
| `~~strikethrough~~` | ~~strikethrough~~ |
| `==highlighted==` | ==highlighted== |
| `[a link](https://eduskript.org)` | [a link](https://eduskript.org) |

### Math, properly typeset

Inline math with single dollar signs: the quadratic formula $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$ renders right inside your sentence. For full equations, use double dollar signs:

$$\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$$

Matrices and matrix-vector products work too:

$$\begin{pmatrix} a & b \\ c & d \end{pmatrix} \begin{pmatrix} x \\ y \end{pmatrix} = \begin{pmatrix} ax + by \\ cx + dy \end{pmatrix}$$

Math is rendered with [KaTeX](https://katex.org/), which means every common LaTeX command works.

### Callouts

Callouts are framed boxes that draw the eye to something important. There are over a dozen types — some examples:

> [!success] Learning goals
> A `success` callout is great for stating what students should walk away with.

> [!tip] Pro tip
> Add a `-` after the type — like `> [!tip]-` — and the callout starts **collapsed**. Perfect for hiding hints and solutions until students click.

> [!warning] Common mistake
> Without a space after `>`, the callout breaks. Look at any callout source on this page if you're unsure.

> [!question]- Think about it
> What is $\lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^n$?
>
> It's Euler's number, $e \approx 2.71828\ldots$ — click the title to collapse this hint again.

> [!example] Available types
> `note`, `tip`, `warning`, `success`, `info`, `question`, `example`, `quote`, `danger`, `abstract`, `failure`, `bug`, `solution`, `discuss` — plus aliases like `lernziele` (German for learning goals) and `hint`.

---

## How content is organized

Eduskript content has a three-level hierarchy:

- **Collection** — a course or topic area (e.g. "Introduction to Python")
- **Skript** — a module or chapter within the collection (e.g. "Functions")
- **Page** — an individual lesson within the skript (e.g. "Defining Functions")

Each level can be reordered with drag-and-drop in the dashboard. Pages within a skript can be **published** (visible to students) or kept as **drafts**, and individual pages can be **unlisted** (reachable only by direct link — useful for hidden practice exercises).

> [!info] Public URLs
> Your published content lives at `eduskript.org/<your-page-slug>/<collection>/<skript>/<page>`. You can also set up a custom domain — see the dashboard settings.

---

## What's next

The rest of this manual walks through the features that make Eduskript different from "just markdown":

1. **Diagrams & images** — hand-drawn diagrams that auto-switch with dark mode
2. **Live code** — Python, JavaScript, SQL right in the page
3. **Auto-graded exercises** — write a few `assert`s and the page grades itself
4. **SQL studio** — upload a `.db` file, students query it in the browser
5. **Custom plugins** — build any interactive widget you can imagine
6. **Annotations & broadcasting** — like a shared whiteboard for the whole class
7. **Video** — Mux-hosted, no YouTube tax
8. **AI co-pilot** — an assistant that knows your skript inside and out
9. **Exams & classes** — real digital exams with Safe Exam Browser lockdown

Pick any page from the sidebar — they're independent.
