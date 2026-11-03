import { Suspense } from 'react'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { type PublicAnnotation, type PublicSnap } from '@/components/public/annotation-wrapper'
import { ReflowGate } from '@/components/public/reflow-gate'
import { ReflowWidthHandle } from '@/components/public/reflow-width-handle'
import { ForkAttribution } from '@/components/public/fork-attribution'
import { ClassToolbar } from '@/components/teacher/class-toolbar'
import type { StickyNote } from '@/components/annotations/sticky-notes-layer'

interface PublicPageBodyProps {
  page: {
    id: string
    content: string
    pageType?: string | null
    presentationPublic?: boolean | null
    forkedFromPageId: string | null
    forkedFromAuthorId: string | null
  }
  skriptId: string
  publicAnnotations: PublicAnnotation[]
  publicSnaps: PublicSnap[]
  /** Public sticky notes pre-fetched on the server. Empty array when none. */
  publicStickyNotes: StickyNote[]
  /** True when the viewer is authenticated in an SEB exam session (no NextAuth session). */
  isExamStudent?: boolean
  /**
   * pageSlug of the site this page lives under (markdown asset resolution).
   */
  teacherPageSlug: string
  /**
   * Site the page is rendered on (route context). The class toolbar uses it
   * to self-gate to "viewer manages this site" (src/lib/site-access.ts).
   */
  siteId: string | null
  /** Site language (BCP-47) — localizes the GFM footnotes heading. null → English. */
  pageLanguage?: string | null
}

/**
 * Shared render tree for the public page and the exam page. Kept permission-
 * agnostic: `isPageAuthor` is determined client-side inside AnnotationLayer
 * (see annotation-layer.tsx:349-368) so this body can live on an ISR route.
 *
 * The `ClassToolbar` (id="class-toolbar") is mounted unconditionally for
 * non-exam pages and self-gates on site-management + paid-teacher via
 * its own fetches — same ISR-friendly pattern as the annotation layer. Exam
 * pages skip the mount here because the `/exam/...` route mounts the toolbar
 * separately above this body with full server-side props (state controls,
 * unlocked classes).
 */
export function PublicPageBody({ page, skriptId, publicAnnotations, publicSnaps, publicStickyNotes, isExamStudent, teacherPageSlug, siteId, pageLanguage }: PublicPageBodyProps) {
  const showToolbar = page.pageType !== 'exam' && !isExamStudent
  return (
    <>
      {showToolbar && (
        // ClassToolbar calls useSearchParams() (deep-link ?classId=&student=);
        // without a Suspense boundary it forces this ISR-prerendered page to
        // bail out to full client-side rendering. Suspense lets the static
        // shell prerender while the toolbar resolves search params on the client.
        <Suspense fallback={null}>
          <ClassToolbar
            pageId={page.id}
            pageType={page.pageType ?? 'standard'}
            unlockedClasses={[]}
            siteId={siteId}
          />
        </Suspense>
      )}
      <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border relative">
        <ReflowWidthHandle />
        <article className="prose-theme">
          <ReflowGate
            pageId={page.id}
            content={page.content}
            publicAnnotations={publicAnnotations}
            publicSnaps={publicSnaps}
            publicStickyNotes={publicStickyNotes}
            isExamStudent={isExamStudent}
          >
            <ServerMarkdownRenderer
              content={page.content}
              skriptId={skriptId}
              pageId={page.id}
              ownerPageSlug={teacherPageSlug}
              isExam={page.pageType === 'exam'}
              presentationPublic={page.presentationPublic ?? false}
              pageLanguage={pageLanguage}
            />
          </ReflowGate>
        </article>
        {(page.forkedFromPageId || page.forkedFromAuthorId) && (
          // Outside the paper's right edge, top-aligned, reading top to bottom
          // (vertical-rl = text turned 90° clockwise). Hidden below md, where the
          // paper spans the screen and there is no margin to hold it. Padding,
          // not margin: padding counts toward the scrollable width, so when the
          // paper is zoomed past the viewport the label keeps a gap to the edge.
          <div className="absolute top-12 left-full pl-2 pr-6 hidden md:block [writing-mode:vertical-rl]">
            <ForkAttribution
              forkedFromPageId={page.forkedFromPageId}
              forkedFromAuthorId={page.forkedFromAuthorId}
            />
          </div>
        )}
      </div>
    </>
  )
}
