'use client'

import { useState, useEffect, useLayoutEffect, useRef, createContext, useContext } from 'react'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeReact from 'rehype-react'
import * as prod from 'react/jsx-runtime'
import type { MarkdownContext } from '@/lib/markdown'
import { CodeMirrorCodeBlock } from './codemirror-code-block'
import { ImageWithResize } from './image-with-resize'
import { ExcalidrawImage } from './excalidraw-image'
import { Heading } from './heading'
import { MathBlock } from './math-block'
import { CodeEditor } from '@/components/public/code-editor'
import { remarkFileResolver } from '@/lib/remark-plugins/file-resolver'
import { remarkImageAttributes } from '@/lib/remark-plugins/image-attributes'
import { remarkCodeEditor } from '@/lib/remark-plugins/code-editor'
import { rehypeCodemirrorHighlight } from '@/lib/rehype-plugins/codemirror-highlight'
import { rehypeWrapSections } from '@/lib/rehype-plugins/wrap-sections'
import rehypeSlug from 'rehype-slug'
import { useTheme } from 'next-themes'

// Context for passing content, callback, and markdown context down to components
const MarkdownEditContext = createContext<{
  content: string
  onContentChange?: (newContent: string) => void
  markdownContext?: MarkdownContext
}>({ content: '' })

interface MarkdownRendererProps {
  content: string
  context?: MarkdownContext
  onContentChange?: (newContent: string) => void
}

