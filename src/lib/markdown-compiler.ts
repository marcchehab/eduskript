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
import { rehypeAllowPluginAttrs } from './rehype-plugins/plugin-attrs'
import { rehypeColorClasses } from './rehype-plugins/color-classes'
import { rehypeExternalLinks } from './rehype-plugins/external-links'
import { rehypeStablePageLinks } from './rehype-plugins/stable-page-links'
import { rehypeAlignTags } from './rehype-plugins/align-tags'
import { rehypeSandboxIframes } from './rehype-plugins/sandbox-iframes'
import { stripSlideDirectives } from './markdown-slides'
import type { ResolvedPage } from './page-stable-link'

// Re-export remarkPlugins for backward compatibility
export { remarkPlugins }

/**
 * Rehype plugins - transform HTML AST (applied after sanitization)
 */
// NOTE: rehypeSourceLine is intentionally NOT in this shared array — it needs
// the per-document lineMap from preprocessing, so compileMarkdown adds it
// explicitly (with the map) after this list.
export const rehypePlugins: PluggableList = [
  rehypeSlug,
  rehypeHeadingSectionIds,
  rehypeColorTitle,
  rehypeKatex,
  // Must run AFTER rehypeKatex so it can rewrite the spans KaTeX emits for
  // \textcolor{NAME}{…} into themed class names.
  rehypeColorClasses,
]

/**
 * Sanitization schema - allowlist of safe elements and attributes.
 * Blocks XSS vectors like <script>, onclick, javascript: URLs, etc.
 */
