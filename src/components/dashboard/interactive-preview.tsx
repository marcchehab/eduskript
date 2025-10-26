'use client'

import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { CodeBlockControl } from './code-block-control'

interface InteractivePreviewProps {
  html: string
  onContentChange?: (newContent: string) => void
  originalMarkdown?: string
}

export function InteractivePreview({ html, onContentChange, originalMarkdown }: InteractivePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rootsRef = useRef<Map<string, ReturnType<typeof createRoot>>>(new Map())

  useEffect(() => {
    if (!containerRef.current) return

    // Clean up previous roots
    rootsRef.current.forEach((root) => root.unmount())
    rootsRef.current.clear()

    // Scan for code blocks and inject controls
    const codeBlockNodes = containerRef.current.querySelectorAll('[data-interactive="code-block"]')

    codeBlockNodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return

      const id = node.getAttribute('data-block-id') || ''
      const language = node.getAttribute('data-lang') || 'text'

      // Make the pre tag position relative and add padding for the control
      node.style.position = 'relative'
      node.style.paddingTop = '36px' // Add space for the dropdown

      // Create a container for the control
      const controlContainer = document.createElement('div')
      controlContainer.style.position = 'absolute'
      controlContainer.style.top = '6px'
      controlContainer.style.right = '8px'
      controlContainer.style.zIndex = '10'

      // Add to the pre tag
      node.appendChild(controlContainer)

      // Create React root and render the control
      const root = createRoot(controlContainer)
      root.render(
        <CodeBlockControl
          language={language}
          onLanguageChange={(newLang) => handleLanguageChange(id, newLang)}
        />
      )

      rootsRef.current.set(id, root)
    })

    // Cleanup function
    return () => {
      rootsRef.current.forEach((root) => root.unmount())
      rootsRef.current.clear()
    }
  }, [html])

  const handleLanguageChange = (blockId: string, newLanguage: string) => {
    if (!onContentChange || !originalMarkdown) return

    // Find the code block in the markdown by counting blocks
    const blockIndex = parseInt(blockId.replace('code-block-', ''))

    // Match complete code blocks (opening ``` to closing ```)
    // This ensures we only match opening fences, not closing ones
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)\n```/g
    const matches = Array.from(originalMarkdown.matchAll(codeBlockRegex))

    if (matches[blockIndex]) {
      const match = matches[blockIndex]
      const start = match.index!
      const oldLang = match[1] // The captured language (or empty string)
      const codeContent = match[2] // The code content

      // Replace just the opening fence with the new language
      const before = originalMarkdown.substring(0, start)
      const after = originalMarkdown.substring(start + match[0].length)
      const newMarkdown = `${before}\`\`\`${newLanguage}\n${codeContent}\n\`\`\`${after}`

      onContentChange(newMarkdown)
    }
  }

  return (
    <div
      ref={containerRef}
      className="prose-theme"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
