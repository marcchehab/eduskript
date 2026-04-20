# Components Overview

Eduskript extends markdown with interactive components. This skript is the reference for every built-in component, with full syntax, options, and examples.

---

## How components work

A component is a special block in your markdown — either a fenced code block with a keyword, or a custom HTML element. The renderer transforms it into a React component on the page, often with interactive behavior (run code, query a database, draw on the canvas).

```
Markdown → AST transformation → Custom HTML element → React hydration → Interactive component
```

You don't need to know any of this to use components — but it explains why two syntactic conventions exist (markdown and HTML) and why there are some constraints.

---

## The two component syntaxes

### Markdown style (preferred for code blocks)

````markdown
```python editor
print("Hello")
```
````

Used for code editors and code blocks. Compact, natural to read.

### HTML style (for everything else, plus extra options on code editors)

```html
<code-editor data-language="python" data-code="print('Hello')"></code-editor>
```

Used for components with no clear markdown equivalent (callouts have markdown via `> [!type]`, but quizzes, tabs, plugins, and custom elements use HTML).

> [!warning] HTML rules — strict
> All custom HTML must be **lowercase tags** with **lowercase, string-quoted attributes**. No PascalCase, no JSX expressions.
>
> - ✅ `<question id="q1" type="single">`
> - ❌ `<Question id="q1" type="single">` (PascalCase tag — won't render)
> - ❌ `<question initialCount={7}>` (JSX expression — write `initialcount="7"` instead)

Standard HTML elements (`<div>`, `<span>`, `<p>`, `<h1>`, etc.) work too — useful for layout and inline styling.

---

## Quick tour of the built-in components

### Callout

```markdown
> [!tip] Pro tip
> Callouts highlight important information.
```

> [!tip] Pro tip
> Callouts highlight important information.

### Math

Inline: $E = mc^2$ — block:

$$\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}$$

### Code block (read-only)

```python
def greet(name):
    return f"Hello, {name}!"
```

### Code editor (runnable)

```python editor
message = "Hello from Eduskript!"
print(message)
```

### Auto-graded exercise

A code editor + a `python-check` block that grades the student's code:

```python editor id="square-it"
def square(x):
    return x * 2  # wrong

# Example
print("The area of a square with side 3 is:", square(3))
```

```python-check for="square-it"
assert square(5) == 25, "square(5) should return 25.|Nice!"
```

### SQL editor

Query a SQLite database in the browser. The example below pulls the five most recently released TV shows from `netflix.db` — ordered by `release_date` descending, capped at 5 rows. Try editing the `LIMIT` or swapping `tv_show` for `movie`:

```sql editor db="netflix.db"
SELECT title, release_date
FROM tv_show
ORDER BY release_date DESC
LIMIT 5;
```

### Video

```markdown
![A short caption](my-video.mp4)
```

### Custom plugin

```html
<plugin src="marie/mod-clock" mod="7"></plugin>
```

### Quiz (single choice)

```html
<question id="q1" type="single">
  <p>What is 2 + 2?</p>
  <answer>3</answer>
  <answer correct>4</answer>
  <answer>5</answer>
</question>
```

### Tabs

```html
<tabs-container>
  <tab-item label="Python">Python content</tab-item>
  <tab-item label="JavaScript">JavaScript content</tab-item>
</tabs-container>
```

### Custom CSS

```html
<style>
  .my-class { color: red; }
</style>
```

---

## Quick reference

| Component | Markdown | HTML |
|-----------|----------|------|
| Callout | `> [!type]` | — |
| Math (inline / block) | `$...$` / `$$...$$` | — |
| Code block | ` ``` ` | — |
| Code editor | ` ```python editor ` | `<code-editor data-language="python">` |
| SQL editor | ` ```sql editor db="..." ` | `<code-editor data-language="sql" data-db="...">` |
| Auto-graded | ` ```python-check for="..." ` | — |
| Image | `![alt](file.png)` | `<image src="file.png">` |
| Excalidraw | `![alt](file.excalidraw)` | — |
| Video | `![alt](file.mp4)` | `<muxvideo src="file.mp4">` |
| Plugin | — | `<plugin src="owner/plugin">` |
| Quiz | — | `<question type="single">...<answer>` |
| Tabs | — | `<tabs-container>...<tab-item>` |
| Custom CSS | — | `<style>.cls { ... }</style>` |

---

The rest of this skript covers each built-in component in detail.
