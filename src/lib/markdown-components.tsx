/**
 * Markdown Components Factory
 *
 * Creates React components for markdown rendering with SkriptFiles bound for file resolution.
 * This is the single source of truth for component definitions.
 */

import React, { type ComponentType, type ReactNode, Children, isValidElement } from 'react'
import Image from 'next/image'
import type { SkriptFilesData } from './skript-files'
import { resolveFile, resolveExcalidraw } from './skript-files'
import { CodeEditor } from '@/components/public/code-editor'
import { HtmlPreviewEditor } from '@/components/public/code-editor/html-preview-editor'
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
import { StickMe } from '@/components/markdown/stick-me'
import { ColorTitleHeading } from '@/components/markdown/color-title-heading'
import { YT } from '@/components/markdown/youtube'
import { Flex, FlexItem } from '@/components/markdown/flex'
import { PluginContainer } from '@/components/markdown/plugin-container'
import { Fullwidth } from '@/components/markdown/fullwidth'
import { PdfEmbed } from '@/components/markdown/pdf-embed'
import { MermaidDiagram } from '@/components/markdown/mermaid-diagram'

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
  skriptId?: string  // For Python global imports (shared across editors in a skript)
  onImageWidthChange?: (srcForMatching: string, newMarkdown: string) => void  // Stable callback for image resize
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
  const { pageId, skriptId, onImageWidthChange, organizationSlug, onExcalidrawEdit, optimizeImages } = options ?? {}

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
          onWidthChange={onImageWidthChange ? (markdown) => onImageWidthChange(dataExcalidraw, markdown) : undefined}
          onEdit={onExcalidrawEdit}
          sourceLineStart={sourceLineStart}
          sourceLineEnd={sourceLineEnd}
        />
      )
    }

    // Regular image — check data- prefixed, camelCase, and bare attribute names
    const originalSrc = (dataProps['data-original-src'] as string) || (dataProps['dataOriginalSrc'] as string)
    const dataAlign = (dataProps['data-align'] as string) || (dataProps['dataAlign'] as string) || (dataProps['align'] as string) || 'center'
    const dataWrap = (dataProps['data-wrap'] as string) || (dataProps['dataWrap'] as string) || (dataProps['wrap'] as string)
    const dataInvert = (dataProps['data-invert'] as string) || (dataProps['dataInvert'] as string) || (dataProps['invert'] as string)
    const dataSaturate = (dataProps['data-saturate'] as string) || (dataProps['dataSaturate'] as string) || (dataProps['saturate'] as string)

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
        onWidthChange={onImageWidthChange ? (markdown) => onImageWidthChange(originalSrc || srcStr, markdown) : undefined}
        sourceLineStart={sourceLineStart}
        sourceLineEnd={sourceLineEnd}
      />
    )
  }

  // Code editor component
  function CodeEditorComponent({ children, ...props }: React.HTMLAttributes<HTMLElement> & Record<string, unknown>) {

    const language = (props['dataLanguage'] as string) || (props['data-language'] as string) || 'python'
    const code = (props['dataCode'] as string) || (props['data-code'] as string) || ''
    const filesJson = (props['dataFiles'] as string) || (props['data-files'] as string)
    const providedId = (props['dataId'] as string) || (props['data-id'] as string)
    const showCanvas = (props['dataShowCanvas'] as string) || (props['data-show-canvas'] as string)
    const db = (props['dataDb'] as string) || (props['data-db'] as string)
    const schemaImage = (props['dataSchemaImage'] as string) || (props['data-schema-image'] as string)
    const single = (props['dataSingle'] as string) || (props['data-single'] as string)
    const solution = (props['dataSolution'] as string) || (props['data-solution'] as string)
    const exam = (props['dataExam'] as string) || (props['data-exam'] as string)
    const checkCode = (props['dataCheckCode'] as string) || (props['data-check-code'] as string)
    const checkPoints = (props['dataCheckPoints'] as string) || (props['data-check-points'] as string)
    const maxChecks = (props['dataMaxChecks'] as string) || (props['data-max-checks'] as string)
    const heightAttr = (props['dataHeight'] as string) || (props['data-height'] as string)
    const assetsAttr = (props['dataAssets'] as string) || (props['data-assets'] as string)
    const allowUploadAttr = (props['dataAllowUpload'] as string) || (props['data-allow-upload'] as string)
    const acceptAttr = (props['dataAccept'] as string) || (props['data-accept'] as string)

    // Debug: log all props to find attribute naming
    if (typeof window !== 'undefined') {
      const checkProps = Object.keys(props).filter(k => k.toLowerCase().includes('check'))
      if (checkProps.length > 0) console.log('[CodeEditor] check props:', checkProps, checkProps.map(k => props[k as keyof typeof props]))
      else console.log('[CodeEditor] no check props found. All keys:', Object.keys(props))
    }

    // Parse multi-file data if present, otherwise fall back to single-file initialCode
    let initialFiles: { name: string; content: string }[] | undefined
    let decodedCode: string

    if (filesJson) {
      try {
        const parsed = JSON.parse(decodeHtmlEntities(filesJson)) as { name: string; content: string }[]
        initialFiles = parsed
        decodedCode = parsed[0]?.content || ''
      } catch {
        decodedCode = decodeHtmlEntities(code)
      }
    } else {
      decodedCode = decodeHtmlEntities(code)
    }

    const id = providedId || `editor-${hashCode(code + (filesJson || '') + (solution || ''))}-${language}`
    const decodedSolution = solution ? decodeHtmlEntities(solution).replace(/\\n/g, '\n') : undefined

    // Resolve database file URL
    let dbUrl: string | undefined
    let schemaImageUrl: string | undefined
    let schemaImageDarkUrl: string | undefined

    if (db && language === 'sql') {
      // Try to find file with this name (with or without extension)
      const dbBasename = db.replace(/\.(sqlite|db)$/i, '')
      const dbFile = resolveFile(files, db) || resolveFile(files, `${dbBasename}.db`) || resolveFile(files, `${dbBasename}.sqlite`)
      if (dbFile?.url) {
        dbUrl = dbFile.url
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

    // Resolve teacher-attached binary assets (Python only) against skript file storage.
    // Names that don't match any uploaded file are silently skipped — the editor will
    // simply not show them. Same lookup pattern as `db=` above.
    let attachedFiles: Array<{ name: string; url: string }> | undefined
    if (assetsAttr && language === 'python') {
      const names = assetsAttr.split(',').map(s => s.trim()).filter(Boolean)
      const resolved: Array<{ name: string; url: string }> = []
      for (const name of names) {
        const file = resolveFile(files, name)
        if (file?.url) resolved.push({ name: file.name, url: file.url })
      }
      if (resolved.length > 0) attachedFiles = resolved
    }

    // HTML editor renders a sandboxed-iframe live preview instead of the
    // Run-button + output panel that Python/JS/SQL share, so we route it to
    // its own component rather than threading another branch through CodeEditor.
    if (language === 'html') {
      const parsedHeight = heightAttr ? parseInt(heightAttr, 10) : NaN
      const height = Number.isFinite(parsedHeight) && parsedHeight > 0 ? parsedHeight : undefined
      return (
        <div {...props}>
          <HtmlPreviewEditor
            key={id}
            id={id}
            pageId={pageId}
            initialCode={decodedCode}
            height={height}
          />
        </div>
      )
    }

    return (
      <div {...props}>
        <CodeEditor
          key={id}
          id={id}
          pageId={pageId}
          skriptId={skriptId}
          language={language as 'python' | 'javascript' | 'sql'}
          initialCode={decodedCode}
          initialFiles={initialFiles}
          showCanvas={showCanvas !== 'false'}
          db={dbUrl}
          schemaImage={schemaImageUrl}
          schemaImageDark={schemaImageDarkUrl}
          singleFile={initialFiles ? initialFiles.length <= 1 && single === 'true' : single === 'true'}
          solution={decodedSolution}
          exam={exam === 'true'}
          checkCode={checkCode ? decodeHtmlEntities(checkCode) : undefined}
          checkPoints={checkPoints ? parseInt(checkPoints, 10) : undefined}
          maxChecks={maxChecks ? parseInt(maxChecks, 10) : undefined}
          attachedFiles={attachedFiles}
          allowUpload={allowUploadAttr === 'true'}
          acceptUploads={acceptAttr}
        />
      </div>
    )
  }

  // Mux video component - passes files through
  function MuxVideoComponent({ ...props }: React.HTMLAttributes<HTMLElement> & Record<string, unknown>) {
    const src = (props['src'] as string) || ''
    const alt = (props['alt'] as string) || ''
    // poster: optional override — accepts a filename (resolved via files) or
    // an absolute URL. When omitted, the MuxVideo component falls back to the
    // auto-generated Mux thumbnail (frame at time=0).
    const poster = (props['poster'] as string) || undefined

    return (
      <span className="block my-6">
        <MuxVideo
          src={src}
          alt={alt}
          poster={poster}
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
        onWidthChange={onImageWidthChange ? (markdown) => onImageWidthChange(src, markdown) : undefined}
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
    const caption = (props['data-caption'] as string) || (props['dataCaption'] as string) || ''

    return (
      <Youtube
        id={id || undefined}
        playlist={playlist || undefined}
        startTime={startTime}
        caption={caption || undefined}
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
  function QuizOptionComponent({ children, correct, feedback }: React.HTMLAttributes<HTMLElement> & { correct?: string; feedback?: string }) {
    return <Option correct={correct as 'true' | 'false' | undefined} feedback={feedback}>{children}</Option>
  }

  // Anchor component - resolves relative file links to /api/files/{id} URLs
  function AnchorComponent({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & Record<string, unknown>) {
    const originalHref = (props['data-original-href'] as string) || (props['dataOriginalHref'] as string)

    if (originalHref) {
      // This is a relative file link — resolve via SkriptFiles.
      // S3 objects have Content-Disposition set at upload time, so direct URL works.
      const file = resolveFile(files, originalHref)
      if (file) {
        return (
          <a href={file.url} download={originalHref} {...props}>
            {children}
          </a>
        )
      }
      // File not found in skript files — render as-is (broken link)
    }

    // Regular link — pass through
    return <a href={href} {...props}>{children}</a>
  }

  // When custom block-level components (e.g. <ColorSliders />) appear on their
  // own line in markdown, rehype wraps them in <p>. HTML forbids <div> inside
  // <p>, causing hydration errors. When a <p> contains only a single custom
  // React component (no surrounding text), it's block-level — render as <div>.
  function ParagraphComponent({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
    const childArray = Children.toArray(children)
    const hasBlockChild =
      childArray.length === 1 &&
      isValidElement(childArray[0]) &&
      typeof childArray[0].type === 'function'
    if (hasBlockChild) {
      return <div {...props}>{children}</div>
    }
    return <p {...props}>{children}</p>
  }

  return {
    // HTML element overrides
    p: ParagraphComponent,
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
    'mermaid-diagram': (props: { 'data-definition'?: string }) => {
      const encoded = props['data-definition'] ?? ''
      return <MermaidDiagram definition={decodeHtmlEntities(encoded)} />
    },
    'muxvideo': MuxVideoComponent,
    'excalidraw-image': ExcalidrawImageComponent,
    'question': QuizQuestionComponent,
    'quiz-option': QuizOptionComponent,
    'answer': QuizOptionComponent,
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
          onWidthChange={onImageWidthChange ? (markdown) => onImageWidthChange(filename, markdown) : undefined}
          onEdit={onExcalidrawEdit}
        />
      )
    },
    // <image> is an alias for <img> — both use the same handler
    'image': ImgElementComponent,

    // Organization components
    'ourteachers': function OurTeachersComponent(props: {
      roles?: ('owner' | 'admin' | 'member')[]
      limit?: number
      className?: string
    }) {
      return <OurTeachers orgSlug={organizationSlug} {...props} />
    },

    // Demo/marketing components
    'demoeditor': DemoEditor,

    // YouTube timestamp links
    'yt': YT,

    // Layout components
    'flex': Flex,
    'flex-item': FlexItem,

    // Full-width container - breaks out of #paper padding
    'fullwidth': Fullwidth,

    // PDF embed - resolves filename to URL and renders in an iframe
    'pdf': (props: { src?: string; height?: string }) => {
      return (
        <PdfEmbed
          src={props.src || ''}
          height={props.height}
          files={files}
        />
      )
    },

    // User-created plugins (sandboxed iframes)
    // Inner text content is passed as config.content to the plugin
    'plugin': (props: Record<string, unknown>) => {
      // Extract text content from children
      const extractText = (node: unknown): string => {
        if (typeof node === 'string') return node
        if (Array.isArray(node)) return node.map(extractText).join('')
        if (node && typeof node === 'object' && 'props' in node) {
          const el = node as { props?: { children?: unknown } }
          return extractText(el.props?.children)
        }
        return ''
      }
      const innerContent = extractText(props.children).trim()

      const configProps = Object.fromEntries(
        Object.entries(props).filter(([k]) => !['src', 'id', 'height', 'children'].includes(k))
      )
      if (innerContent) {
        configProps.content = innerContent
      }

      return (
        <PluginContainer
          src={String(props.src || '')}
          id={props.id as string}
          height={props.height as string}
          pageId={pageId}
          {...configProps}
        />
      )
    },
  }
}
