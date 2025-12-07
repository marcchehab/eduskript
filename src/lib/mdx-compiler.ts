/**
 * Unified MDX Compiler
 *
 * Single compilation configuration used by both SSR and CSR.
 * Remark plugins are PURE TRANSFORMERS - they do NOT resolve files.
 * File resolution happens in components via SkriptFiles.
 */

import { compile, run } from '@mdx-js/mdx'
import * as prodRuntime from 'react/jsx-runtime'
import * as devRuntime from 'react/jsx-dev-runtime'
import type { ComponentType } from 'react'
import type { PluggableList } from 'unified'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import rehypeSlug from 'rehype-slug'
import { remarkTabs } from './remark-plugins/tabs'
import { remarkImageResolver } from './remark-plugins/image-resolver'
import { remarkExcalidraw } from './remark-plugins/excalidraw'
import { remarkCodeEditor } from './remark-plugins/code-editor'
import { remarkCallouts } from './remark-plugins/callouts'
import { remarkMuxVideo } from './remark-plugins/mux-video'
import { remarkYoutube } from './remark-plugins/youtube'
import { remarkQuiz } from './remark-plugins/quiz'
import { rehypeSourceLine } from './rehype-plugins/source-line'
import { rehypeColorTitle } from './rehype-plugins/color-title'
import { rehypeStripInvalidProps } from './rehype-plugins/strip-invalid-props'

export interface MDXModule {
  default: ComponentType<{ components?: Record<string, ComponentType<any>> }>
}

/**
 * Remark plugins for MDX - PURE TRANSFORMERS only.
 * These plugins transform syntax, they do NOT resolve file URLs.
 */
export const remarkPlugins: PluggableList = [
  remarkTabs,
  remarkQuiz,
  remarkGfm,
  remarkMath,
  // File-type plugins - mark nodes for component handling
  remarkImageResolver,  // Marks images with data-original-src
  remarkExcalidraw,     // Transforms ![](*.excalidraw) to <excalidraw-image>
  remarkMuxVideo,       // Transforms ![](*.mp4) to <muxvideo>
  // Content transformation plugins
  remarkCodeEditor,
  remarkCallouts,
  remarkYoutube,
]

/**
 * Rehype plugins for MDX.
 */
export const rehypePlugins: PluggableList = [
  rehypeSlug,
  rehypeColorTitle,
  rehypeStripInvalidProps, // Strip invalid HTML attributes BEFORE KaTeX adds its styles
  rehypeKatex,
  rehypeSourceLine,
]

export interface CompileMDXOptions {
  /** Base URL for resolving imports. Defaults to import.meta.url on server. */
  baseUrl?: string
}

/**
 * MDX compilation - works for both SSR and CSR.
 * Compiles MDX content and returns a React component.
 *
 * Usage:
 * ```ts
 * // Server (default baseUrl)
 * const { default: MDXContent } = await compileMDX(content)
 *
 * // Client (pass window.location.href)
 * const { default: MDXContent } = await compileMDX(content, {
 *   baseUrl: window.location.href
 * })
 * ```
 */
export async function compileMDX(
  content: string,
  options?: CompileMDXOptions
): Promise<MDXModule> {
  const isDev = process.env.NODE_ENV === 'development'

  // Compile MDX to JavaScript
  const compiled = await compile(content, {
    outputFormat: 'function-body',
    remarkPlugins,
    rehypePlugins,
    development: isDev,
  })

  // Select JSX runtime based on environment
  // In development, use dev runtime for better error messages
  const runtime = isDev ? devRuntime : prodRuntime

  // Run the compiled code to get the React component
  const mdxModule = await run(String(compiled), {
    ...runtime,
    baseUrl: options?.baseUrl ?? import.meta.url,
  })

  return mdxModule as MDXModule
}
