import { compileMDX } from '@/lib/mdx-compiler'
import { createMDXComponents } from '@/lib/mdx-components-factory'
import { createEmptySkriptFiles } from '@/lib/skript-files'
import { getSkriptFiles } from '@/lib/skript-files.server'

interface ServerMarkdownRendererProps {
  content: string
  skriptId?: string
  pageId?: string
  organizationSlug?: string
}

/**
 * Server-side markdown renderer for public pages.
 * Compiles MDX on the server, returns React elements for ISR caching.
 * Interactive components (code editors, tabs, etc.) hydrate on the client.
 *
 * Uses the unified MDX pipeline:
 * 1. Get SkriptFiles from database (once, upfront)
 * 2. Compile MDX with pure transformer plugins
 * 3. Create components with files prop bound
 */
export async function ServerMarkdownRenderer({ content, skriptId, pageId, organizationSlug }: ServerMarkdownRendererProps) {
  // 1. Get all files for this skript upfront
  const files = skriptId ? await getSkriptFiles(skriptId) : createEmptySkriptFiles()

  // 2. Compile MDX (plugins are pure transformers, no file resolution)
  let MDXContent: React.ComponentType<{ components?: Record<string, React.ComponentType<unknown>> }>

  try {
    const mdxModule = await compileMDX(content)
    MDXContent = mdxModule.default
  } catch (error) {
    console.error('Server MDX rendering error:', error)
    return (
      <div className="text-destructive p-4 border border-destructive rounded-md">
        <p className="font-semibold">Markdown Rendering Error</p>
        <p className="text-sm mt-2">{String(error)}</p>
      </div>
    )
  }

  // 3. Create components with files prop bound
  const components = createMDXComponents(files, { pageId, organizationSlug })

  return (
    <div className="markdown-content prose dark:prose-invert max-w-none">
      <MDXContent components={components} />
    </div>
  )
}
