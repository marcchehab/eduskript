# Callouts

Callouts are colored framed boxes that draw the eye to specific content — warnings, tips, learning goals, examples, hidden hints. They're built from regular markdown blockquotes with a type marker.

---

## Basic syntax

```markdown
> [!note] Heads up
> This is a note callout.
```

> [!note] Heads up
> This is a note callout.

The first line after `[!type]` is the title. Omit it and the callout falls back to the type name as a default heading.

---

## With a custom title

```markdown
> [!warning] Be careful
> This action cannot be undone.
```

> [!warning] Be careful
> This action cannot be undone.

The title goes on the same line as the type marker. Without a title, the callout uses a default heading based on the type.

---

## Collapsible callouts

Add `-` for collapsed by default, `+` for expanded:

```markdown
> [!tip]- Click to expand
> Hidden content here. Useful for hints, solutions, optional deep-dives.

> [!tip]+ Expanded by default
> Visible content but with a collapse button so students can hide it.
```

> [!tip]- Click to expand
> Hidden content. Click the title above to expand.

Click the title to toggle. Great for:
- Hints and solutions ("Click for the answer")
- Optional deep-dives that not every student needs
- Long examples that clutter the page when always expanded

---

## All callout types

Eduskript ships with **41 callout types** — 15 base types plus aliases for common alternative names:

### Base types

| Type | Visual | Best for |
|------|--------|----------|
| `note` | Blue, default | General information |
| `tip` | Cyan | Helpful suggestions, productivity tips |
| `info` | Blue | Definitions, context, "good to know" |
| `abstract` | Light blue | Summaries, overviews, exam states |
| `success` | Green | Correct answers, achievements, learning goals |
| `question` | Yellow | Discussion prompts, things to think about |
| `example` | Purple | Worked examples, illustrations |
| `quote` | Gray | Quotations |
| `warning` | Orange | Cautions, watch-outs |
| `danger` | Red | Critical warnings, "don't do this" |
| `failure` | Red | Wrong answers, common mistakes |
| `bug` | Red | Known issues, workarounds |
| `todo` | Gray | Notes for yourself, work-in-progress |
| `solution` | Green | Solution to an exercise (often paired with collapsed `[!solution]-`) |
| `discuss` | Purple | Class discussion prompts |

### Aliases

| Alias | Maps to |
|-------|---------|
| `lernziele` (German) | `success` |
| `hint` | `tip` |
| `caution` | `warning` |
| `error` | `danger` |
| `done`, `check` | `success` |
| `exercise` | `abstract` |
| `faq`, `help` | `question` |
| `cite` | `quote` |

Use whatever feels natural — `lernziele` is the same as `success` is the same as `done`. They all render the same callout.

---

## Multi-paragraph content

Everything after the first line is callout content. Continue with `>` on each line:

```markdown
> [!note] Title here
> First paragraph.
>
> Second paragraph.
>
> - List item
> - Another item
>
> Third paragraph with `inline code` and a [link](https://example.com).
```

> [!note] Title here
> First paragraph.
>
> Second paragraph.
>
> - List item
> - Another item

Math, code blocks, lists, and even nested callouts all work inside.

---

## Callouts inside callouts

```markdown
> [!example] Outer callout
> Some explanation.
>
> > [!warning] Nested
> > A warning inside the example.
```

Useful for examples that include caveats — but use sparingly; deeply nested callouts get hard to read.

---

## Practical patterns

### Hidden hints

````markdown
> [!tip]- Stuck?
> Try thinking about base cases first.

> [!solution]- Solution
> ```python
> def factorial(n):
>     return 1 if n <= 1 else n * factorial(n - 1)
> ```
````

The `-` keeps it collapsed; students click to reveal.

### Lesson goals at the top

```markdown
> [!success] Learning goals
> By the end of this page you'll be able to:
> - Define a function with parameters
> - Return a value
> - Recognize the difference between a parameter and an argument
```

### Predict-then-verify exercises

````markdown
> [!question] Predict
> What does this code print?
> ```python
> for i in range(3, 0, -1):
>     print(i)
> ```

> [!solution]- Verify
> ```python editor
> for i in range(3, 0, -1):
>     print(i)
> ```
````

A code block (just shown), then a runnable editor (collapsed) for verification.

---

## Callouts cheat sheet

| Goal | Syntax |
|------|--------|
| Default callout | `> [!note]` |
| With title | `> [!warning] My title` |
| Collapsed by default | `> [!tip]- Click to expand` |
| Expanded but collapsible | `> [!tip]+ See details` |
| Multi-paragraph | Continue with `>` on each line |
| Multi-line content | `>` empty line between paragraphs |
