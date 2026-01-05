/**
 * Safe Markdown Compiler
 *
 * Unified remark/rehype pipeline for rendering markdown to React.
 * This replaces MDX to eliminate JavaScript execution vulnerabilities.
 *
 * Key differences from MDX:
 * - No {expressions} - content is data, not code
 * - No imports/exports
 * - Uses rehype-sanitize to block XSS vectors
 * - Custom components via HTML element mapping (lowercase tags)
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeReact from 'rehype-react'
import * as jsxRuntime from 'react/jsx-runtime'

// JSX runtime for rehype-react (required in production mode)
const production = {
  Fragment: jsxRuntime.Fragment,
  jsx: jsxRuntime.jsx,
  jsxs: jsxRuntime.jsxs,
}
import type { ComponentType, ReactNode } from 'react'
import type { PluggableList } from 'unified'
import rehypeKatex from 'rehype-katex'
import rehypeSlug from 'rehype-slug'
import { remarkPlugins } from './markdown-plugins'
import { rehypeSourceLine } from './rehype-plugins/source-line'
import { rehypeColorTitle } from './rehype-plugins/color-title'
import { rehypeHeadingSectionIds } from './rehype-plugins/heading-section-ids'
import { rehypeMarkdownChildren } from './rehype-plugins/markdown-children'

// Re-export remarkPlugins for backward compatibility
export { remarkPlugins }

/**
 * Rehype plugins - transform HTML AST (applied after sanitization)
 */
export const rehypePlugins: PluggableList = [
  rehypeSlug,
  rehypeHeadingSectionIds,
  rehypeColorTitle,
  rehypeKatex,
  rehypeSourceLine,
]

/**
 * Sanitization schema - allowlist of safe elements and attributes.
 * Blocks XSS vectors like <script>, onclick, javascript: URLs, etc.
 */
export const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    // Custom components (lowercase HTML elements)
    'code-editor',
    'tabs-container',
    'tab-item',
    'youtube-embed',
    'muxvideo',
    'excalidraw-image',
    'question',
    'quiz-option',
    'stickme',
    'dijkstravisualizer',
    'colorsliders',
    'datacubevisualizer',
    'demoeditor',
    'ourteachers',
    'yt',
    'modcalc',
    'image', // <image> custom component for images with layout props
    'excali', // <excali> shorthand for excalidraw drawings
  ],
  attributes: {
    ...defaultSchema.attributes,
    // Allow className and style on all elements
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'style'],
    // Custom component attributes (camelCase for HAST, kebab-case for raw HTML)
    'code-editor': ['dataLanguage', 'dataCode', 'dataId', 'dataDb', 'dataSchemaImage', 'dataSingle', 'dataShowCanvas', 'data-language', 'data-code', 'data-id', 'data-db', 'data-schema-image', 'data-single', 'data-show-canvas'],
    'tabs-container': ['dataItems', 'data-items'],
    'youtube-embed': ['dataId', 'dataPlaylist', 'dataStartTime', 'data-id', 'data-playlist', 'data-start-time'],
    'muxvideo': ['src', 'alt'],
    'excalidraw-image': ['src', 'alt', 'dataAlign', 'dataWrap', 'data-align', 'data-wrap'],
    // <excali> component - shorthand for excalidraw (src without .excalidraw extension)
    'excali': ['src', 'alt', 'width', 'align', 'wrap'],
    // <image> component attributes (src, alt, width, align, wrap, invert, saturate)
    'image': ['src', 'alt', 'width', 'align', 'wrap', 'invert', 'saturate'],
    'question': ['id', 'type', 'showfeedback', 'allowupdate', 'minvalue', 'maxvalue', 'step'],
    'quiz-option': ['correct', 'is', 'feedback'],
    'yt': ['time', 'videoid', 'label'],
    'ourteachers': ['roles', 'limit', 'className'],
    // Extended img attributes for our plugins (both camelCase and kebab-case)
    'img': [
      ...(defaultSchema.attributes?.['img'] || []),
      'dataOriginalSrc', 'data-original-src',
      'dataAlign', 'data-align',
      'dataWrap', 'data-wrap',
      'dataInvert', 'data-invert',
      'dataSaturate', 'data-saturate',
      'dataExcalidraw', 'data-excalidraw',
      'dataSourceLineStart', 'data-source-line-start',
      'dataSourceLineEnd', 'data-source-line-end',
    ],
    // Blockquote attributes for callouts
    'blockquote': [
      ...(defaultSchema.attributes?.['blockquote'] || []),
      'dataSectionId', 'data-section-id',
    ],
    // Heading attributes
    'h1': ['id', 'dataSectionId', 'data-section-id', 'dataHeadingText', 'data-heading-text'],
    'h2': ['id', 'dataSectionId', 'data-section-id', 'dataHeadingText', 'data-heading-text'],
    'h3': ['id', 'dataSectionId', 'data-section-id', 'dataHeadingText', 'data-heading-text'],
    'h4': ['id', 'dataSectionId', 'data-section-id', 'dataHeadingText', 'data-heading-text'],
    'h5': ['id', 'dataSectionId', 'data-section-id', 'dataHeadingText', 'data-heading-text'],
    'h6': ['id', 'dataSectionId', 'data-section-id', 'dataHeadingText', 'data-heading-text'],
    // Code attributes
    'code': ['className'],
    'pre': ['className'],
    // Span for KaTeX
    'span': ['className', 'style'],
    // Links
    'a': ['href', 'title', 'className'],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https', 'blob', 'data'],
  },
}

export interface CompileMarkdownOptions {
  /** React components to use for HTML elements */
  components?: Record<string, ComponentType<any>>
}

/**
 * Compile markdown to React elements.
 *
 * This is a safe pipeline that:
 * 1. Parses markdown to AST
 * 2. Applies remark plugins (callouts, code-editor, etc.)
 * 3. Converts to HTML AST
 * 4. Parses raw HTML in markdown (rehype-raw)
 * 5. Sanitizes to remove XSS vectors
 * 6. Applies rehype plugins (slug, katex, etc.)
 * 7. Converts to React elements
 *
 * @param content - Markdown content to compile
 * @param options - Optional components mapping
 * @returns React elements ready to render
 */
export async function compileMarkdown(
  content: string,
  options?: CompileMarkdownOptions
): Promise<ReactNode> {
  const { components = {} } = options ?? {}

  const processor = unified()
    .use(remarkParse)
    .use(remarkPlugins)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeMarkdownChildren) // Re-parse markdown inside custom elements like <stickme>
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypePlugins)
    .use(rehypeReact, {
      ...production,
      components,
    } as Parameters<typeof rehypeReact>[0])

  const result = await processor.process(content)
  return result.result as ReactNode
}
