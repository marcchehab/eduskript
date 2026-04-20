# Code Blocks (Read-Only)

Display code with syntax highlighting. For runnable, editable code, see the next chapter on **Code Editors**.

---

## Basic syntax

Use triple-backtick fenced code blocks. The language identifier after the opening fence enables syntax highlighting.

````markdown
```python
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)
```
````

```python
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)
```

A copy button appears in the top-right corner of every code block when the student hovers.

---

## Supported languages

Eduskript uses [highlight.js](https://highlightjs.org) for syntax highlighting, supporting hundreds of languages out of the box. Common ones:

| Language | Identifier(s) |
|----------|---------------|
| Python | `python`, `py` |
| JavaScript | `javascript`, `js` |
| TypeScript | `typescript`, `ts` |
| SQL | `sql` |
| HTML | `html`, `xml` |
| CSS | `css`, `scss` |
| Java | `java` |
| C / C++ | `c`, `cpp` |
| Go | `go` |
| Rust | `rust` |
| Bash | `bash`, `sh`, `shell` |
| JSON | `json` |
| YAML | `yaml`, `yml` |
| Markdown | `markdown`, `md` |
| Diff | `diff` |
| Plain text | (omit language) |

Unrecognized languages get plain (no-color) rendering.

---

## Plain text (no highlighting)

For console output, ASCII diagrams, or anything you don't want colorized:

````markdown
```
+----+----+
| A  | B  |
+----+----+
| 1  | 2  |
+----+----+
```
````

---

## Inline code

Single backticks for inline:

```markdown
Use the `print()` function to output text. Variables like `count` are case-sensitive.
```

Use the `print()` function to output text. Variables like `count` are case-sensitive.

---

## Code block vs code editor

| Feature | Code block | Code editor |
|---------|------------|-------------|
| Syntax highlighting | ✓ | ✓ |
| Copy button | ✓ | ✓ |
| Editable by student | ✗ | ✓ |
| Runnable in browser | ✗ | ✓ (Python, JS, SQL) |
| Saves student changes | ✗ | ✓ (per student) |
| Auto-graded | ✗ | ✓ (with `python-check`) |
| Page weight | tiny | larger (loads CodeMirror, Pyodide, etc.) |

**Use code blocks** for:
- Examples you want students to read but not modify
- Reference material (configuration, command-line syntax)
- Output/expected results to compare against
- Code in languages Eduskript can't run (Java, C++, Go, etc.)

**Use code editors** when students should experiment, run, or be graded.

---

## Multi-line examples

Long code blocks just work — students can scroll within the block. For very long code (50+ lines), consider:

1. Splitting into smaller blocks with prose between them
2. Linking to a code file students can download (via the Files panel)
3. Using a code editor with multiple files (each file becomes a tab)

---

## Code blocks inside other components

Code blocks work inside callouts, tabs, list items, table cells, and pretty much anywhere markdown allows nested content. Note that fenced code blocks inside a callout need each line prefixed with `>`:

````markdown
> [!example] An example
> ```python
> print("Hello")
> ```
````

---

## Code block cheat sheet

| Goal | Syntax |
|------|--------|
| Highlighted code block | ` ```python ... ``` ` (or any language) |
| Plain text block | ` ``` ... ``` ` (no language) |
| Inline code | `` `name` `` |
| Code in a callout | Prefix each line with `> ` (including the fence lines) |
