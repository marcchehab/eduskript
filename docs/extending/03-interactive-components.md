# Interactive Components

Add new interactive elements that students can use.

## How It Works

Interactive components use a two-phase approach:

1. **Server**: Markdown plugin outputs a custom HTML element with `data-*` attributes
2. **Client**: React hydrates the custom element into a full component

This gives fast initial render with progressive enhancement.

## Example: Quiz Component

Goal: `::quiz[What is 2+2?]{answer=4}` becomes an interactive quiz.

### Step 1: Remark Plugin

```typescript
// src/lib/remark-plugins/quiz.ts
import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'

export function remarkQuiz() {
  return (tree: Root) => {
    visit(tree, 'text', (node, index, parent) => {
      const regex = /::quiz\[([^\]]+)\]\{answer=([^}]+)\}/g
      const match = regex.exec(node.value)

      if (!match || !parent || index === undefined) return

      const [fullMatch, question, answer] = match
      const before = node.value.slice(0, match.index)
      const after = node.value.slice(match.index + fullMatch.length)

      // Output custom element with data attributes
      const quizHtml = `<quiz-component data-question="${encodeURIComponent(question)}" data-answer="${encodeURIComponent(answer)}"></quiz-component>`

      const newNodes = []
      if (before) newNodes.push({ type: 'text', value: before })
      newNodes.push({ type: 'html', value: quizHtml })
      if (after) newNodes.push({ type: 'text', value: after })

      parent.children.splice(index, 1, ...newNodes)
    })
  }
}
```

### Step 2: React Component

```typescript
// src/components/public/quiz-component.tsx
'use client'

import { useState } from 'react'

interface QuizProps {
  question: string
  answer: string
}

export function QuizComponent({ question, answer }: QuizProps) {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<'correct' | 'wrong' | null>(null)

  const check = () => {
    setResult(input.trim() === answer ? 'correct' : 'wrong')
  }

  return (
    <div className="quiz border rounded p-4 my-4">
      <p className="font-medium">{question}</p>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="border rounded px-2 py-1 mr-2"
      />
      <button onClick={check} className="bg-blue-500 text-white px-3 py-1 rounded">
        Check
      </button>
      {result === 'correct' && <span className="text-green-600 ml-2">✓ Correct!</span>}
      {result === 'wrong' && <span className="text-red-600 ml-2">✗ Try again</span>}
    </div>
  )
}
```

### Step 3: Hydration

```typescript
// src/components/markdown/markdown-renderer.tsx

// In the useEffect that hydrates components:
const quizElements = contentRef.current.querySelectorAll('quiz-component')

quizElements.forEach((el) => {
  const question = decodeURIComponent(el.getAttribute('data-question') || '')
  const answer = decodeURIComponent(el.getAttribute('data-answer') || '')

  const wrapper = document.createElement('div')
  el.replaceWith(wrapper)

  const root = createRoot(wrapper)
  root.render(<QuizComponent question={question} answer={answer} />)
})
```

### Step 4: Register Plugin

```typescript
// src/components/markdown/markdown-renderer.tsx
import { remarkQuiz } from '@/lib/remark-plugins/quiz'

// Add to pipeline:
.use(remarkQuiz)
```

## Existing Interactive Components

| Component | Custom Element | Data Attributes |
|-----------|----------------|-----------------|
| Code Editor | `<code-editor>` | `data-language`, `data-code`, `data-id` |
| SQL Editor | `<code-editor>` | `data-db`, `data-schema-image` |

## Persisting Student Data

Use the `UserData` model to save student state:

```typescript
// Save
await fetch('/api/user-data', {
  method: 'POST',
  body: JSON.stringify({
    adapter: 'quiz',
    itemId: pageId,
    data: { answers: [...] }
  })
})

// Load
const response = await fetch(`/api/user-data?adapter=quiz&itemId=${pageId}`)
```

## Tips

- Use lowercase custom elements: `<quiz-component>` not `<QuizComponent>`
- Encode data in attributes to survive HTML serialization
- Test without JavaScript first (should show fallback)
- Use existing patterns from `code-editor.tsx`
