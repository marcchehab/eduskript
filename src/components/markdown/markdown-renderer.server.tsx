import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'
import { getSkriptFiles } from '@/lib/skript-files.server'
import { EagerImageLoader } from './eager-image-loader'

interface ServerMarkdownRendererProps {
  content: string
  skriptId?: string
  pageId?: string
  organizationSlug?: string
}

/**
 * Server-side markdown renderer for public pages.
 * Compiles markdown on the server, returns React elements for ISR caching.
 * Interactive components (code editors, tabs, etc.) hydrate on the client.
 *
 * Uses the safe unified pipeline (no JavaScript execution):
 * 1. Get SkriptFiles from database (once, upfront)
 * 2. Compile markdown with remark/rehype plugins
 * 3. Create components with files prop bound
 */
export async function ServerMarkdownRenderer({ content, skriptId, pageId, organizationSlug }: ServerMarkdownRendererProps) {
  // 1. Get all files for this skript upfront
  const files = skriptId ? await getSkriptFiles(skriptId) : createEmptySkriptFiles()

  // 2. Create components with files prop bound
  const components = createMarkdownComponents(files, { pageId, organizationSlug, optimizeImages: true })

  // 3. Compile markdown (safe pipeline, no JS execution)
  let rendered: React.ReactNode
  let error: unknown

  try {
    rendered = await compileMarkdown(content, { components })
  } catch (e) {
    error = e
    console.error('Server markdown rendering error:', e)
  }

  // Render result or error (JSX outside try/catch for lint compliance)
  if (error) {
    return (
      <div className="text-destructive p-4 border border-destructive rounded-md">
        <p className="font-semibold">Markdown Rendering Error</p>
        <p className="text-sm mt-2">{String(error)}</p>
      </div>
    )
  }

  return (
    <EagerImageLoader>
      <div className="markdown-content prose dark:prose-invert max-w-none">
        {rendered}
      </div>
    </EagerImageLoader>
  )
}
