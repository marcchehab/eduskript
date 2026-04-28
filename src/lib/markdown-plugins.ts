/**
 * Markdown Plugin Arrays
 *
 * Separated from markdown-compiler.ts to avoid circular dependencies
 * with rehype plugins that need to re-process markdown content.
 */

import type { PluggableList } from 'unified'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import { remarkTabs } from './remark-plugins/tabs'
import { remarkImageResolver } from './remark-plugins/image-resolver'
import { remarkExcalidraw } from './remark-plugins/excalidraw'
import { remarkCodeEditor } from './remark-plugins/code-editor'
import { remarkCallouts } from './remark-plugins/callouts'
import { remarkMuxVideo } from './remark-plugins/mux-video'
import { remarkYoutube } from './remark-plugins/youtube'
import { remarkYoutubeImage } from './remark-plugins/youtube-image'
import { remarkQuiz } from './remark-plugins/quiz'
import { remarkFileLinkResolver } from './remark-plugins/file-link-resolver'
import { remarkMermaid } from './remark-plugins/mermaid'

/**
 * Remark plugins - transform markdown AST
 */
export const remarkPlugins: PluggableList = [
  remarkTabs,
  remarkQuiz,
  remarkGfm,
  remarkMath,
  remarkYoutubeImage,
  remarkImageResolver,
  remarkExcalidraw,
  remarkMuxVideo,
  remarkMermaid,
  remarkCodeEditor,
  remarkCallouts,
  remarkYoutube,
  remarkFileLinkResolver,
]
