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
import { rehypeSourceLine } from '@/lib/rehype-plugins/source-line'
import rehypeSlug from 'rehype-slug'
import { useTheme } from 'next-themes'

// Context for passing content, callback, and markdown context down to components
const MarkdownEditContext = createContext<{
  content: string
  onContentChange?: (newContent: string) => void
  markdownContext?: MarkdownContext
}>({ content: '' })

// Component wrapper functions (defined before MarkdownRenderer)
function PreComponent({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const codeChild = Array.isArray(children) ? children[0] : children
  const childProps = typeof codeChild === 'object' && codeChild !== null && 'props' in codeChild ? codeChild.props as Record<string, unknown> : null
  if (childProps?.className && typeof childProps.className === 'string' && childProps.className.startsWith('language-')) {
    return <>{children}</>
  }
  return <pre {...props}>{children}</pre>
}

function CodeComponent({ children, className, ...props }: React.HTMLAttributes<HTMLElement> & { className?: string }) {
  const match = /language-(\w+)/.exec(className || '')
  const language = match ? match[1] : undefined

  if (!language) {
    return (
      <code className="px-1.5 py-0.5 rounded bg-muted text-sm font-mono" {...props}>
        {children}
      </code>
    )
  }

  const code = String(children).replace(/\n$/, '')
  return <CodeMirrorCodeBlock language={language} className={className}>{code}</CodeMirrorCodeBlock>
}

function ImageComponent({ src, alt, title, style, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const { content, onContentChange } = useContext(MarkdownEditContext)

  const originalSrc = ((props as Record<string, unknown>)['data-original-src'] as string) ||
                      ((props as Record<string, unknown>)['dataOriginalSrc'] as string)

  const handleWidthChange = (newMarkdown: string) => {
    if (!onContentChange) return

    const srcForMatching = originalSrc || src
    if (!srcForMatching || typeof srcForMatching !== 'string') return

    const escapedSrc = srcForMatching.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const imagePattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedSrc}\\)(\\{[^}]*\\})?`, 'g')

    const newContent = content.replace(imagePattern, newMarkdown)

    if (newContent !== content) {
      onContentChange(newContent)
    }
  }

  const dataExcalidraw = (props as Record<string, unknown>)['data-excalidraw'] as string | undefined
  if (dataExcalidraw) {
    const lightSrc = (props as Record<string, unknown>)['data-light-src'] as string
    const darkSrc = (props as Record<string, unknown>)['data-dark-src'] as string

    const dataAlignExcalidraw = ((props as Record<string, unknown>)['data-align'] as string) ||
                                ((props as Record<string, unknown>)['dataAlign'] as string) ||
                                'center'

    const dataWrapExcalidraw = ((props as Record<string, unknown>)['data-wrap'] as string) ||
                               ((props as Record<string, unknown>)['dataWrap'] as string)

    return (
      <ExcalidrawImage
        key={`excalidraw-${dataExcalidraw}`}
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

  const dataAlign = ((props as Record<string, unknown>)['data-align'] as string) ||
                    ((props as Record<string, unknown>)['dataAlign'] as string) ||
                    'center'

  const dataWrap = ((props as Record<string, unknown>)['data-wrap'] as string) ||
                   ((props as Record<string, unknown>)['dataWrap'] as string)

  return (
    <ImageWithResize
      key={`image-${originalSrc || src}`}
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

    const handleLanguageChange = (newLanguage: string) => {
      if (!onContentChange) return

      const newContent = content.replace(
        new RegExp(`\`\`\`${language}\\b`, 'g'),
        `\`\`\`${newLanguage}`
      )

      if (newContent !== content) {
        onContentChange(newContent)
      }
    }

    return (
      <div {...props}>
        <CodeMirrorCodeBlock
          language={language}
          lineAnnotations={lineAnnotations}
          onLanguageChange={onContentChange ? handleLanguageChange : undefined}
        >
          {rawCode}
        </CodeMirrorCodeBlock>
      </div>
    )
  }

  return <div className={className} {...props}>{children}</div>
}

// Counter for auto-numbering code editors without explicit IDs
let editorCounter = 0

function CodeEditorComponent({ children, ...props }: React.HTMLAttributes<HTMLElement> & Record<string, unknown>) {
  const { resolvedTheme } = useTheme()
  const { markdownContext } = useContext(MarkdownEditContext)
  const language = (props['dataLanguage'] as string) || (props['data-language'] as string) || 'python'
  const code = (props['dataCode'] as string) || (props['data-code'] as string) || ''
  const providedId = (props['dataId'] as string) || (props['data-id'] as string)
  const showCanvas = (props['dataShowCanvas'] as string) || (props['data-show-canvas'] as string)

  // Auto-assign ID if not provided (counting from 0 for each page)
  const id = providedId || `${editorCounter++}`

  const decodedCode = decodeHtmlEntities(code)

  return (
    <div {...props}>
      <CodeEditor
        key={`${id}-${resolvedTheme}`}
        id={id}
        pageId={markdownContext?.pageId}
        language={language as 'python' | 'javascript'}
        initialCode={decodedCode}
        showCanvas={showCanvas !== 'false'}
      />
    </div>
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

// Stable components object for rehype-react
const rehypeReactComponents = {
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
  section: (props: React.HTMLAttributes<HTMLElement>) => (
    <section
      {...props}
      style={{
        position: 'relative',
        paddingBottom: '2rem',
        ...props.style
      }}
    >
      {props.children}
    </section>
  ),
  div: DivComponent,
}

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

        // Reset editor counter for this page render
        editorCounter = 0

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
          // Add source line markers BEFORE transformations happen
          .use(rehypeSourceLine)
          // Add CodeMirror syntax highlighting (transforms pre -> div, preserves properties)
          .use(rehypeCodemirrorHighlight)
          // Convert to React
          .use(rehypeReact, {
            jsx: prod.jsx,
            jsxs: prod.jsxs,
            Fragment: prod.Fragment,
            components: rehypeReactComponents,
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
