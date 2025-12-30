# Interactive Code Editors

Let students write, edit, and run code directly in the page.

## Basic Syntax

Add `editor` after the language:

````markdown
```python editor
name = "World"
print(f"Hello, {name}!")
```
````

**HTML syntax**:
```html
<code-editor data-language="python" data-code="print('Hello')"></code-editor>
```

## Supported Languages

| Language | Runs in |
|----------|---------|
| Python | Browser (Pyodide) |
| JavaScript | Browser |
| SQL | Browser (SQL.js) |

Python and JavaScript execute client-side — no server needed.

## Editor Features

Students can:
- Edit the code
- Run it and see output
- Reset to original
- Save their version (persists across sessions)

## Multiple Files

Students can create multiple files within one editor using the file tabs.

## Editor ID

Give editors an ID to track student work:

````markdown
```python editor id="exercise-1"
# Complete the function
def double(x):
    pass
```
````

IDs help you identify which exercise a student worked on.

## Read-Only Sections

Currently, all code is editable. To show non-editable examples, use regular code blocks instead.

## Tips

- Start with working code — let students modify it
- Keep exercises focused on one concept
- Provide clear instructions in the surrounding text
- Test your code before publishing
