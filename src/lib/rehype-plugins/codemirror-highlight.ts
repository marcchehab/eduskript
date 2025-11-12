import { visit } from 'unist-util-visit'

interface LineAnnotation {
  line: number
  type: 'add' | 'remove' | 'highlight' | 'focus'
}

/**
 * Rehype plugin to prepare code blocks for CodeMirror rendering
 * Supports annotations: [!code highlight], [!code ++], [!code --], [!code focus]
 */
export function rehypeCodemirrorHighlight() {
  return function transformer(tree: any) {
    visit(tree, 'element', (node: any) => {
      if (node.tagName !== 'pre') return

      const codeElement = node.children?.find(
        (child: any) => child.tagName === 'code'
      )

      if (!codeElement) return

      // Extract language from className
      const className = codeElement.properties?.className || []
      const langClass = className.find((cls: string) =>
        cls.startsWith('language-')
      )

      if (!langClass) return

      const lang = langClass.replace('language-', '')
      const rawCode = extractText(codeElement)

      // Parse code for annotations
      const { cleanCode, annotations } = parseCodeAnnotations(rawCode)

      // Replace the pre node with a div that will be rendered by CodeMirror
      node.tagName = 'div'
      node.properties = {
        ...node.properties,
        'data-language': lang,
        'data-codemirror': 'true',
        'data-raw-code': cleanCode,
        'data-annotations': JSON.stringify(annotations),
      }
      // Remove children since we'll render with CodeMirror component
      node.children = []
    })
  }
}

/**
 * Parse code for line annotations and return clean code + annotations
 */
function parseCodeAnnotations(code: string): {
  cleanCode: string
  annotations: LineAnnotation[]
} {
  const lines = code.split('\n')
  const annotations: LineAnnotation[] = []
  const cleanLines: string[] = []

  lines.forEach((line, index) => {
    let cleanLine = line
    let hasAnnotation = false

    // Check for annotations (anywhere in the line, typically in comments)
    const patterns = [
      { regex: /\s*\[!code\s+highlight\]\s*$/, type: 'highlight' as const },
      { regex: /\s*\[!code\s+\+\+\]\s*$/, type: 'add' as const },
      { regex: /\s*\[!code\s+--\]\s*$/, type: 'remove' as const },
      { regex: /\s*\[!code\s+focus\]\s*$/, type: 'focus' as const },
    ]

    for (const pattern of patterns) {
      if (pattern.regex.test(line)) {
        annotations.push({
          line: index + 1, // 1-indexed for display
          type: pattern.type
        })
        // Remove only the marker from the line, keep the rest (including comments)
        cleanLine = line.replace(pattern.regex, '').trimEnd()

        // If the line now ends with just a comment marker (# or //) and whitespace, remove that too
        cleanLine = cleanLine.replace(/\s*(\/\/|#)\s*$/, '').trimEnd()

        hasAnnotation = true
        break
      }
    }

    cleanLines.push(cleanLine)
  })

  return {
    cleanCode: cleanLines.join('\n'),
    annotations
  }
}

function extractText(node: any): string {
  if (node.type === 'text') {
    return node.value
  }
  if (node.children) {
    return node.children.map(extractText).join('')
  }
  return ''
}
