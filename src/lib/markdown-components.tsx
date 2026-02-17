/**
 * Markdown Components Factory
 *
 * Creates React components for markdown rendering with SkriptFiles bound for file resolution.
 * This is the single source of truth for component definitions.
 */

import React, { type ComponentType, type ReactNode, Children, isValidElement } from 'react'
import Image from 'next/image'
import type { SkriptFilesData } from './skript-files'
import { resolveFile, resolveUrl, resolveExcalidraw } from './skript-files'
import { CodeEditor } from '@/components/public/code-editor'
import { Tabs, TabItem } from '@/components/markdown/tabs'
import { Youtube } from '@/components/markdown/youtube'
import { MuxVideo } from '@/components/markdown/mux-video'
import { ExcalidrawImage } from '@/components/markdown/excalidraw-image'
import { ContentImage } from '@/components/markdown/content-image'
import { Question, Option } from '@/components/markdown/quiz'
import { Callout } from '@/components/markdown/callout'
import { CodeBlock } from '@/components/markdown/code-block'
import { OurTeachers } from '@/components/markdown/our-teachers'
import { DemoEditor } from '@/components/demo/demo-editor'
import { ColorSliders } from '@/components/markdown/color-sliders'
import { StickMe } from '@/components/markdown/stick-me'
import { DijkstraVisualizer } from '@/components/markdown/dijkstra-visualizer'
import { ColorTitleHeading } from '@/components/markdown/color-title-heading'
import { YT } from '@/components/markdown/youtube'
import { ModCalc } from '@/components/markdown/mod-calc'
import { DataCubeVisualizer } from '@/components/markdown/data-cube-visualizer'
import { Flex, FlexItem } from '@/components/markdown/flex'

