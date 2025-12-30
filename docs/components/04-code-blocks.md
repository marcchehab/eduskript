# Code Blocks

Display code with syntax highlighting.

## Basic Syntax

````markdown
```python
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)
```
````

Renders as:

```python
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)
```

## Supported Languages

| Language | Identifier |
|----------|------------|
| Python | `python`, `py` |
| JavaScript | `javascript`, `js` |
| TypeScript | `typescript`, `ts` |
| SQL | `sql` |
| HTML | `html` |
| CSS | `css` |
| Java | `java` |
| C/C++ | `c`, `cpp` |
| Go | `go` |
| Rust | `rust` |
| Bash | `bash`, `sh` |
| JSON | `json` |
| Markdown | `markdown`, `md` |

## No Language (Plain Text)

````markdown
```
Just plain text
No highlighting
```
````

## Inline Code

Use single backticks for inline: `variable_name`

```markdown
Use the `print()` function to output text.
```

Use the `print()` function to output text.

## Code Blocks vs Editors

| Feature | Code Block | Code Editor |
|---------|------------|-------------|
| Syntax highlighting | ✓ | ✓ |
| Copy button | ✓ | ✓ |
| Editable by student | ✗ | ✓ |
| Runnable | ✗ | ✓ |
| Saves student changes | ✗ | ✓ |

Use code blocks for examples you want to show. Use editors when students should experiment.
