
'use client'

import { useState, useCallback, type ReactNode } from 'react'
import dynamic from 'next/dynamic'

// Dynamically import CodeMirror to avoid SSR issues
const CodeMirrorEditor = dynamic(
  () => import('@/components/dashboard/codemirror-editor'),
  { ssr: false, loading: () => <div className="h-full bg-muted animate-pulse rounded-lg" /> }
)

const SAMPLE_CONTENT = `
Naturally I'm not one with the tendency to write longer paragraphs. But you could of course do that. You might want to **emphasise certain things** or, instead, be... *subtle*.

Whatever you do, you'd probably want to add:
- Lists with bullet points
- And [Links](https://eduskript.org)

### Code Blocks + Code Editors

\`\`\`python
def greet(name):
    return f"Hello, {name}!"

print(greet("World"))
\`\`\`

### Math with LaTeX

An inline equation: $E = mc^2$

Or a block, e.g. the quadratic formula:

$$
x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}
$$

### Callouts

> [!tip] Pro Tip
> Callouts help highlight important information for your students.

> [!note]- Collapsed Note
> You can also use note, warning, success, and many other callout types.

### Tables

| Feature | Status |
|---------|--------|
| Markdown | Supported |
| LaTeX Math | Supported |
| Code Blocks | Syntax Highlighted |
| Callouts | 40+ Types |
`

interface DemoEditorProps {
  /** Additional CSS classes for the container */
  className?: string
  /**
   * Raw markdown content to use as initial content.
   * Use a template literal: content={`# Hello\n\nWorld`}
   */
  content?: string
  /** @deprecated Use `content` prop instead */
  initialContent?: string
  /** Fixed height in pixels (defaults to 600) */
  height?: number
  /** Children are ignored - use `content` prop for custom content */
  children?: ReactNode
}

/**
 * Embeddable demo editor for the marketing site.
 * Shows the full CodeMirror editor with live preview - no auth, no persistence.
 * Changes are local to the browser session only.
 *
 * Usage in markdown:
 * <DemoEditor />                                    // Uses default sample content
 * <DemoEditor content={`# Hello\n\nWorld`} />       // Custom content via prop
 * <DemoEditor content={`
 * # My Heading
 *
 * Some **bold** text and *italic* text.
 *
 * > [!tip] Pro Tip
 * > This is a callout.
 * `} />
 */
export function DemoEditor({
  className = '',
  content: contentProp,
  initialContent,
  height = 600,
}: DemoEditorProps) {
  // Priority: content > initialContent > SAMPLE_CONTENT
  const [content, setContent] = useState(contentProp?.trim() || initialContent || SAMPLE_CONTENT)

  // Memoize onChange to prevent unnecessary re-renders
  const handleChange = useCallback((newContent: string) => {
    setContent(newContent)
  }, [])

  return (
    <div
      className={`overflow-hidden rounded-lg shadow-lg ${className}`}
      style={{ height: `${height}px` }}
    >
      <CodeMirrorEditor
        content={content}
        onChange={handleChange}
        isReadOnly={false}
        fileList={[]}
      />
    </div>
  )
}
