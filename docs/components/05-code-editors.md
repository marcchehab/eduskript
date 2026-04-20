# Interactive Code Editors

Code editors students can edit and **run in the browser** — no installation, no server, no "please install Python first." Python and JavaScript both run client-side; SQL runs against per-student SQLite databases (covered in the next chapter).

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
| **Python** | [Pyodide](https://pyodide.org) (CPython compiled to WebAssembly) | Real Python 3, full standard library, NumPy / Pandas / Matplotlib / scikit-learn available |
| **JavaScript** | The student's browser, sandboxed | Modern JS, no DOM access |
| **SQL** | [SQL.js](https://sql.js.org) (SQLite compiled to WebAssembly) | See **SQL Editors** chapter |

Python's first run loads the Pyodide runtime (~5 seconds, cached after that). Subsequent runs are instant. JavaScript and SQL are near-instant on first run.

---

## Editor IDs (recommended)

Give every editor an `id`. The ID:

- Lets `python-check` blocks reference the editor for auto-grading
- Provides a stable key for per-student persistence (so re-ordering pages doesn't lose work)
- Identifies the editor in submission tracking and grading

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

For runtime-specific things (file uploads, browser APIs, charting libraries), use a **plugin** instead — see *Custom Plugins*.

---

## Editor cheat sheet

| Goal | Syntax |
|------|--------|
| Standalone Python editor | ` ```python editor ` |
| Standalone JavaScript editor | ` ```javascript editor ` |
| Persistent editor (recommended) | ` ```python editor id="my-stable-id" ` |
| Multi-file editor (multiple blocks, same id) | ` ```python editor id="x" file="main.py" ` |
| Hide the file tabs (single-file mode) | ` ```python editor single ` |
| HTML form with custom attrs | `<code-editor data-language="python" data-id="x" data-code="...">` |