// Simple hash function for generating stable IDs
function hashCode(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
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

// Pre component - passes through code children
function PreComponent({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const codeChild = Array.isArray(children) ? children[0] : children
  const childProps = typeof codeChild === 'object' && codeChild !== null && 'props' in codeChild
    ? codeChild.props as Record<string, unknown>
    : null
  if (childProps?.className && typeof childProps.className === 'string' && childProps.className.startsWith('language-')) {
    return <>{children}</>
  }
  return <pre {...props}>{children}</pre>
}

// Code component - renders inline code or code blocks with CodeMirror
function CodeComponent({ children, className, ...props }: React.HTMLAttributes<HTMLElement> & { className?: string }) {
  const match = /language-(\w+)/.exec(className || '')
  const language = match ? match[1] : undefined

  if (!language) {
    // Inline code
    return (
      <code className="px-[0.4em] py-[0.2em] rounded bg-muted font-mono text-[0.9em]" {...props}>
        {children}
      </code>
    )
  }

  // Extract code string from children
  const extractCode = (node: ReactNode): string => {
    if (typeof node === 'string') return node
    if (typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(extractCode).join('')
    if (isValidElement(node)) {
      const nodeProps = node.props as { children?: ReactNode }
      if (nodeProps.children) {
        return extractCode(nodeProps.children)
      }
    }
    return ''
  }

  const code = extractCode(children)

  // Use CodeMirror-based CodeBlock for syntax highlighting
  return <CodeBlock code={code} language={language} />
}

// Heading factory
function createHeading(level: 1 | 2 | 3 | 4 | 5 | 6) {
  const Tag = `h${level}` as const
  return function HeadingComponent({ children, id, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
    // Use ColorTitleHeading for h1 to handle inline code elements correctly
    if (level === 1) {
      return <ColorTitleHeading id={id}>{children}</ColorTitleHeading>
    }

    return (
      <Tag id={id} {...props}>
        {id ? (
          <a href={`#${id}`} className="heading-link no-underline hover:underline">
            {children}
          </a>
        ) : (
          children
        )}
      </Tag>
    )
  }
}

// Blockquote component - uses client Callout for interactive callouts
function BlockquoteComponent({ children, className, ...props }: React.HTMLAttributes<HTMLQuoteElement>) {
  const isCallout = className?.includes('callout')

  if (!isCallout) {
    return <blockquote className={className} {...props}>{children}</blockquote>
  }

  const calloutTypeMatch = className?.match(/callout-(\w+)/)
  const calloutType = calloutTypeMatch?.[1]
  const isFoldable = className?.includes('callout-foldable')
  const initiallyFolded = className?.includes('callout-folded')

  // Extract data-section-id from props (added by rehype plugin for annotation alignment)
  const sectionId = (props as Record<string, unknown>)['data-section-id'] as string | undefined

  return (
    <Callout
      className={className}
      type={calloutType}
      isFoldable={isFoldable}
      initiallyFolded={initiallyFolded}
      sectionId={sectionId}
    >
      {children}
    </Callout>
  )
}

interface CreateMarkdownComponentsOptions {
  pageId?: string
  onContentChange?: (newContent: string) => void
  content?: string  // For editor mode, to find/replace content
  organizationSlug?: string  // For organization pages (OurTeachers component)
  onExcalidrawEdit?: (filename: string, fileId: string) => void  // Callback to edit Excalidraw drawings
  optimizeImages?: boolean  // Enable Next.js Image optimization (only safe for public pages)
}

/**
 * Create markdown components with SkriptFilesData bound for file resolution.
 *
 * @param files - The SkriptFilesData object (serializable) for resolving file URLs
 * @param options - Optional settings like pageId for interactive components
 */
export function createMarkdownComponents(
  files: SkriptFilesData,
  options?: CreateMarkdownComponentsOptions
): Record<string, ComponentType<any>> {
  const { pageId, onContentChange, content, organizationSlug, onExcalidrawEdit, optimizeImages } = options ?? {}

  // Img element handler - handles <img> elements from markdown with data-* attributes
  function ImgElementComponent({ src, alt, title, style, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
    const dataProps = props as Record<string, unknown>

    // Extract source line tracking for editor highlight sync
    // Check both kebab-case (from HTML) and camelCase formats
    const sourceLineStart = (dataProps['data-source-line-start'] as string) || (dataProps['dataSourceLineStart'] as string) || undefined
    const sourceLineEnd = (dataProps['data-source-line-end'] as string) || (dataProps['dataSourceLineEnd'] as string) || undefined

    // Check for excalidraw-image custom element
    const dataExcalidraw = dataProps['data-excalidraw'] as string | undefined
    if (dataExcalidraw) {
      const dataAlign = (dataProps['data-align'] as string) || 'center'
      const dataWrap = dataProps['data-wrap'] as string

      return (
        <ExcalidrawImage
          key={`excalidraw-${dataExcalidraw}`}
          src={dataExcalidraw}
          alt={alt}
          style={style}
          align={dataAlign as 'left' | 'center' | 'right'}
          wrap={dataWrap === 'true'}
          files={files}
          onWidthChange={onContentChange ? (markdown) => handleImageWidthChange(dataExcalidraw, markdown) : undefined}
          onEdit={onExcalidrawEdit}
          sourceLineStart={sourceLineStart}
          sourceLineEnd={sourceLineEnd}
        />
      )
    }

    // Regular image
    const originalSrc = (dataProps['data-original-src'] as string) || (dataProps['dataOriginalSrc'] as string)
    const dataAlign = (dataProps['data-align'] as string) || (dataProps['dataAlign'] as string) || 'center'
    const dataWrap = (dataProps['data-wrap'] as string) || (dataProps['dataWrap'] as string)
    const dataInvert = (dataProps['data-invert'] as string) || (dataProps['dataInvert'] as string)
    const dataSaturate = (dataProps['data-saturate'] as string) || (dataProps['dataSaturate'] as string)

    const srcStr = typeof src === 'string' ? src : ''

    return (
      <ContentImage
        key={`image-${originalSrc || src}`}
        src={srcStr}
        alt={alt}
        title={title}
        style={style}
        originalSrc={originalSrc}
        align={dataAlign as 'left' | 'center' | 'right'}
        wrap={dataWrap === 'true'}
        invert={dataInvert as 'dark' | 'light' | 'always' | undefined}
        saturate={dataSaturate}
        files={files}
        optimizeImages={optimizeImages}
        onWidthChange={onContentChange ? (markdown) => handleImageWidthChange(originalSrc || srcStr, markdown) : undefined}
        sourceLineStart={sourceLineStart}
        sourceLineEnd={sourceLineEnd}
      />
    )
  }

  // Handle image width change in editor mode
  function handleImageWidthChange(srcForMatching: string, newMarkdown: string) {
    if (!onContentChange || !content || !srcForMatching) return

    const escapedSrc = srcForMatching.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Also match without .excalidraw extension for <excali> component
    const baseName = srcForMatching.replace(/\.excalidraw$/, '')
    const escapedBaseName = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // Match <image>, <Image> (legacy), and <excali> components
    const imageComponentPattern = new RegExp(`<[Ii]mage[^>]*src="${escapedSrc}"[^>]*/?>`, 'g')
    const excaliPattern = new RegExp(`<excali[^>]*src="${escapedBaseName}"[^>]*/?>`, 'g')
    const markdownPattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedSrc}\\)(\\{[^}]*\\})?`, 'g')

    let newContent = content
    if (excaliPattern.test(content)) {
      newContent = content.replace(excaliPattern, newMarkdown)
    } else if (imageComponentPattern.test(content)) {
      newContent = content.replace(imageComponentPattern, newMarkdown)
    } else {
      newContent = content.replace(markdownPattern, newMarkdown)
    }

    if (newContent !== content) {
      onContentChange(newContent)
    }
  }

  // Code editor component
  function CodeEditorComponent({ children, ...props }: React.HTMLAttributes<HTMLElement> & Record<string, unknown>) {
    const language = (props['dataLanguage'] as string) || (props['data-language'] as string) || 'python'
    const code = (props['dataCode'] as string) || (props['data-code'] as string) || ''
    const providedId = (props['dataId'] as string) || (props['data-id'] as string)
    const showCanvas = (props['dataShowCanvas'] as string) || (props['data-show-canvas'] as string)
    const db = (props['dataDb'] as string) || (props['data-db'] as string)
    const schemaImage = (props['dataSchemaImage'] as string) || (props['data-schema-image'] as string)
    const single = (props['dataSingle'] as string) || (props['data-single'] as string)

    const id = providedId || `editor-${hashCode(code)}-${language}`
    const decodedCode = decodeHtmlEntities(code)

    // Resolve database file URL
    let dbUrl: string | undefined
    let schemaImageUrl: string | undefined
    let schemaImageDarkUrl: string | undefined

    if (db && language === 'sql') {
      // Try to find file with this name (with or without extension)
      const dbBasename = db.replace(/\.(sqlite|db)$/i, '')
      const dbFile = resolveFile(files, db) || resolveFile(files, `${dbBasename}.db`) || resolveFile(files, `${dbBasename}.sqlite`)
      // Add proxy=true to avoid CORS issues (S3 redirect fails cross-origin fetch)
      if (dbFile?.url) {
        const separator = dbFile.url.includes('?') ? '&' : '?'
        dbUrl = `${dbFile.url}${separator}proxy=true`
      }

      // Auto-detect schema image (Excalidraw with light/dark variants)
      if (!schemaImage && db) {
        // Pattern: database-schema.excalidraw
        const excalidraw = resolveExcalidraw(files, `${dbBasename}-schema.excalidraw`)
        if (excalidraw) {
          schemaImageUrl = excalidraw.lightUrl
          schemaImageDarkUrl = excalidraw.darkUrl
        }
      } else if (schemaImage) {
        // Manual schema-image attribute - try to find Excalidraw or plain SVG
        const excalidraw = resolveExcalidraw(files, `${schemaImage}.excalidraw`)
        if (excalidraw) {
          schemaImageUrl = excalidraw.lightUrl
          schemaImageDarkUrl = excalidraw.darkUrl
        } else {
          // Fallback to plain SVG (no dark variant)
          const schemaFile = resolveFile(files, `${schemaImage}.svg`) || resolveFile(files, schemaImage)
          schemaImageUrl = schemaFile?.url
        }
      }
    }

    return (
      <div {...props}>
        <CodeEditor
          key={id}
          id={id}
          pageId={pageId}
          language={language as 'python' | 'javascript' | 'sql'}
          initialCode={decodedCode}
          showCanvas={showCanvas !== 'false'}
          db={dbUrl}
          schemaImage={schemaImageUrl}
          schemaImageDark={schemaImageDarkUrl}
          singleFile={single === 'true'}
        />
      </div>
    )
  }

  // Mux video component - passes files through
  function MuxVideoComponent({ ...props }: React.HTMLAttributes<HTMLElement> & Record<string, unknown>) {
    const src = (props['src'] as string) || ''
    const alt = (props['alt'] as string) || ''

    return (
      <span className="block my-6">
        <MuxVideo
          src={src}
          alt={alt}
          files={files}
          className="w-full rounded-lg overflow-hidden"
        />
        {alt && !alt.includes('autoplay') && !alt.includes('loop') && (
          <span className="block text-center text-sm text-muted-foreground mt-2">
            {alt}
          </span>
        )}
      </span>
    )
  }

  // Excalidraw image component (for custom element from remark plugin) - passes files through
  function ExcalidrawImageComponent({ ...props }: React.HTMLAttributes<HTMLElement> & Record<string, unknown>) {
    const src = (props['src'] as string) || ''
    const alt = (props['alt'] as string) || ''
    const dataAlign = (props['data-align'] as string) || 'center'
    const dataWrap = (props['data-wrap'] as string)
    // Check both kebab-case (from HTML) and camelCase formats
    const sourceLineStart = (props['data-source-line-start'] as string) || (props['dataSourceLineStart'] as string) || undefined
    const sourceLineEnd = (props['data-source-line-end'] as string) || (props['dataSourceLineEnd'] as string) || undefined

    return (
      <ExcalidrawImage
        src={src}
        alt={alt}
        align={dataAlign as 'left' | 'center' | 'right'}
        wrap={dataWrap === 'true'}
        files={files}
        onWidthChange={onContentChange ? (markdown) => handleImageWidthChange(src, markdown) : undefined}
        onEdit={onExcalidrawEdit}
        sourceLineStart={sourceLineStart}
        sourceLineEnd={sourceLineEnd}
      />
    )
  }

  // Youtube embed component
  function YoutubeEmbedComponent({ ...props }: React.HTMLAttributes<HTMLElement> & Record<string, unknown>) {
    const id = (props['data-id'] as string) || (props['dataId'] as string) || ''
    const playlist = (props['data-playlist'] as string) || (props['dataPlaylist'] as string) || ''
    const startTimeStr = (props['data-start-time'] as string) || (props['dataStartTime'] as string) || ''
    const startTime = startTimeStr ? parseInt(startTimeStr, 10) : undefined

    return (
      <Youtube
        id={id || undefined}
        playlist={playlist || undefined}
        startTime={startTime}
      />
    )
  }

  // Tabs container component - renders tabs UI directly from HTML children
  // We can't use the Tabs component here because element.type comparison fails
  // between server and client bundles
  function TabsContainerComponent({ children, ...props }: React.HTMLAttributes<HTMLElement> & Record<string, unknown>) {
    const dataItems = (props['data-items'] as string) || (props['dataItems'] as string) || '[]'
    let items: string[] = []
    try {
      items = JSON.parse(dataItems)
    } catch {
      console.error('Failed to parse tabs items:', dataItems)
    }

    // Collect tab contents from children (tab-item elements)
    const tabContents: ReactNode[] = []
    Children.forEach(children, (child) => {
      if (isValidElement(child)) {
        // Each child is a tab-item element, get its children
        const childProps = child.props as { children?: ReactNode }
        tabContents.push(childProps.children)
      }
    })

    if (items.length === 0 || tabContents.length === 0) {
      return <>{children}</>
    }

    // Use the Tabs component with pre-extracted content
    return (
      <Tabs items={items} tabContents={tabContents} />
    )
  }

  // Quiz components
  function QuizQuestionComponent({ children, ...props }: React.HTMLAttributes<HTMLElement> & Record<string, unknown>) {
    const id = (props['id'] as string) || ''
    const type = ((props['type'] as string) || 'multiple') as 'single' | 'multiple' | 'text' | 'number' | 'range'
    const showFeedback = props['showFeedback'] !== false && props['showfeedback'] !== 'false'
    const allowUpdate = props['allowUpdate'] === true || props['allowUpdate'] === 'true' || props['allowupdate'] === 'true'
    const minValue = props['minValue'] !== undefined ? Number(props['minValue']) : (props['minvalue'] !== undefined ? Number(props['minvalue']) : undefined)
    const maxValue = props['maxValue'] !== undefined ? Number(props['maxValue']) : (props['maxvalue'] !== undefined ? Number(props['maxvalue']) : undefined)
    const step = props['step'] !== undefined ? Number(props['step']) : undefined

    // Don't render quiz if pageId is missing (e.g., in dashboard preview without context)
    if (!pageId) {
      return (
        <div className="border rounded-lg p-4 bg-muted/50 text-muted-foreground text-sm">
          Quiz preview unavailable (no page context)
        </div>
      )
    }

    return (
      <Question
        id={id}
        pageId={pageId}
        type={type}
        showFeedback={showFeedback}
        allowUpdate={allowUpdate}
        minValue={minValue}
        maxValue={maxValue}
        step={step}
      >
        {children}
      </Question>
    )
  }

  // QuizOptionComponent - wrapper that preserves props for parent Question to read
  // Note: uses "correct" instead of "is" because "is" is a reserved React attribute
  function QuizOptionComponent({ children, correct, is, feedback }: React.HTMLAttributes<HTMLElement> & { correct?: string; is?: string; feedback?: string }) {
    // Return an Option component that the Question can read props from
    // Support both "correct" (new) and "is" (legacy) attribute names
    const isValue = correct || is
    return <Option is={isValue as 'true' | 'false' | undefined} feedback={feedback}>{children}</Option>
  }

  // Image component - for use as <Image src="..." /> in markdown
  interface ImageComponentProps {
    src: string
    alt?: string
    width?: string
    align?: 'left' | 'center' | 'right'
    wrap?: boolean
    invert?: 'dark' | 'light' | 'always'
    saturate?: string
    // Source line tracking (passed through from HTML)
    'data-source-line-start'?: string
    'data-source-line-end'?: string
    dataSourceLineStart?: string
    dataSourceLineEnd?: string
  }

  function ImageComponent(props: ImageComponentProps) {
    const { src, alt = '', width, align = 'center', wrap = false, invert, saturate } = props

    // Extract source line tracking (check both kebab-case and camelCase)
    const sourceLineStart = props['data-source-line-start'] || props.dataSourceLineStart
    const sourceLineEnd = props['data-source-line-end'] || props.dataSourceLineEnd

    // Check if this is an excalidraw file
    if (src.endsWith('.excalidraw') || src.endsWith('.excalidraw.md')) {
      return (
        <ExcalidrawImage
          src={src}
          alt={alt}
          style={width ? { width } : undefined}
          align={align}
          wrap={wrap}
          files={files}
          onWidthChange={onContentChange ? (markdown) => handleImageWidthChange(src, markdown) : undefined}
          onEdit={onExcalidrawEdit}
          sourceLineStart={sourceLineStart}
          sourceLineEnd={sourceLineEnd}
        />
      )
    }

    return (
      <ContentImage
        src={src}
        alt={alt}
        style={width ? { width } : undefined}
        align={align}
        wrap={wrap}
        invert={invert}
        saturate={saturate}
        files={files}
        optimizeImages={optimizeImages}
        onWidthChange={onContentChange ? (markdown) => handleImageWidthChange(src, markdown) : undefined}
        sourceLineStart={sourceLineStart}
        sourceLineEnd={sourceLineEnd}
      />
    )
  }

  // Anchor component - resolves relative file links to /api/files/{id} URLs
  function AnchorComponent({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & Record<string, unknown>) {
    const originalHref = (props['data-original-href'] as string) || (props['dataOriginalHref'] as string)

    if (originalHref) {
      // This is a relative file link — resolve via SkriptFiles
      const resolvedUrl = resolveUrl(files, originalHref)
      if (resolvedUrl) {
        // Use ?download=filename to trigger Content-Disposition: attachment on the API
        const separator = resolvedUrl.includes('?') ? '&' : '?'
        const downloadUrl = `${resolvedUrl}${separator}download=${encodeURIComponent(originalHref)}`
        return (
          <a href={downloadUrl} download={originalHref} {...props}>
            {children}
          </a>
        )
      }
      // File not found in skript files — render as-is (broken link)
    }

    // Regular link — pass through
    return <a href={href} {...props}>{children}</a>
  }

  return {
    // HTML element overrides
    pre: PreComponent,
    code: CodeComponent,
    img: ImgElementComponent,
    a: AnchorComponent,
    blockquote: BlockquoteComponent,
    h1: createHeading(1),
    h2: createHeading(2),
    h3: createHeading(3),
    h4: createHeading(4),
    h5: createHeading(5),
    h6: createHeading(6),

    // Custom elements from remark plugins (lowercase for HTML parsing)
    'code-editor': CodeEditorComponent,
    'tabs-container': TabsContainerComponent,
    'tab-item': TabItem,
    'youtube-embed': YoutubeEmbedComponent,
    'muxvideo': MuxVideoComponent,
    'excalidraw-image': ExcalidrawImageComponent,
    'question': QuizQuestionComponent,
    'quiz-option': QuizOptionComponent,
    'stickme': StickMe,
    // <excali> component - shorthand for excalidraw drawings
    // Usage: <excali src="my-drawing" /> (no .excalidraw extension needed)
    'excali': function ExcaliComponent(props: {
      src: string
      alt?: string
      width?: string
      align?: 'left' | 'center' | 'right'
      wrap?: boolean
    }) {
      const { src, alt = '', width, align = 'center', wrap = false } = props
      // Ensure src has .excalidraw extension
      const filename = src.endsWith('.excalidraw') ? src : `${src}.excalidraw`

      return (
        <ExcalidrawImage
          src={filename}
          alt={alt}
          style={width ? { width } : undefined}
          align={align}
          wrap={wrap}
          files={files}
          onWidthChange={onContentChange ? (markdown) => handleImageWidthChange(filename, markdown) : undefined}
          onEdit={onExcalidrawEdit}
        />
      )
    },
    // <image> component for images with layout props (width, align, wrap, etc.)
    'image': ImageComponent,

    // Legacy PascalCase mappings for backwards compatibility
    CodeEditor: CodeEditorComponent,
    Tabs: Object.assign(Tabs, { Tab: TabItem }),
    Youtube,
    MuxVideo: MuxVideoComponent,
    Question: QuizQuestionComponent,
    Option: QuizOptionComponent,
    Image: ImageComponent,

    // Organization components
    OurTeachers: function OurTeachersComponent(props: {
      roles?: ('owner' | 'admin' | 'member')[]
      limit?: number
      className?: string
    }) {
      return <OurTeachers orgSlug={organizationSlug} {...props} />
    },
    'ourteachers': function OurTeachersComponent(props: {
      roles?: ('owner' | 'admin' | 'member')[]
      limit?: number
      className?: string
    }) {
      return <OurTeachers orgSlug={organizationSlug} {...props} />
    },

    // Demo/marketing components
    DemoEditor,
    'demoeditor': DemoEditor,

    // Educational interactive components
    ColorSliders,
    'colorsliders': ColorSliders,
    StickMe,
    DijkstraVisualizer,
    'dijkstravisualizer': DijkstraVisualizer,

    // YouTube timestamp links
    YT,
    'yt': YT,

    // Math/crypto educational components
    ModCalc,
    'modcalc': ModCalc,

    // Data visualization components
    DataCubeVisualizer,
    'datacubevisualizer': DataCubeVisualizer,

    // Layout components
    Flex,
    'flex': Flex,
    FlexItem,
    'flex-item': FlexItem,
  }
}
