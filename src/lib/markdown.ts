import { unified } from 'unified'
import type { PluggableList } from 'unified'
import remarkParse from 'remark-parse'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import matter from 'gray-matter'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import { remarkFileResolver } from './remark-plugins/file-resolver'
import { rehypeImageOptimizer } from './remark-plugins/image-optimizer'
import { remarkImageAttributes } from './remark-plugins/image-attributes'
import { rehypeInteractiveElements } from './rehype-plugins/interactive-elements'
import { rehypeExcalidrawDualImage } from './rehype-plugins/excalidraw-dual-image'
import { rehypeImageWrapper } from './rehype-plugins/image-wrapper'

export interface ProcessedMarkdown {
  content: string
  frontmatter: Record<string, unknown>
  excerpt?: string
}

export interface MarkdownContext {
  /** The domain/username for the current content */
  domain?: string
  /** The skript ID for skript-specific file searches */
  skriptId?: string
  /** Pre-fetched file list for client-side image resolution */
  fileList?: Array<{ id: string, name: string, url?: string, isDirectory?: boolean }>
  /** Current theme for Excalidraw SVG selection */
  theme?: 'light' | 'dark'
}

export async function processMarkdown(
  markdown: string,
  context?: MarkdownContext // Now properly used for image path resolution
): Promise<ProcessedMarkdown> {
  // Parse frontmatter
  const { content, data: frontmatter } = matter(markdown)

  const isServer = typeof window === 'undefined'

  // Build plugin list
  const remarkPlugins: PluggableList = [
    remarkParse,
    [remarkFileResolver, {
      fileList: context?.fileList
    }],
    remarkImageAttributes, // Parse image width attributes
    remarkMath,
    remarkGfm,
  ]

  // Add server-only plugin dynamically
  if (isServer) {
    const { remarkServerImageOptimizer } = await import('./remark-plugins/server-image-optimizer')
    remarkPlugins.push([remarkServerImageOptimizer, {
      domain: context?.domain,
      skriptId: context?.skriptId,
      fileList: context?.fileList
    }])
  }

  const rehypePlugins: PluggableList = [
    [remarkRehype, { allowDangerousHtml: true }],
    rehypeSlug, // Add IDs to headings
    [rehypeAutolinkHeadings, {
      behavior: 'wrap',
      properties: { className: ['heading-link'] }
    }],
    rehypeExcalidrawDualImage, // Convert Excalidraw images to dual light/dark variants
    rehypeImageWrapper, // Wrap regular images with alignment and caption support
    rehypeImageOptimizer, // Optimize images for better loading
    rehypeInteractiveElements, // Add data attributes for interactive controls
    rehypeKatex,
    rehypeHighlight,
    [rehypeStringify, { allowDangerousHtml: true }]
  ]

  // Process markdown to HTML
  const processor = unified()

  // Apply plugins
  processor.use(remarkPlugins)
  processor.use(rehypePlugins)

  const processedContent = await processor.process(content)

  return {
    content: String(processedContent),
    frontmatter,
    excerpt: generateExcerpt(content)
  }
}

export function generateExcerpt(content: string, maxLength: number = 160): string {
  // Remove markdown syntax for excerpt
  const plainText = content
    .replace(/#{1,6}\s+/g, '') // Remove headers
    .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
    .replace(/\*(.*?)\*/g, '$1') // Remove italics
    .replace(/`(.*?)`/g, '$1') // Remove inline code
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Remove links
    .replace(/!\[.*?\]\(.*?\)/g, '') // Remove images
    .replace(/\n/g, ' ') // Replace newlines with spaces
    .trim()

  if (plainText.length <= maxLength) {
    return plainText
  }

  const truncated = plainText.substring(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')

  return truncated.substring(0, lastSpace) + '...'
}

export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .trim()
}

export function validateMarkdown(content: string): string[] {
  const errors: string[] = []

  // Check for basic structure
  if (!content.trim()) {
    errors.push('Content cannot be empty')
  }

  // Check for balanced markdown syntax
  const boldMatches = content.match(/\*\*/g)
  if (boldMatches && boldMatches.length % 2 !== 0) {
    errors.push('Unbalanced bold syntax (**)')
  }

  const italicMatches = content.match(/(?<!\*)\*(?!\*)/g)
  if (italicMatches && italicMatches.length % 2 !== 0) {
    errors.push('Unbalanced italic syntax (*)')
  }

  const codeMatches = content.match(/`/g)
  if (codeMatches && codeMatches.length % 2 !== 0) {
    errors.push('Unbalanced inline code syntax (`)')
  }

  return errors
}
