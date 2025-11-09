import type { Root, Element, ElementContent, RootContent } from 'hast'

/**
 * Rehype plugin to wrap h1-h2 headings and their content into section elements
 * for the annotation system.
 *
 * This creates a proper DOM structure where each section contains:
 * - The heading element (h1-h2)
 * - All content until the next heading of equal or higher level
 *
 * Sections get:
 * - data-section-id: Combined tagName + heading ID (e.g., "h1-introduction")
 * - data-heading-text: The text content of the heading
 * - CSS class: "annotation-section" for styling
 */
export function rehypeWrapSections() {
  return (tree: Root) => {
    const newChildren: RootContent[] = []
    let currentSection: {
      heading: Element
      content: RootContent[]
      level: number
    } | null = null

    // Helper to finalize the current section
    const finalizeSection = () => {
      if (currentSection) {
        // Get section ID from heading (should be set by rehypeSlug)
        const headingId = currentSection.heading.properties?.id as string | undefined
        const sectionId = headingId ? `${currentSection.heading.tagName}-${headingId}` : undefined

        // Extract heading text
        const headingText = extractText(currentSection.heading)

        // Create section wrapper
        const section: Element = {
          type: 'element',
          tagName: 'section',
          properties: {
            'data-section-id': sectionId,
            'data-heading-text': headingText,
            className: ['annotation-section']
          },
          children: [currentSection.heading, ...currentSection.content] as ElementContent[]
        }

        newChildren.push(section)
        currentSection = null
      }
    }

    // Process all children
    for (const child of tree.children) {
      if (child.type === 'element' && isHeading(child.tagName)) {
        const level = getHeadingLevel(child.tagName)

        // h1-h2 starts a new section
        if (level >= 1 && level <= 2) {
          // Finalize previous section
          finalizeSection()

          // Start new section
          currentSection = {
            heading: child,
            content: [],
            level
          }
        } else {
          // h3-h6 or other elements - add to current section or top level
          if (currentSection) {
            currentSection.content.push(child)
          } else {
            newChildren.push(child)
          }
        }
      } else {
        // Non-heading element
        if (currentSection) {
          currentSection.content.push(child)
        } else {
          newChildren.push(child)
        }
      }
    }

    // Finalize last section
    finalizeSection()

    // Replace children
    tree.children = newChildren as any
  }
}

/**
 * Check if a tag name is a heading
 */
function isHeading(tagName: string): boolean {
  return /^h[1-6]$/.test(tagName)
}

/**
 * Get heading level (1-6) from tag name
 */
function getHeadingLevel(tagName: string): number {
  return parseInt(tagName.charAt(1))
}

/**
 * Extract text content from an element node
 */
function extractText(node: Element): string {
  let text = ''

  for (const child of node.children) {
    if (child.type === 'text') {
      text += child.value
    } else if (child.type === 'element') {
      text += extractText(child)
    }
  }

  return text
}