export const sanitizeSchema = {
  ...defaultSchema,
  // defaultSchema.clobberPrefix is 'user-content-' and clobber includes 'id'.
  // remark-rehype ALREADY prefixes footnote ids/hrefs with 'user-content-'
  // (matching pairs like id="user-content-fn-x" ↔ href="#user-content-fn-x").
  // Sanitize then re-prefixes only the `id` (not the href fragment), producing
  // id="user-content-user-content-fn-x" — so footnote anchor + backref links
  // jump nowhere. Empty prefix stops the double-prefix; the ids remain
  // namespaced because remark-rehype already added the prefix. See the test in
  // git history / docs/internals/06-markdown-pipeline.md.
  clobberPrefix: '',
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
    'answer',
    'survey', // <Survey> region marker — wraps <Question>s for anonymous-submission flow
    'mermaid-diagram',
    'stickme',
    'demoeditor',
    'ourteachers',
    'yt',
    'mark',  // <mark> for text highlighting showcase
    'u',     // <u> for underlined text (not in defaultSchema)
    'nobr',  // <nobr> non-standard but widely supported; prevents line breaks
    'image', // Alias for <img> — passes through sanitizer, mapped to img handler
    'excali', // <excali> shorthand for excalidraw drawings
    'flex', // <flex> layout container
    'flex-item', // <flex-item> child of flex
    'fullwidth', // Breaks out of #paper padding for edge-to-edge content
    'pdf', // PDF embed using browser's native PDF viewer
    'geogebra', // Interactive GeoGebra applet (deployggb.js) by material id
    'ping', // Server-side TCP-connect "ping" terminal (not ICMP)
    'login-codes', // Live login-code display for an inbound-email hook (CloudMailin)
    'plugin', // User-created plugins rendered in sandboxed iframes
    'iframe', // Raw embeds (geotraceroute, etc.) — sandbox forced post-sanitize by rehypeSandboxIframes
    'style', // <style> blocks for scoped CSS in markdown
    // SVG elements
    'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc',
    'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'path',
    'text', 'tspan', 'textPath',
    // SVG animation elements
    'animate', 'animateTransform', 'animateMotion', 'set', 'mpath',
    // SVG gradients and filters
    'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern',
    'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feFlood', 'feComposite',
    'feMerge', 'feMergeNode', 'feColorMatrix', 'feDropShadow',
    // SVG markers
    'marker',
    // foreignObject for embedding HTML in SVG
    'foreignObject',
  ],
  attributes: {
    ...defaultSchema.attributes,
    // Allow className and style on all elements
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'style'],
    // Custom component attributes (camelCase for HAST, kebab-case for raw HTML)
    'code-editor': ['dataLanguage', 'dataCode', 'dataFiles', 'dataId', 'dataDb', 'dataSchemaImage', 'dataSingle', 'dataShowCanvas', 'dataSolution', 'dataExam', 'dataCheckCode', 'dataCheckStages', 'dataCheckPoints', 'dataMaxChecks', 'dataAssets', 'dataAllowUpload', 'dataAccept', 'dataHeight', 'data-language', 'data-code', 'data-files', 'data-id', 'data-db', 'data-schema-image', 'data-single', 'data-show-canvas', 'data-solution', 'data-exam', 'data-check-code', 'data-check-stages', 'data-check-points', 'data-max-checks', 'data-assets', 'data-allow-upload', 'data-accept', 'data-height'],
    'tabs-container': ['dataItems', 'data-items'],
    'youtube-embed': ['dataId', 'dataPlaylist', 'dataStartTime', 'dataCaption', 'dataPin', 'data-id', 'data-playlist', 'data-start-time', 'data-caption', 'data-pin'],
    'mermaid-diagram': ['dataDefinition', 'data-definition'],
    'muxvideo': ['src', 'alt', 'poster', 'pin'],
    'excalidraw-image': ['src', 'alt', 'dataAlign', 'dataWrap', 'data-align', 'data-wrap'],
    // <excali> component - shorthand for excalidraw (src without .excalidraw extension)
    'excali': ['src', 'alt', 'width', 'align', 'wrap'],
    // <image> component attributes (src, alt, width, align, wrap, invert, saturate)
    'image': ['src', 'alt', 'width', 'align', 'wrap', 'invert', 'saturate'],
    // Plugin: intrinsic attrs the React PluginContainer reads as named props.
    // Per-document custom config attrs (font, mod, …) are added on the fly by
    // rehypeAllowPluginAttrs before sanitize — see rehype-plugins/plugin-attrs.ts.
    'plugin': ['src', 'id', 'height', 'width'],
    // iframe: 'sandbox' is intentionally omitted — rehypeSandboxIframes forces
    // a safe value after sanitize so authors can't weaken it.
    'iframe': ['src', 'width', 'height', 'title', 'loading', 'allowfullscreen', 'frameborder', 'className', 'style'],
    'pdf': ['src', 'height'],
    // GeoGebra applet. material-id (online) is the primary source; src is
    // reserved for a future uploaded .ggb. Both kebab + camel for HAST/raw-HTML.
    'geogebra': ['material-id', 'materialId', 'src', 'height', 'width', 'show-toolbar', 'showToolbar', 'show-algebra-input', 'showAlgebraInput', 'correct-when', 'correctWhen'],
    'ping': ['host', 'count', 'os'],
    'login-codes': ['hook', 'interval'],
    'question': ['id', 'type', 'showfeedback', 'minvalue', 'maxvalue', 'step', 'minlabel', 'maxlabel', 'gateat', 'gate-at', 'dataGateAt', 'data-gate-at', 'points', 'data-expected', 'dataExpected', 'ignore-case', 'ignorecase', 'ignore-whitespace', 'ignorewhitespace'],
    'quiz-option': ['correct', 'is', 'feedback'],
    'answer': ['correct', 'is', 'feedback'],
    'yt': ['time', 'videoid', 'label'],
    'stickme': ['id'],
    'next-stage': ['label', 'title', 'confirm', 'cancel'],
    'ourteachers': ['roles', 'limit', 'className'],
    'flex': ['gap', 'wrap', 'direction', 'justify', 'align', 'className'],
    'flex-item': ['width', 'grow', 'className'],
    // Extended img attributes — bare names (user-facing) and data- variants (pipeline/compat)
    'img': [
      ...(defaultSchema.attributes?.['img'] || []),
      'align', 'wrap', 'invert', 'saturate',
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
    // Mark attributes (text highlighting)
    'mark': ['className'],
    // Code attributes
    'code': ['className', 'dataCopy', 'data-copy'],
    'pre': ['className'],
    // Span for KaTeX
    'span': ['className', 'style'],
    // Links
    'a': ['href', 'title', 'className', 'dataOriginalHref', 'data-original-href', 'download', 'target', 'rel'],
    // SVG container attributes
    'svg': ['viewBox', 'width', 'height', 'xmlns', 'preserveAspectRatio', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform'],
    // SVG shape attributes (shared)
    'circle': ['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'opacity', 'transform'],
    'ellipse': ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'opacity', 'transform'],
    'rect': ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform'],
    'line': ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'opacity', 'transform'],
    'polyline': ['points', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'transform'],
    'polygon': ['points', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform'],
    'path': ['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform', 'fill-rule', 'clip-rule'],
    'g': ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform', 'clip-path', 'mask'],
    'defs': [],
    'symbol': ['id', 'viewBox', 'preserveAspectRatio'],
    'use': ['href', 'xlink:href', 'x', 'y', 'width', 'height', 'fill', 'stroke', 'transform'],
    // SVG text
    'text': ['x', 'y', 'dx', 'dy', 'text-anchor', 'dominant-baseline', 'font-family', 'font-size', 'font-weight', 'fill', 'stroke', 'opacity', 'transform'],
    'tspan': ['x', 'y', 'dx', 'dy', 'fill', 'stroke', 'font-size', 'font-weight'],
    'textPath': ['href', 'xlink:href', 'startOffset', 'method', 'spacing'],
    // SVG animation attributes
    'animate': ['attributeName', 'values', 'from', 'to', 'by', 'dur', 'begin', 'end', 'repeatCount', 'repeatDur', 'fill', 'calcMode', 'keyTimes', 'keySplines', 'additive', 'accumulate'],
    'animateTransform': ['attributeName', 'type', 'values', 'from', 'to', 'by', 'dur', 'begin', 'end', 'repeatCount', 'repeatDur', 'fill', 'calcMode', 'keyTimes', 'keySplines', 'additive', 'accumulate'],
    'animateMotion': ['path', 'dur', 'begin', 'end', 'repeatCount', 'repeatDur', 'fill', 'calcMode', 'keyTimes', 'keySplines', 'keyPoints', 'rotate'],
    'set': ['attributeName', 'to', 'begin', 'dur', 'end', 'fill'],
    'mpath': ['href', 'xlink:href'],
    // SVG gradients
    'linearGradient': ['id', 'x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod'],
    'radialGradient': ['id', 'cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform', 'spreadMethod'],
    'stop': ['offset', 'stop-color', 'stop-opacity'],
    // SVG filters
    'filter': ['id', 'x', 'y', 'width', 'height', 'filterUnits', 'primitiveUnits'],
    'feGaussianBlur': ['in', 'stdDeviation', 'result'],
    'feOffset': ['in', 'dx', 'dy', 'result'],
    'feBlend': ['in', 'in2', 'mode', 'result'],
    'feFlood': ['flood-color', 'flood-opacity', 'result'],
    'feComposite': ['in', 'in2', 'operator', 'k1', 'k2', 'k3', 'k4', 'result'],
    'feMerge': ['result'],
    'feMergeNode': ['in'],
    'feColorMatrix': ['in', 'type', 'values', 'result'],
    'feDropShadow': ['dx', 'dy', 'stdDeviation', 'flood-color', 'flood-opacity'],
    // SVG clipping and masking
    'clipPath': ['id', 'clipPathUnits'],
    'mask': ['id', 'x', 'y', 'width', 'height', 'maskUnits', 'maskContentUnits'],
    'pattern': ['id', 'x', 'y', 'width', 'height', 'patternUnits', 'patternContentUnits', 'patternTransform', 'viewBox'],
    // SVG markers
    'marker': ['id', 'viewBox', 'refX', 'refY', 'markerWidth', 'markerHeight', 'orient', 'markerUnits'],
    // foreignObject
    'foreignObject': ['x', 'y', 'width', 'height'],
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
  /** Pre-resolved canonical URLs for `/p/{id}` stable links. Server callers
   *  resolve via `resolveStableLinks` before invoking; client renders pass
   *  nothing and the `/p/[id]` redirect route handles links at click time.
   *  Kept as a parameter so this module stays free of `server-only` imports
   *  and can be safely bundled into client components. */
  resolvedStableLinks?: Map<string, ResolvedPage>
  /** Emit heading `id` + `data-section-id`/`data-heading-text` anchors
   *  (rehypeSlug + rehypeHeadingSectionIds). Default true. Set false when the
   *  output is rendered alongside the same content (e.g. slide copies in the
   *  presenter) to avoid duplicate ids colliding with the page in the DOM. */
  anchors?: boolean
  /** Visible heading for the GFM footnotes section. Defaults to 'Footnotes'.
   *  Pass a localized string (e.g. 'Fussnoten') per the page/site language —
   *  see footnoteLabelForLang. The label is always rendered visible (sr-only
   *  is dropped via footnoteLabelProperties below). */
  footnoteLabel?: string
}

/**
 * Localized heading for the GFM footnotes section, keyed on a BCP-47 tag
 * (the site's pageLanguage; null/undefined → English). Kept small on purpose —
 * extend when a content language is actually used.
 */
export function footnoteLabelForLang(lang?: string | null): string {
  const l = (lang || 'en').toLowerCase()
  if (l.startsWith('de')) return 'Fussnoten' // Swiss spelling (no ß)
  if (l.startsWith('fr')) return 'Notes de bas de page'
  if (l.startsWith('it')) return 'Note a piè di pagina'
  return 'Footnotes'
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
// HTML void elements that are legitimately self-closing
const HTML_VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

/**
 * Expand self-closing custom element tags to explicit open+close pairs.
 * HTML only allows self-closing syntax for void elements (img, br, etc.).
 * Custom elements like <excali src="x" /> must become <excali src="x"></excali>.
 */
function expandSelfClosingTags(markdown: string): string {
  return markdown.replace(/<([a-zA-Z][\w-]*)((?:\s+[^>]*?)?)\/>/g, (match, tag, attrs) => {
    if (HTML_VOID_ELEMENTS.has(tag.toLowerCase())) return match
    return `<${tag}${attrs}></${tag}>`
  })
}

/**
 * Make `<question>`/`<answer>` blank-line-independent.
 *
 * `<answer>` elements must be DIRECT children of `<question>` for the quiz
 * component to read them (Children.toArray). But a blank line before an
 * `<answer>` (or before `</question>`) makes CommonMark treat the run of
 * answers as a paragraph, wrapping them in a `<p>` — so the options detach from
 * the question and the quiz renders empty. Authors hit this constantly (the
 * "leave a blank line / don't leave a blank line" foot-gun).
 *
 * Fix: inside each `<question>…</question>`, collapse blank lines that sit
 * immediately before an `<answer>`, `</answer>`, or `</question>` tag down to a
 * single newline. This is deliberately narrow — it does NOT touch blank lines
 * around the prompt text or a ```expected fenced block (free-text auto-check),
 * so those keep working. Single newlines between answers are fine; the
 * resulting whitespace text nodes are handled by dense element-only indexing in
 * components/markdown/quiz.tsx.
 *
 * `<answer>` is deliberately NOT delimited by `delimitContainerTags` below
 * (that would make the prompt its own paragraph and the answers separate
 * blocks); questions rely on this collapse instead.
 */
function normalizeQuestionSpacing(markdown: string): string {
  return markdown.replace(/<question\b[^>]*>[\s\S]*?<\/question>/gi, (block) =>
    block.replace(/\n[ \t]*(?:\n[ \t]*)+(<\/?(?:answer|question)\b)/gi, '\n$1')
  )
}

/**
 * Custom container tags that wrap markdown content. Each must be delimited from
 * surrounding content by blank lines, or CommonMark's HTML-block rules bite:
 * a blank line INSIDE the block terminates it early (later content + the
 * closing tag mis-nest), and missing a blank line AFTER the closing tag absorbs
 * the following markdown into the block (e.g. a `## Heading` rendered as literal
 * text). `<question>` is included so content after `</question>` isn't
 * swallowed; `<answer>` is NOT (see normalizeQuestionSpacing).
 */
const CONTAINER_TAGS = [
  'flex', 'flex-item', 'tabs-container', 'tab-item',
  'fullwidth', 'stickme', 'left', 'center', 'right', 'question',
]

/**
 * Guarantee a blank line before every opening container tag and after every
 * closing container tag that sits on its own line. This makes CommonMark treat
 * each tag as a standalone HTML block, so inner content parses as markdown and
 * adjacent / following content can't be absorbed — regardless of how the author
 * spaced things. Idempotent (won't stack blank lines). Lines inside fenced code
 * blocks are skipped so tag examples in docs survive verbatim.
 */
/**
 * Run all string preprocessing and return the processed markdown plus a
 * `lineMap` translating processed (1-based) line numbers back to the editor's
 * original line numbers. The blank-line transforms below add/remove lines, so
 * AST positions would otherwise be shifted — breaking the editor↔preview
 * cursor sync. rehypeSourceLine uses lineMap to undo the shift.
 *
 * Alignment trick: expandSelfClosingTags is line-count-preserving, and the
 * other two transforms ONLY insert or delete BLANK lines (never alter non-blank
 * content or order). So we anchor each processed line to its original by
 * walking non-blank lines in lockstep.
 */
function preprocessMarkdown(content: string): { text: string; lineMap: number[] } {
  // Blank the slide directive markers (`---/`, `---x`) first. Line-count-
  // preserving, so the lineMap alignment below is unaffected.
  const base = expandSelfClosingTags(stripSlideDirectives(content))
  const text = delimitContainerTags(normalizeQuestionSpacing(base))

  const baseLines = base.split('\n')
  const procLines = text.split('\n')
  const isBlank = (s: string | undefined) => s === undefined || s.trim() === ''
  const lineMap = new Array<number>(procLines.length)

  let bi = 0
  for (let pi = 0; pi < procLines.length; pi++) {
    if (!isBlank(procLines[pi])) {
      while (bi < baseLines.length && isBlank(baseLines[bi])) bi++
      lineMap[pi] = Math.min(bi + 1, baseLines.length) // 1-based original line
      bi++
    } else {
      // Blank line (kept or inserted): point at the next content line's origin.
      let nb = bi
      while (nb < baseLines.length && isBlank(baseLines[nb])) nb++
      lineMap[pi] = Math.min(nb + 1, baseLines.length)
    }
  }

  return { text, lineMap }
}

function delimitContainerTags(markdown: string): string {
  const tags = CONTAINER_TAGS.join('|')
  const openRe = new RegExp(`^[ \\t]*<(?:${tags})\\b[^>]*>[ \\t]*$`, 'i')
  const closeRe = new RegExp(`^[ \\t]*</(?:${tags})>[ \\t]*$`, 'i')
  const fenceRe = /^[ \t]*(```|~~~)/

  const lines = markdown.split('\n')
  const out: string[] = []
  let inFence = false
  const blank = (s: string | undefined) => s === undefined || s.trim() === ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (fenceRe.test(line)) inFence = !inFence

    if (!inFence && openRe.test(line)) {
      if (out.length > 0 && !blank(out[out.length - 1])) out.push('')
      out.push(line)
    } else if (!inFence && closeRe.test(line)) {
      out.push(line)
      if (!blank(lines[i + 1])) out.push('')
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}

export async function compileMarkdown(
  content: string,
  options?: CompileMarkdownOptions
): Promise<ReactNode> {
  const { components = {}, resolvedStableLinks = new Map<string, ResolvedPage>(), anchors = true, footnoteLabel } = options ?? {}

  const { text: processed, lineMap } = preprocessMarkdown(content)

  // Slides re-render the page's content, which would duplicate heading ids and
  // data-section-id anchors in the DOM. Drop those plugins when anchors=false.
  const rehypeList = anchors
    ? rehypePlugins
    : rehypePlugins.filter((p) => p !== rehypeSlug && p !== rehypeHeadingSectionIds)

  // Clone the schema per call: rehypeAllowPluginAttrs mutates the plugin
  // allowlist based on the attrs found in *this* document, so concurrent
  // renders can't pollute each other.
  const schema = structuredClone(sanitizeSchema)

  const processor = unified()
    .use(remarkParse)
    .use(remarkPlugins)
    .use(remarkRehype, {
      allowDangerousHtml: true,
      // GFM footnotes: visible, localized section heading. footnoteLabelProperties
      // {} drops the default `sr-only` class so the title shows (default text
      // 'Footnotes', overridden per language via footnoteLabel).
      ...(footnoteLabel ? { footnoteLabel } : {}),
      footnoteLabelProperties: {},
    })
    .use(rehypeRaw)
    // Re-parse markdown inside custom container tags (flex-item, tab-item,
    // question, left/center/right, …) so they work with OR without blank
    // lines. MUST run before rehypeAlignTags: it re-parses <left>/<center>/
    // <right> text children while they're still those tags, then align rewrites
    // the (now markdown-populated) tag to <div>.
    .use(rehypeMarkdownChildren)
    .use(rehypeAlignTags) // Rewrite <left>/<center>/<right> → <div class="es-align-*"> (before sanitize so it sees a plain div)
    .use(rehypeAllowPluginAttrs, schema) // Add this document's <plugin> attrs to the sanitize allowlist
    .use(rehypeExternalLinks) // Auto target=_blank for external links + title="_blank" opt-in
    .use(rehypeStablePageLinks, resolvedStableLinks) // Rewrite /p/{id} → canonical URL
    .use(rehypeSanitize, schema)
    .use(rehypeSandboxIframes) // Force a safe sandbox on iframes that survived sanitize
    .use(rehypeList)
    // Source-line attributes, with the lineMap so preview line numbers match
    // the editor's original lines (preprocessing shifted them).
    .use(rehypeSourceLine, lineMap)
    .use(rehypeReact, {
      ...production,
      components,
    } as Parameters<typeof rehypeReact>[0])

  const result = await processor.process(processed)
  return result.result as ReactNode
}
