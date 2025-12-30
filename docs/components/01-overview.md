# Components Overview

Eduskript extends markdown with interactive components.

> [!tip] Component Syntax
> Use fenced code blocks (` ```python editor `) or lowercase HTML elements (`<code-editor>`). PascalCase components like `<CodeEditor />` are not supported.

---

## Callout

> [!tip] Pro tip
> Callouts highlight important information.

---

## Math

Inline: The quadratic formula is $x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$

Block:
$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$

---

## Code Block

```python
def greet(name):
    return f"Hello, {name}!"

print(greet("World"))
```

---

## Interactive Editor

Students can edit and run this code:

```python editor
# Try changing the message
message = "Hello from Eduskript!"
print(message)
```

---

## SQL Editor

Query a real database:

```sql editor db="sample.db"
SELECT * FROM users LIMIT 5;
```

---

## Quick Reference

| Component | Markdown Syntax | HTML Syntax |
|-----------|-----------------|-------------|
| Callout | `> [!type]` | — |
| Math | `$...$` or `$$...$$` | — |
| Code block | ` ``` ` | — |
| Code editor | ` ```python editor` | `<code-editor data-language="python">` |
| SQL editor | ` ```sql editor db="..."` | `<code-editor data-language="sql" data-db="...">` |
| YouTube | `![](youtube:VIDEO_ID)` | `<youtube-embed data-id="VIDEO_ID">` |
| Excalidraw | `![](file.excalidraw)` | `<excali src="file">` |
| Quiz | — | `<question type="choice">...<quiz-option>` |
| Tabs | — | `<tabs-container>...<tab-item>` |

---

Each component is documented in detail on the following pages.
