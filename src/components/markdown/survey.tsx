'use client'

import { type ReactNode } from 'react'

/**
 * Survey region wrapper.
 *
 * Marks a span of the page as part of a survey. All `<Question>` components
 * inside should submit anonymously through the page-level SurveyProvider
 * rather than syncing per-user via the usual useSyncedUserData hook.
 *
 * Multiple <Survey> regions on the same page are valid and all share the
 * same survey identity (= pageId). The SurveyProvider (mounted higher in
 * the tree by markdown-renderer.client.tsx) coordinates them.
 *
 * v1: this component is a stub region marker. The provider integration,
 * SurveyContext, and submission flow land in follow-up commits.
 */
export function Survey({ children }: { children?: ReactNode }) {
  return (
    <section className="survey-region" data-survey-region="true">
      {children}
    </section>
  )
}