export function MarkdownRenderer({ content, context, onContentChange }: MarkdownRendererProps) {
  const [renderedContent, setRenderedContent] = useState<React.ReactNode>(null)
  const [error, setError] = useState<string | null>(null)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const { resolvedTheme } = useTheme()
  const scrollPositionRef = useRef(0)
  const hasRestoredScroll = useRef(false)

  // Capture scroll position before any DOM changes
  useLayoutEffect(() => {
    const scrollContainer = document.getElementById('markdown-preview-scroll-container')
    if (scrollContainer) {
      scrollPositionRef.current = scrollContainer.scrollTop
    }
  })

  useEffect(() => {
    const processContent = async () => {
      try {
        setError(null)

        // Build the processing pipeline
        const processor = unified()
          .use(remarkParse)
          .use(remarkGfm)
          .use(remarkMath)
          .use(remarkFileResolver, { fileList: context?.fileList })
          .use(remarkImageAttributes)
          .use(remarkCodeEditor) // Convert code blocks with "editor" meta to interactive editors
          .use(remarkRehype, { allowDangerousHtml: true }) // Need allowDangerousHtml for custom elements
          // Add IDs to headings (needed for sections)
          .use(rehypeSlug)
          // Wrap headings + content into sections for annotations
          .use(rehypeWrapSections)
          // Add KaTeX math rendering
          .use(rehypeKatex)
          // Add CodeMirror syntax highlighting
          .use(rehypeCodemirrorHighlight)
          // Convert to React
          .use(rehypeReact, {
            jsx: prod.jsx,
            jsxs: prod.jsxs,
            Fragment: prod.Fragment,
            components: {
              // Custom components
              pre: PreComponent,
              code: CodeComponent,
              img: ImageComponent,
              'code-editor': CodeEditorComponent,
              h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading level={1} {...props} />,
              h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading level={2} {...props} />,
              h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading level={3} {...props} />,
              h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading level={4} {...props} />,
              h5: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading level={5} {...props} />,
              h6: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading level={6} {...props} />,
              // Section wrapper for annotations (with position: relative for canvas overlays)
              section: (props: React.HTMLAttributes<HTMLElement>) => (
                <section
                  {...props}
                  style={{
                    position: 'relative',
                    paddingBottom: '2rem', // Spacing between sections (replaces heading margin-top)
                    ...props.style
                  }}
                >
                  {props.children}
                </section>
              ),
              // Div component for CodeMirror code blocks (rehypeKatex handles math automatically)
              div: DivComponent,
            },
          })

        const result = await processor.process(content)
        setRenderedContent(result.result)
        setIsInitialLoad(false)
        hasRestoredScroll.current = false
      } catch (err) {
        console.error('Markdown rendering error:', err)
        setError(String(err))
        setIsInitialLoad(false)
      }
    }

    processContent()
  }, [content, context, resolvedTheme])

  // Restore scroll position after DOM updates
  useLayoutEffect(() => {
    if (!hasRestoredScroll.current && renderedContent) {
      const scrollContainer = document.getElementById('markdown-preview-scroll-container')
      if (scrollContainer && scrollPositionRef.current > 0) {
        scrollContainer.scrollTop = scrollPositionRef.current
        hasRestoredScroll.current = true
      }
    }
  }, [renderedContent])

  if (isInitialLoad && !renderedContent) {
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

  return (
    <MarkdownEditContext.Provider value={{ content, onContentChange, markdownContext: context }}>
      {renderedContent}
    </MarkdownEditContext.Provider>
  )
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
  return <CodeMirrorCodeBlock language={language} className={className}>{code}</CodeMirrorCodeBlock>
}

function ImageComponent({ src, alt, title, style, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const { content, onContentChange } = useContext(MarkdownEditContext)

  // Get the original source filename (before resolution)
  const originalSrc = ((props as Record<string, unknown>)['data-original-src'] as string) ||
                      ((props as Record<string, unknown>)['dataOriginalSrc'] as string)

  // Handler for width changes from resize (defined before use)
  const handleWidthChange = (newMarkdown: string) => {
    if (!onContentChange) return

    // Use original source for pattern matching (the filename in markdown, not the resolved URL)
    const srcForMatching = originalSrc || src
    if (!srcForMatching || typeof srcForMatching !== 'string') return

    // Find the image markdown in the content and replace it
    // Look for ![alt](src) or ![alt](src){width=X%}
    const escapedSrc = srcForMatching.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const imagePattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedSrc}\\)(\\{[^}]*\\})?`, 'g')

    const newContent = content.replace(imagePattern, newMarkdown)

    if (newContent !== content) {
      onContentChange(newContent)
    }
  }

  // Check if this is an Excalidraw image from data attributes (set by file-resolver)
  const dataExcalidraw = (props as Record<string, unknown>)['data-excalidraw'] as string | undefined
  if (dataExcalidraw) {
    const lightSrc = (props as Record<string, unknown>)['data-light-src'] as string
    const darkSrc = (props as Record<string, unknown>)['data-dark-src'] as string

    // Get alignment from data attributes
    const dataAlignExcalidraw = ((props as Record<string, unknown>)['data-align'] as string) ||
                                ((props as Record<string, unknown>)['dataAlign'] as string) ||
                                'center'

    // Get wrap from data attributes
    const dataWrapExcalidraw = ((props as Record<string, unknown>)['data-wrap'] as string) ||
                               ((props as Record<string, unknown>)['dataWrap'] as string)

    return (
      <ExcalidrawImage
        lightSrc={lightSrc || (typeof src === 'string' ? src : '') || ''}
        darkSrc={darkSrc || (typeof src === 'string' ? src : '') || ''}
        alt={alt}
        filename={dataExcalidraw}
        style={style}
        align={dataAlignExcalidraw as 'left' | 'center' | 'right'}
        wrap={dataWrapExcalidraw === 'true'}
        onWidthChange={onContentChange ? handleWidthChange : undefined}
      />
    )
  }

  // Get alignment from data attributes
  const dataAlign = ((props as Record<string, unknown>)['data-align'] as string) ||
                    ((props as Record<string, unknown>)['dataAlign'] as string) ||
                    'center'

  // Get wrap from data attributes
  const dataWrap = ((props as Record<string, unknown>)['data-wrap'] as string) ||
                   ((props as Record<string, unknown>)['dataWrap'] as string)

  // Regular image with resize
  return (
    <ImageWithResize
      src={typeof src === 'string' ? src : ''}
      alt={alt}
      title={title}
      style={style}
      originalSrc={originalSrc}
      align={dataAlign as 'left' | 'center' | 'right'}
      wrap={dataWrap === 'true'}
      onWidthChange={onContentChange ? handleWidthChange : undefined}
    />
  )
}

function DivComponent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const divProps = props as Record<string, unknown>
  const { content, onContentChange } = useContext(MarkdownEditContext)

  // Handle CodeMirror-highlighted code blocks
  if (divProps['data-codemirror'] === 'true' || divProps['data-codemirror'] === true) {
    const language = (divProps['data-language'] as string) || 'text'
    const rawCode = (divProps['data-raw-code'] as string) || ''
    const annotationsJson = (divProps['data-annotations'] as string) || '[]'

    let lineAnnotations: any[] = []
    try {
      lineAnnotations = JSON.parse(annotationsJson)
    } catch (e) {
      console.error('Failed to parse line annotations:', e)
    }

    // Handler for language change
    const handleLanguageChange = (newLanguage: string) => {
      if (!onContentChange) return

      // Simple fallback: just replace the language tag
      const newContent = content.replace(
        new RegExp(`\`\`\`${language}\\b`, 'g'),
        `\`\`\`${newLanguage}`
      )

      if (newContent !== content) {
        onContentChange(newContent)
      }
    }

    // Use the CodeMirrorCodeBlock component
    return (
      <CodeMirrorCodeBlock
        language={language}
        lineAnnotations={lineAnnotations}
        onLanguageChange={onContentChange ? handleLanguageChange : undefined}
      >
        {rawCode}
      </CodeMirrorCodeBlock>
    )
  }

  return <div className={className} {...props}>{children}</div>
}

function CodeEditorComponent({ children, ...props }: React.HTMLAttributes<HTMLElement> & Record<string, unknown>) {
  const { resolvedTheme } = useTheme()
  const language = (props['dataLanguage'] as string) || (props['data-language'] as string) || 'python'
  const code = (props['dataCode'] as string) || (props['data-code'] as string) || ''
  const id = (props['dataId'] as string) || (props['data-id'] as string)
  const showCanvas = (props['dataShowCanvas'] as string) || (props['data-show-canvas'] as string)

  // Decode HTML entities
  const decodedCode = decodeHtmlEntities(code)

  return (
    <CodeEditor
      key={`${id}-${resolvedTheme}`}
      id={id}
      language={language as 'python' | 'javascript'}
      initialCode={decodedCode}
      showCanvas={showCanvas !== 'false'}
    />
  )
}

function decodeHtmlEntities(text: string): string {
  const map: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#039;': "'"
  }
  let result = text
  for (const [entity, char] of Object.entries(map)) {
    result = result.replace(new RegExp(entity, 'g'), char)
  }
  return result
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
