'use client'

import { useState, useEffect } from 'react'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeReact from 'rehype-react'
import * as prod from 'react/jsx-runtime'
import type { MarkdownContext } from '@/lib/markdown'
import { CodeBlock } from './code-block'
import { ImageWithResize } from './image-with-resize'
import { ExcalidrawImage } from './excalidraw-image'
import { Heading } from './heading'
import { MathBlock } from './math-block'
import { remarkFileResolver } from '@/lib/remark-plugins/file-resolver'
import { remarkImageAttributes } from '@/lib/remark-plugins/image-attributes'
import { rehypeShikiHighlight } from '@/lib/rehype-plugins/shiki-highlight'
import { visit } from 'unist-util-visit'
import type { Node, Parent } from 'unist'
import { useTheme } from 'next-themes'

interface MarkdownRendererProps {
  content: string
  context?: MarkdownContext
}

export function MarkdownRenderer({ content, context }: MarkdownRendererProps) {
  const [renderedContent, setRenderedContent] = useState<React.ReactNode>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    const processContent = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // Build the processing pipeline
        const processor = unified()
          .use(remarkParse)
          .use(remarkGfm)
          .use(remarkMath)
          .use(remarkFileResolver, { fileList: context?.fileList })
          .use(remarkImageAttributes)
          // Custom transformer for Excalidraw
          .use(() => (tree) => {
            // Process Excalidraw references
            processExcalidrawNodes(tree, context)
          })
          .use(remarkRehype, { allowDangerousHtml: true })
          // Add Shiki syntax highlighting
          .use(rehypeShikiHighlight, { theme: (resolvedTheme as 'light' | 'dark') || 'light' })
          // Convert to React
          .use(rehypeReact, {
            // @ts-expect-error - rehype-react types are complex
            jsx: prod.jsx,
            jsxs: prod.jsxs,
            Fragment: prod.Fragment,
            components: {
              // Custom components
              pre: PreComponent,
              code: CodeComponent,
              img: ImageComponent,
              h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading level={1} {...props} />,
              h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading level={2} {...props} />,
              h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading level={3} {...props} />,
              h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading level={4} {...props} />,
              h5: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading level={5} {...props} />,
              h6: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading level={6} {...props} />,
              // Math components
              span: MathSpanComponent,
              div: DivComponent,
            },
          })

        const result = await processor.process(content)
        setRenderedContent(result.result)
      } catch (err) {
        console.error('Markdown rendering error:', err)
        setError(String(err))
      } finally {
        setIsLoading(false)
      }
    }

    processContent()
  }, [content, context, resolvedTheme])

  if (isLoading) {
    return (
      <div className="markdown-content prose dark:prose-invert max-w-none">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-muted rounded w-3/4"></div>
          <div className="h-4 bg-muted rounded w-1/2"></div>
          <div className="h-4 bg-muted rounded w-5/6"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-destructive p-4 border border-destructive rounded-md">
        <p className="font-semibold">Markdown Rendering Error</p>
        <p className="text-sm mt-2">{error}</p>
      </div>
    )
  }

  return <div className="markdown-content prose dark:prose-invert max-w-none">{renderedContent}</div>
}

