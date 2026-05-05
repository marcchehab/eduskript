import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper, type PublicAnnotation, type PublicSnap } from '@/components/public/annotation-wrapper'
import { ForkAttribution } from '@/components/public/fork-attribution'
import type { StickyNote } from '@/components/annotations/sticky-notes-layer'

interface PublicPageBodyProps {
  page: {
    id: string
    content: string
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
}

/**
 * Shared render tree for the public page and the exam page. Kept permission-
 * agnostic: `isPageAuthor` is determined client-side inside AnnotationLayer
 * (see annotation-layer.tsx:349-368) so this body can live on an ISR route.
 */
export function PublicPageBody({ page, skriptId, publicAnnotations, publicSnaps, publicStickyNotes, isExamStudent }: PublicPageBodyProps) {
  return (
    <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border relative">
      {(page.forkedFromPageId || page.forkedFromAuthorId) && (
        <div className="absolute top-16 right-16">
          <ForkAttribution
            forkedFromPageId={page.forkedFromPageId}
            forkedFromAuthorId={page.forkedFromAuthorId}
          />
        </div>
      )}
      <article className="prose-theme">
        <AnnotationWrapper
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
          />
        </AnnotationWrapper>
      </article>
    </div>
  )
}
