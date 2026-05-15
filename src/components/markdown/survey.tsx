'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * Survey region wrapper.
 *
 * Marks a span of the page as part of a survey. `<question>` components
 * *inside* this region submit anonymously through the page-level
 * SurveyProvider rather than syncing per-user via useSyncedUserData.
 *
 * The page-level SurveyProvider (markdown-renderer.client.tsx) is mounted
 * once whenever any `<survey>` tag exists on the page, so its mere presence
 * is NOT enough to identify a survey question — a demo/info question outside
 * the region would otherwise be silently put in survey-mode and lose its
 * feedback rendering. This component therefore also provides its own region
 * context so questions can tell the difference.
 */
const SurveyRegionContext = createContext(false)

export function useInSurveyRegion(): boolean {
  return useContext(SurveyRegionContext)
}

export function Survey({ children }: { children?: ReactNode }) {
  return (
    <SurveyRegionContext.Provider value={true}>
      <section className="survey-region" data-survey-region="true">
        {children}
      </section>
    </SurveyRegionContext.Provider>
  )
}
