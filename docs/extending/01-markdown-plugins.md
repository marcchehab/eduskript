# Markdown Plugins

Add new syntax or transform existing markdown.

## Pipeline Overview

```
Markdown → [remark plugins] → MDAST → [rehype plugins] → HAST → React
```

Eduskript uses a **secure markdown pipeline** (not MDX). This means:
- No JavaScript expressions (`{variable}` renders as literal text)
- No import/export statements
- Components use lowercase custom elements (`<code-editor>`, not `<CodeEditor>`)

- **Remark plugins**: Transform markdown AST (add syntax, modify structure)
- **Rehype plugins**: Transform HTML AST (add attributes, wrap elements)

## Adding a Remark Plugin

Example: Transform `::highlight[text]` into highlighted spans.

**1. Create the plugin:**

```typescript
// src/lib/remark-plugins/highlight.ts
import { visit } from 'unist-util-visit'
import type { Root, Text } from 'mdast'

export function remarkHighlight() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      const match = node.value.match(/::highlight\[([^\]]+)\]/)
      if (!match || !parent || index === undefined) return

      // Replace with HTML element
      const before = node.value.slice(0, match.index)
      const after = node.value.slice(match.index! + match[0].length)

      const newNodes = []
      if (before) newNodes.push({ type: 'text', value: before })
      newNodes.push({
        type: 'html',
        value: `<mark class="highlight">${match[1]}</mark>`
      })
      if (after) newNodes.push({ type: 'text', value: after })

      parent.children.splice(index, 1, ...newNodes)
    })
  }
}
```

**2. Register in the pipeline:**

```typescript
// src/components/markdown/markdown-renderer.tsx
import { remarkHighlight } from '@/lib/remark-plugins/highlight'

// Add to the unified chain:
.use(remarkHighlight)
```

**3. Add styles (if needed):**

```css
/* src/app/globals.css */
.highlight {
  background: yellow;
  padding: 0 0.2em;
}
```

## Adding a Rehype Plugin

Example: Add `target="_blank"` to external links.

```typescript
// src/lib/rehype-plugins/external-links.ts
import { visit } from 'unist-util-visit'
import type { Root, Element } from 'hast'

export function rehypeExternalLinks() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return

      const href = node.properties?.href as string
      if (href?.startsWith('http')) {
        node.properties = {
          ...node.properties,
          target: '_blank',
          rel: 'noopener noreferrer'
        }
      }
    })
  }
}
```

## Existing Plugins

| Plugin | Purpose | Location |
|--------|---------|----------|
| `remarkCallouts` | `> [!note]` syntax | `remark-plugins/callouts.ts` |
| `remarkCodeEditor` | ` ```python editor` | `remark-plugins/code-editor.ts` |
| `remarkImageResolver` | Resolve image paths | `remark-plugins/image-resolver.ts` |
| `remarkMath` | LaTeX math | (npm package) |
| `rehypeSlug` | Heading IDs | (npm package) |
| `rehypeKatex` | Render math | (npm package) |

## Plugin Order Matters

Plugins run in order. If your plugin depends on another's output, register it after.

```typescript
.use(remarkMath)      // Parse $...$ first
.use(remarkCallouts)  // Then callouts
.use(remarkRehype)    // Convert to HTML AST
.use(rehypeKatex)     // Render math to HTML
.use(rehypeSlug)      // Add heading IDs
```

## Testing Your Plugin

```typescript
// tests/lib/remark-highlight.test.ts
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import { remarkHighlight } from '@/lib/remark-plugins/highlight'

it('transforms highlight syntax', async () => {
  const result = await unified()
    .use(remarkParse)
    .use(remarkHighlight)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process('This is ::highlight[important] text')

  expect(String(result)).toContain('<mark class="highlight">important</mark>')
})
```
