# Code Editors & Scoring

Code editors students can edit and **run in the browser** — no installation, no server, no "please install Python first." Python and JavaScript both run client-side; SQL runs against per-student SQLite databases (covered in the next chapter); HTML renders into a sandboxed live-preview iframe.

This page also covers the three ways to **score** student work: `python-check` (pass/fail assertions on code, with points), free-text auto-check (partial-credit grading of a predicted output), and `<ai-feedback>` (AI feedback on code, free text, or pen strokes drawn on a plot or diagram). "Score" here means points — the 1-6 mark a student ultimately gets is a separate, teacher-set grade.

---

## Basic syntax

Add `editor` after the language identifier in a fenced code block:

````markdown
```python editor
name = "World"
print(f"Hello, {name}!")
```
````

```python editor
name = "World"
print(f"Hello, {name}!")
```

Students see an editor with the starting code, click **Run**, see output below.

### HTML syntax

```html
<code-editor data-language="python" data-code="print('Hello')"></code-editor>
```

The HTML form lets you set extra attributes that don't fit cleanly in a fence info-string.

---

## Supported languages

| Language | Runtime | Notes |
|----------|---------|-------|
| **Python** | [Pyodide](https://pyodide.org) + [Skulpt](https://skulpt.org) | Automatic: Skulpt for `turtle` and `input()`, Pyodide for everything else |
| **JavaScript** | A sandboxed Web Worker | Modern JS, no DOM access — for algorithms, not pages |
| **SQL** | [SQL.js](https://sql.js.org) (SQLite compiled to WebAssembly) | See **SQL Editors** chapter |
| **HTML** | A sandboxed iframe in the student's browser | Live preview pane next to the editor — for HTML/CSS/JS lessons |

Python's first run loads the runtime (~5 seconds, cached after that). Subsequent runs are instant. JavaScript and SQL are near-instant on first run.

### Two Python runtimes, transparently

Eduskript runs Python in one of two browser engines and picks the right one based on your code:

| Feature used | Runtime | Why |
|--------------|---------|-----|
| `import turtle` or `from turtle import ...` | **Skulpt** | Native async suspension for animated turtle graphics |
| Calls to `input("...")` | **Skulpt** | Clean sync-looking `input()` via Skulpt's coroutines |
| Anything else (NumPy, pandas, matplotlib, file I/O, standard library) | **Pyodide** | Real CPython on WebAssembly — full library support |

No flag to set, no editor attribute — the editor inspects the code and switches. Write the code you want to write; the right runtime loads. Both are preloaded lazily when the student scrolls near an editor.

One practical consequence: because Skulpt is a Python-to-JS compiler (not CPython), some edge cases behave slightly differently from desktop Python when `turtle` or `input()` is in use. If you hit a Skulpt-specific quirk, avoid the two trigger features and you'll land back on Pyodide.

---

## Editor IDs (recommended)

Give every editor an `id`. The ID:

- Lets `python-check` blocks reference the editor for auto-scoring
- Provides a stable key for per-student persistence (so re-ordering pages doesn't lose work)
- Identifies the editor in submission tracking and scoring

````markdown
```python editor id="exercise-1"
def double(x):
    pass  # student fills in
```
````

> [!warning] Without an explicit id
> The editor gets a generated id based on its position in the page. **Edit the page later and the student's saved work might end up associated with a different editor.** Always set an `id` for anything students will return to.

IDs only need to be unique within a page. `id="loops"` on page A and `id="loops"` on page B are independent.

---

## Multi-file editors

For anything more complex than a one-file script, use multiple consecutive blocks with the same `id`. Each block becomes a tab in the editor.

````markdown
```python editor id="rectangle" file="main.py"
from shapes import area, perimeter

w, h = 4, 7
print("Area:", area(w, h))
print("Perimeter:", perimeter(w, h))
```

```python editor id="rectangle" file="shapes.py"
def area(width, height):
    return width * height

def perimeter(width, height):
    return 2 * (width + height)
```
````

The blocks must be **consecutive** in the source — anything else between them (including non-matching code blocks) breaks the grouping. The `file=` attribute names each tab; if you omit it, the first becomes `main.py` and the rest become `file2.py`, `file3.py`, etc.

Same pattern works for JavaScript (`.js`) and SQL (`.sql`).

---

## Per-student persistence

Every code editor automatically saves what each student types — keyed to their account and the editor's `id`. When they come back tomorrow, their work is right there.

- **Save** — auto-save, debounced; manual snapshot via the editor's "Save version" button
- **Reset** — restores the original markdown content (current version, not stale cache)
- **Version history** — view past snapshots, restore any one
- **Sync** — saves to the cloud if signed in; works offline against IndexedDB and syncs on reconnect

Logged-out students get IndexedDB-only persistence (their work survives a page refresh but not a browser-data clear).

---

## Editor features for students

Inside a code editor, students get:

- **Run button** — execute the code, see output below
- **Reset** — restore to the original (with a confirmation)
- **Resize** — drag the divider between editor and output
- **Font size** — keyboard shortcut (`Cmd/Ctrl + +/-`)
- **Find/replace** — `Cmd/Ctrl + F` inside the editor
- **Multi-cursor** — `Cmd/Ctrl + click` for additional cursors
- **Auto-indent, bracket matching, syntax highlighting**

For multi-file editors, also:
- **Add file** — `+` button next to the file tabs
- **Rename file** — double-click the tab name
- **Delete file** — `×` button on the tab (can't delete the last file)

---

## Python's input(), output, errors

`input()` works — students get a prompt right above the output. Useful for interactive exercises ("enter your age", "guess the number").

```python editor
name = input("What is your name? ")
print(f"Hello, {name}!")
```

`print()` writes to the output panel. Errors (like uncaught exceptions) get colorized tracebacks.

For Python turtle graphics, `import turtle` works — output appears as an inline canvas above the text output.

### output-only: for figures, not text output

Add `output-only` to auto-run the code on page load and show just the result — code collapsed, expandable. Built for matplotlib figures and similar "here's the output, here's how it was made" exercises:

````markdown
```python editor output-only
import matplotlib.pyplot as plt
plt.plot([1, 2, 3], [1, 4, 9])
plt.show()
```
````

See **Math and Graph Plotter** for when to reach for a `plot` block instead of a full Python editor.

---

## HTML editor with live preview

Use ` ```html editor ` for HTML/CSS/JS lessons. The editor splits into two panes — code on the left, a sandboxed iframe on the right that re-renders ~500 ms after each keystroke.

````markdown
```html editor
<style>
  body { font-family: system-ui; padding: 1rem }
  h1 { color: crimson }
</style>
<h1>Hallo Welt</h1>
<button onclick="alert('Klick!')">Klick mich</button>
```
````

What works inside the iframe:

- Inline event handlers (`onclick="..."`), `<script>` blocks, and DOM access from JavaScript
- `alert()`, `confirm()`, `prompt()` for interactive demos
- `<form>` submission (won't navigate away — the sandbox blocks top-level navigation)
- External resources: CDN scripts, Google Fonts, remote images load normally

What does not work, by design:

- Reaching the parent Eduskript page — `window.parent`, cookies, `localStorage` of the host site are all blocked (no `allow-same-origin`)
- Redirecting the student's tab away from the lesson (no `allow-top-navigation`)
- Pairing with `python-check` or running in `exam` mode — the HTML editor is not auto-scored

### Layout and options

- **Default size:** 400 px tall, 50/50 horizontal split. The student can drag the divider.
- **Stack on mobile:** below 768 px the panes stack vertically (editor on top, preview below).
- **Custom height:** set `height="600"` (pixels) on the fence info-string.
- **Fullscreen:** the toolbar's fullscreen button uses the browser's native fullscreen API.

````markdown
```html editor height="600" id="kitten-demo"
<img src="https://placekitten.com/400/300">
```
````

Persistence and reset behave exactly like the other editors — student edits are saved per `id` and `Reset` restores the original markdown.

> [!note] Single-file for now
> The HTML editor takes one block per editor. The multi-file `file="..."` pattern that Python and JavaScript support is not yet wired up for HTML — combine your HTML, CSS, and JS into a single block (use `<style>` and `<script>` inline).

---

## What can Python do? What can JavaScript do?

### Python (Pyodide)

- Full standard library (`os`, `sys`, `json`, `math`, `random`, `datetime`, `collections`, `re`, etc.)
- Scientific stack: `numpy`, `pandas`, `matplotlib`, `scipy`, `scikit-learn`, `sympy`
- File I/O: `open()` works against an in-memory virtual filesystem
- `import turtle` for graphics
- HTTP requests: blocked by browser CORS — usually only works against the same origin
- Subprocess / OS commands: blocked

### JavaScript

- Full ECMAScript 2023
- `console.log` writes to output
- No DOM access (sandboxed)
- No `fetch()` to arbitrary URLs (CORS-blocked)
- Useful for: algorithms, data manipulation, JSON processing, comparisons against Python

For runtime-specific things (file uploads, browser APIs, charting libraries), use a **plugin** instead — see **Plugins**.

---

## Scoring code: python-check

Pair any code editor with a `python-check` block, and the page scores itself. Students click **Check**; the runner executes their code, runs your assertions, and shows what passed and what didn't — with the hints *you* wrote, in the language *you* wrote them.

No grading queue. No "I'll get to it next week." Students get feedback the moment they're ready for it.

### A first example

Pair an editor with a check block. The editor needs an `id`; the check block references it via `for=`.

````markdown
```python editor id="square-it"
def square(x):
    return x  # student fills this in
```

```python-check for="square-it"
assert square(5) == 25, "square(5) should return 25.|Nice — square(5) = 25!"
assert square(0) == 0, "square(0) should return 0."
assert square(-3) == 9, "square(-3) should return 9 (negatives squared are positive)."
```
````

Students see the editor and a **Check** button. Clicking Check:

1. Runs the student's code (defining `square`)
2. Executes each `assert` in turn
3. Shows a pass/fail panel with each assertion's result and message

The `python-check` block itself is **never rendered** to students — they only see the editor and the results.

### Anatomy of a python-check

Each line is a Python `assert` statement:

```python
assert <expression>, "<message>"
```

- The **expression** is evaluated. If truthy, the test passes; if falsy or it raises, the test fails.
- The **message** is what students see for that test (more on this below).

You can have any Python code in between asserts — set up variables, call helper functions, whatever. Just remember each `assert` is a separate test.

```python-check for="my-exercise"
# Setup
result_5 = my_function(5)
result_0 = my_function(0)

# Tests
assert result_5 == 25, "my_function(5) should return 25."
assert result_0 == 0, "my_function(0) should return 0."

# A more complex check
import math
assert math.isclose(my_function(0.5), 0.25), "my_function(0.5) should return 0.25."
```

### Pass and fail messages — the pipe syntax

A single message string works as the test's name in both pass and fail cases:

```python
assert fn(5) == 25, "fn(5) should return 25."
```

To show **different messages for pass and fail**, separate them with `|`:

```python
assert fn(5) == 25, "fn(5) should return 25.|Nice — fn(5) = 25!"
#                    └─── shown on fail ──┘└── shown on pass ──┘
```

Students see "fn(5) should return 25." while it's failing, and "Nice — fn(5) = 25!" once it passes. Use this for the harder problems where a little encouragement lands. For trivial checks, leave the pass message off — every test getting a 🎉 feels noisy fast.

> [!tip] f-strings work too
> `assert ok, f"Got {actual}, expected {expected}.|Top, you got {actual}!"`
> The interpolations are stripped from the displayed test name (replaced with `…`), but the rendered message is shown in the error detail when the test fails.

### Behavior tests, not implementation tests

For open challenges with multiple valid solutions, test what the function *produces* — not how it's structured.

✅ **Behavior test:**
```python
assert "umbrella" in advise(10, True).lower(), "Should mention umbrella when raining."
```

❌ **Implementation test:**
```python
import inspect
assert "if raining:" in inspect.getsource(advise), "Should use an if statement on raining."
```

The first lets every student find their own way. The second penalizes anyone who solves it differently than you imagined.

### What NOT to do

> [!failure] Anti-patterns
> - **Don't add preflight checks that pass on stub code**, like `assert "fn_name" in globals()` or `assert result is not None`. These pass *before the student does anything*, inflating the score from 0% to ~30% and giving false reassurance. If the student's function is missing, the runner already surfaces a clear error on every test that uses it — that's enough.
> - **Don't repeat the same code path with different inputs.** Three asserts that all hit the same branch waste your score signal. Pick inputs that cover *different* paths (boundaries, edge cases, the obvious main case).
> - **Don't write tests that depend on print output** unless you really mean it. Test return values when you can — they're more robust to formatting differences.
> - **Don't write a hint that says only "wrong"** — give specific, actionable guidance. The failure message is the only thing students see when stuck.

### Turtle exercises

Turtle drawings can't be checked with a plain `assert result == ...` — there's no single return value. Three helpers compare drawn paths instead:

- `turtle_solution_matches(solution_code, match_colors=False)` (preferred) — runs a teacher-supplied reference solution through the same recording stub and compares the set of drawn segments. Translation- and rotation-tolerant. Pass `match_colors=True` to also require matching pen colours per segment.
- `turtle_matches(expected_segments)` — compare against an explicit segment list.
- `turtle_path_matches(expected_path)` — compare against an explicit path.

Put long solution strings in a setup variable, then assert on the match:

```python-check for="star-drawing"
solution = """
import turtle
t = turtle.Turtle()
for _ in range(5):
    t.forward(100)
    t.right(144)
"""
assert turtle_solution_matches(solution), "Your drawing doesn't match a five-pointed star."
```

### Optional attributes

```python-check for="my-exercise" points="10" max-checks="5"
```

| Attribute | Effect |
|-----------|--------|
| `for="<editor-id>"` | Links the check to a specific editor (required) |
| `points="N"` | Score weight (default: 1 point per test) |
| `max-checks="N"` | Cap how many times a student can run Check (useful for exams — prevents brute-force) |

### exam mode: silent scoring

Add `exam` to the editor's fence info-string and it pairs with `python-check` for **silent** scoring — the student runs their code but never sees pass/fail feedback, only that it ran. Use this for assessments; the default (no `exam`) shows feedback after every Check click and is meant for practice, not exams.

### The scoring flow for students

1. Student writes code in the editor
2. Clicks **Check** (next to Run)
3. Sees a panel with each test as a row:
   - ✅ green if passed (with the pass message, if you wrote one)
   - ❌ red if failed (with the fail message + error trace)
4. Score shown as `passed/total` (e.g. `3/5`)
5. Student fixes their code, clicks Check again

The `python-check` panel persists between sessions — students see their last result when they come back to the page.

### What you can see as the teacher

For students who are signed in to a class:

- **Submissions interface** (`Dashboard → Classes → Submissions`) — see each student's latest score and code
- **Per-student detail** — view their code in the same editor they used, run it yourself
- **Numeric overrides** — record a manual score to override the auto-scored result
- **Comments** — leave rich-text feedback per submission, or per code block

Auto-scored `python-check` results show alongside your manual review, so you can spot at a glance who passed all checks vs who needs a closer look.

---

## Scoring free text: predict-output

`python-check` scores code. For questions where the student predicts what code *would* output — without running it — use the free-text auto-check variant of `<question type="text">`: give it an ` ```expected ` block instead of `<answer>` children, and it grades the student's typed prediction against that expected text with a diff, awarding partial credit rather than a strict pass/fail.

````markdown
<question id="predict-loop" type="text" points="2">
What does this code print?

```python
for i in range(3):
    print(i * 2)
```

```expected ignore-whitespace
0
2
4
```
</question>
````

- The ` ```expected ` block needs a blank line before it inside the `<question>` tag.
- Flags on the fence: `ignore-case`, `ignore-whitespace`.
- `points="2"` sets the max score; partial credit is awarded based on how close the diff is.
- On a normal page the student types a prediction and presses **Check answer**; only then do the score and the diff appear, and the question locks. With `attempts="3"` they may check three times; until the last attempt they see only the percentage, the diff (the key) stays hidden. On exam pages there is no button; the diff appears on the returned exam. Teachers always see it when scoring. See **Quizzes and Tabs** for the full `feedback` and `attempts` options.

This is a different mechanism from `python-check`: `python-check` runs the student's *code*; predict-output scores a student's *written prediction* of what code does — good for testing whether they can trace execution, not just produce working code.

---

## Scoring open-ended answers: ai-feedback

For work that has no single correct answer to diff against — free-text explanations, open code, a hand-drawn diagram — `<ai-feedback>` sends the student's work to a vision model and returns feedback, instead of a score:

```html
<ai-feedback prompt="Check whether the student's explanation correctly distinguishes a parameter from an argument. Point out the specific confusion if not." label="Check my answer" />
```

- `prompt` (required) — your instructions to the AI, e.g. what to look for and how strict to be
- `id` — optional; several `<ai-feedback>` tags on one page map to their prompts by position if omitted
- `label` — the button text shown to students (default is a generic "Check")

What gets sent: the student's pen strokes in the surrounding h1/h2/h3 section, rendered to an image, plus that section's markdown — so it can see a plot, a molecule diagram, or an editor's code alongside anything drawn on top of it. Pasting a screenshot (hover box, `Ctrl+V`) works as an alternative input, e.g. for work done outside Eduskript.

Works without a login, rate-limited per user or IP address. Unlike `python-check` and predict-output, this doesn't produce a numeric score — it's feedback, meant to help a student before they submit, not a grade.

---

## Editor and scoring cheat sheet

| Goal | Syntax |
|------|--------|
| Standalone Python editor | ` ```python editor ` |
| Standalone JavaScript editor | ` ```javascript editor ` |
| HTML editor with live preview | ` ```html editor ` |
| Taller HTML editor | ` ```html editor height="600" ` |
| Persistent editor (recommended) | ` ```python editor id="my-stable-id" ` |
| Multi-file editor (multiple blocks, same id) | ` ```python editor id="x" file="main.py" ` |
| Hide the file tabs (single-file mode) | ` ```python editor single ` |
| Figure-only editor | ` ```python editor output-only ` |
| Silent exam scoring | ` ```python editor exam ` (pair with `python-check`) |
| HTML form with custom attrs | `<code-editor data-language="python" data-id="x" data-code="...">` |
| Score code with assertions | Editor `id="x"`, then ` ```python-check for="x" ` |
| Different pass/fail messages | `assert ok, "Failure hint.\|Success cheer!"` |
| Score weighting | `python-check for="x" points="10"` |
| Limit attempts (exam contexts) | `python-check for="x" max-checks="5"` |
| Turtle drawing check | `assert turtle_solution_matches(solution), "..."` |
| Score a predicted output | `<question type="text" points="2">` + ` ```expected ` block |
| Several tries at a prediction | `<question type="text" attempts="3">` |
| AI feedback on open-ended work | `<ai-feedback prompt="..." label="..." />` |
