# Writing Your Content

Content is written in Markdown — a simple text format that renders as formatted HTML.

> [!note] Safe Markdown
> Eduskript uses a secure markdown pipeline. JavaScript expressions like `{variable}` and import statements are not supported. Use the built-in components documented here instead.

## Basic Formatting

```markdown
# Heading 1
## Heading 2
### Heading 3

**bold text**
*italic text*
~~strikethrough~~

- Bullet list
- Another item

1. Numbered list
2. Second item

[Link text](https://example.com)
```

## Tables

```markdown
| Column A | Column B | Column C |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |
| Data 4   | Data 5   | Data 6   |
```

Renders as:

| Column A | Column B | Column C |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |
| Data 4   | Data 5   | Data 6   |

## Blockquotes

```markdown
> This is a blockquote.
> It can span multiple lines.
```

> This is a blockquote.
> It can span multiple lines.

## Horizontal Rules

Three dashes create a divider:

```markdown
---
```

---

## Tips

- Use headings to structure your content — they become the page outline
- Keep paragraphs short
- Preview your content before publishing
- The editor supports live preview as you type