// Component wrappers
function PreComponent({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  // Check if this is a code block
  const codeChild = Array.isArray(children) ? children[0] : children
  const childProps = typeof codeChild === 'object' && codeChild !== null && 'props' in codeChild ? codeChild.props as Record<string, unknown> : null
  if (childProps?.className && typeof childProps.className === 'string' && childProps.className.startsWith('language-')) {
    // Let the CodeBlock handle both pre and code
    return <>{children}</>
  }
  return <pre {...props}>{children}</pre>
}

function CodeComponent({ children, className, ...props }: React.HTMLAttributes<HTMLElement> & { className?: string }) {
  const match = /language-(\w+)/.exec(className || '')
  const language = match ? match[1] : undefined

  // Inline code
  if (!language) {
    return (
      <code className="px-1.5 py-0.5 rounded bg-muted text-sm font-mono" {...props}>
        {children}
      </code>
    )
  }

  // Block code
  const code = String(children).replace(/\n$/, '')
  return <CodeBlock language={language} className={className}>{code}</CodeBlock>
}

function ImageComponent({ src, alt, title, style, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  // Check if this is an Excalidraw image
  const dataExcalidraw = (props as Record<string, unknown>)['data-excalidraw'] as string | undefined
  if (dataExcalidraw) {
    return (
      <ExcalidrawImage
        lightSrc={(props as Record<string, unknown>)['data-light-src'] as string || src || ''}
        darkSrc={(props as Record<string, unknown>)['data-dark-src'] as string || src || ''}
        alt={alt}
        filename={dataExcalidraw}
      />
    )
  }

  // Regular image with resize
  return (
    <ImageWithResize
      src={src || ''}
      alt={alt}
      title={title}
      style={style}
    />
  )
}

function MathSpanComponent({ className, children, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  if (className === 'math math-inline') {
    return <MathBlock inline>{String(children)}</MathBlock>
  }
  return <span className={className} {...props}>{children}</span>
}

function DivComponent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const divProps = props as Record<string, unknown>

  // Handle math blocks
  if (className === 'math math-display') {
    return <MathBlock>{String(children)}</MathBlock>
  }

  // Handle Shiki-highlighted code blocks
  if (divProps['data-highlighted'] === 'true' || divProps['data-highlighted'] === true) {
    // Shiki-highlighted code - just render the div with its children (the HTML is already there)
    return (
      <div className="relative group my-4">
        <div className={className} {...props}>
          {children}
        </div>
      </div>
    )
  }

  return <div className={className} {...props}>{children}</div>
}

// Helper to process Excalidraw nodes in the AST
interface FileInfo {
  id: string
  name: string
  url?: string
  isDirectory?: boolean
}

interface TextNode extends Node {
  type: 'text'
  value: string
}

interface HtmlNode extends Node {
  type: 'html'
  value: string
}

function processExcalidrawNodes(tree: Node, context?: MarkdownContext) {
  const { fileList = [] } = context || {}

  visit(tree, 'text', (node, index, parent) => {
    if (!parent || index === null || index === undefined) return

    const textNode = node as TextNode
    const text = textNode.value
    const excalidrawPattern = /!\[\[([^\]]+\.excalidraw)\]\]/g

    if (!excalidrawPattern.test(text)) return

    const parts: (TextNode | HtmlNode)[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    excalidrawPattern.lastIndex = 0

    while ((match = excalidrawPattern.exec(text)) !== null) {
      const filename = match[1]
      const matchIndex = match.index

      // Add text before match
      if (matchIndex > lastIndex) {
        parts.push({
          type: 'text',
          value: text.substring(lastIndex, matchIndex),
        } as TextNode)
      }

      // Find both light and dark SVG files
      const lightSvgFilename = `${filename}.light.svg`
      const darkSvgFilename = `${filename}.dark.svg`

      const findFile = (name: string) => {
        let file = fileList.find((f: FileInfo) => !f.isDirectory && f.name === name)
        if (!file) {
          const basename = name.split('/').pop()
          file = fileList.find((f: FileInfo) => !f.isDirectory && f.name.split('/').pop() === basename)
        }
        return file
      }

      const lightSvgFile = findFile(lightSvgFilename)
      const darkSvgFile = findFile(darkSvgFilename)

      if (lightSvgFile && darkSvgFile) {
        const cacheBuster = Date.now()
        const lightUrl = `${lightSvgFile.url || `/api/files/${lightSvgFile.id}`}?v=${cacheBuster}`
        const darkUrl = `${darkSvgFile.url || `/api/files/${darkSvgFile.id}`}?v=${cacheBuster}`

        // Create HTML node with data attributes for ExcalidrawImage component
        parts.push({
          type: 'html',
          value: `<img src="${lightUrl}" alt="${filename.replace('.excalidraw', '')}" data-excalidraw="${filename}" data-light-src="${lightUrl}" data-dark-src="${darkUrl}" />`,
        } as HtmlNode)
      } else {
        const missing = []
        if (!lightSvgFile) missing.push('light')
        if (!darkSvgFile) missing.push('dark')
        parts.push({
          type: 'text',
          value: `[Drawing not found: ${filename} (missing ${missing.join(' and ')} variant)]`,
        } as TextNode)
      }

      lastIndex = matchIndex + match[0].length
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push({
        type: 'text',
        value: text.substring(lastIndex),
      } as TextNode)
    }

    if (parts.length > 0 && 'children' in parent) {
      (parent as Parent).children.splice(index, 1, ...parts)
    }
  })
}
