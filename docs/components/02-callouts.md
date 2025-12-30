# Callouts

Callouts are colored boxes that highlight important content.

## Basic Syntax

```markdown
> [!note]
> This is a note callout.
```

> [!note]
> This is a note callout.

## With Title

```markdown
> [!warning] Be careful
> This action cannot be undone.
```

> [!warning] Be careful
> This action cannot be undone.

## Collapsible

Add `-` for collapsed by default, `+` for expanded:

```markdown
> [!tip]- Click to expand
> Hidden content here.

> [!tip]+ Expanded by default
> Visible content here.
```

## Common Types

| Type | Color | Use for |
|------|-------|---------|
| `note` | Blue | General information |
| `tip` | Cyan | Helpful suggestions |
| `warning` | Orange | Cautions |
| `danger` | Red | Critical warnings |
| `success` | Green | Correct answers, achievements |
| `info` | Blue | Definitions, context |
| `question` | Yellow | Discussion prompts |
| `example` | Purple | Worked examples |
| `quote` | Gray | Quotations |

## Aliases

For convenience, some types have aliases:

| Alias | Maps to |
|-------|---------|
| `hint` | `tip` |
| `caution` | `warning` |
| `error` | `danger` |
| `done`, `check` | `success` |
| `faq`, `help` | `question` |
| `cite` | `quote` |

## Multi-paragraph Content

```markdown
> [!note] Title here
> First paragraph.
>
> Second paragraph.
>
> - List item
> - Another item
```

Everything inside the blockquote becomes callout content.
