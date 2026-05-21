'use client'

/**
 * Marks the React tree as "this is an exam page".
 *
 * Currently used by `AnnotationToolbar` (id="annotation-toolbar") to hide
 * its class/student/audience selector — the `ClassToolbar`
 * (id="class-toolbar") at the top of the exam page is the canonical
 * class+student controller there, and two selectors writing to the same
 * `useTeacherClass()` context just confused teachers. Non-exam pages don't
 * mount this provider, so the default `false` keeps existing
 * audience-selector UX intact.
 */

import { createContext, useContext, type ReactNode } from 'react'

const ExamPageContext = createContext<boolean>(false)

export function ExamPageContextProvider({ children }: { children: ReactNode }) {
  return <ExamPageContext.Provider value={true}>{children}</ExamPageContext.Provider>
}

export function useIsExamPage(): boolean {
  return useContext(ExamPageContext)
}
