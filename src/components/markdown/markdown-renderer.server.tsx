import { compileMarkdown, footnoteLabelForLang } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'
import { getSkriptFiles } from '@/lib/skript-files.server'
import { extractStableLinkIds } from '@/lib/page-stable-link'
import { resolveStableLinks } from '@/lib/page-stable-link.server'
import { EagerImageLoader } from './eager-image-loader'
import { MarkdownErrorBoundary } from './markdown-error-boundary'
import { SurveyProvider } from './survey-provider'
import { CoupledVideoProvider } from './coupled-video-context'
import { StickMeProvider } from './stick-me'
import { StageFlow } from './stage-flow'
import { splitStages, hasStages } from '@/lib/markdown-stages'
import { splitSlides } from '@/lib/markdown-slides'
import { PresentButton } from './present-button'

interface ServerMarkdownRendererProps {
  content: string
  skriptId?: string
  pageId?: string
  organizationSlug?: string
  isExam?: boolean
  /** When true, the Present button is shown to everyone (not just teachers). */
  presentationPublic?: boolean
  /** Site language (BCP-47) — localizes the GFM footnotes heading. null/undefined → English. */
  pageLanguage?: string | null
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
export async function ServerMarkdownRenderer({ content, skriptId, pageId, organizationSlug, isExam, presentationPublic, pageLanguage }: ServerMarkdownRendererProps) {
  const footnoteLabel = footnoteLabelForLang(pageLanguage)
  // 1. Get all files for this skript upfront
  const files = skriptId ? await getSkriptFiles(skriptId) : createEmptySkriptFiles()

  // 2. Create components with files prop bound
  const components = createMarkdownComponents(files, { pageId, skriptId, organizationSlug, optimizeImages: true, isExam })

  // 3. Pre-resolve `/p/{id}` stable links to canonical URLs in one batched
  //    DB query so public HTML ships with real hrefs. Done here (server) so
  //    `markdown-compiler` stays free of `server-only` imports and can be
  //    safely bundled into client code paths (live editor preview, demo).
  const stableIds = extractStableLinkIds(content)
  const resolvedStableLinks = stableIds.length > 0
    ? await resolveStableLinks(stableIds)
    : undefined

  // 4. Compile markdown (safe pipeline, no JS execution). When the document has
  //    <next-stage> markers, compile each stage separately and hand them to
  //    StageFlow for the sequential, hand-in-locked reveal (see splitStages).
  //    Only the async compile (a function call) happens in the try; the JSX is
  //    built afterward (lint forbids constructing JSX inside try/catch).
  const staged = Boolean(pageId && hasStages(content))
  let compiledStages: React.ReactNode[] = []
  let stageMarkers: ReturnType<typeof splitStages>['markers'] = []
  let rendered: React.ReactNode = null
  // Slides: split the same source on `---`/`---/`/heading markers and compile
  // each chunk with the same components, so the page can be presented as slides.
  // Skipped for exams. Reuses the staged pattern above.
  let compiledSlides: React.ReactNode[] = []
  let slideStartLines: number[] = []
  let error: unknown

  try {
    if (staged) {
      const split = splitStages(content)
      stageMarkers = split.markers
      compiledStages = await Promise.all(
        split.stages.map((s) => compileMarkdown(s, { components, resolvedStableLinks, footnoteLabel })),
      )
    } else {
      rendered = await compileMarkdown(content, { components, resolvedStableLinks, footnoteLabel })
    }
    if (!isExam) {
      const slideSplit = splitSlides(content)
      slideStartLines = slideSplit.startLines
      compiledSlides = await Promise.all(
        // anchors:false — slides re-render the page's content; emitting the same
        // heading ids / data-section-id again would collide in the DOM.
        slideSplit.slides.map((s) => compileMarkdown(s, { components, resolvedStableLinks, anchors: false, footnoteLabel })),
      )
    }
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

  // Mount the SurveyProvider only when the page contains a <Survey> region.
  // Case-insensitive regex so we catch the source-level <Survey> before
  // remarkSurvey lowercases it. Provider is a 'use client' component so
  // its useState/useSession/etc. run in the browser; server just declares
  // it in the tree.
  const hasSurvey = pageId && /<survey[\s>]/i.test(content)

  const body = staged && pageId ? (
    <StageFlow
      pageId={pageId}
      stages={compiledStages.map((node, i) => (
        <MarkdownErrorBoundary key={i}>{node}</MarkdownErrorBoundary>
      ))}
      markers={stageMarkers}
    />
  ) : (
    <MarkdownErrorBoundary>{rendered}</MarkdownErrorBoundary>
  )

  // Mount the CoupledVideoProvider when the page wires a video to checks
  // (a `coupled` attr or any `gate-at` mark). Author default is on unless
  // explicitly `coupled="false"`. Mirrors markdown-renderer.client.tsx.
  const hasCoupling = pageId && (/\bcoupled\s*=/i.test(content) || /\bgate-at\s*=/i.test(content))
  const initialCoupled = !/\bcoupled\s*=\s*["']?false/i.test(content)

  // The Present button (and the slides it holds) lives alongside the scroll
  // body INSIDE the providers below, so a slide containing a <survey>/coupled
  // video/<stickme> gets the same context the scroll body does. The button is
  // `fixed`, so it escapes this layout; slides render in a fullscreen overlay.
  const presentButton =
    !isExam && compiledSlides.length > 0 ? (
      <PresentButton
        slides={compiledSlides.map((node, i) => (
          <MarkdownErrorBoundary key={i}>{node}</MarkdownErrorBoundary>
        ))}
        slideStartLines={slideStartLines}
        publiclyVisible={presentationPublic ?? false}
      />
    ) : null

  let wrapped: React.ReactNode = (
    <>
      {body}
      {presentButton}
    </>
  )
  if (hasSurvey && pageId) {
    wrapped = <SurveyProvider pageId={pageId}>{wrapped}</SurveyProvider>
  }
  if (hasCoupling && pageId) {
    wrapped = (
      <CoupledVideoProvider pageId={pageId} initialCoupled={initialCoupled}>
        {wrapped}
      </CoupledVideoProvider>
    )
  }
  // Coordinates multiple pinned StickMe/videos so only one is pinned at a time.
  if (/<stickme/i.test(content) || /\bpin\s*=/i.test(content)) {
    wrapped = <StickMeProvider>{wrapped}</StickMeProvider>
  }

  return (
    <EagerImageLoader>
      <div className="markdown-content prose dark:prose-invert max-w-none">
        {wrapped}
      </div>
    </EagerImageLoader>
  )
}
