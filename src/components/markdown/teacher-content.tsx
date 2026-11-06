'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useCanEditPage } from '@/lib/print/can-edit'
import { usePrintState } from '@/lib/print/print-mode'
import { Solution } from '@/components/markdown/solution'
import type { SkriptFilesData } from '@/lib/skript-files'
import type { TeacherSolution } from '@/lib/teacher-content'

/**
 * Teacher content on public pages (see lib/teacher-content.ts): the shared
 * render only has `data-teacher-slot` placeholders. For page authors
 * (useCanEditPage) the originals come from /api/pages/[id]/teacher-content
 * and are compiled here in the browser, with the same pipeline and
 * components as the editor preview. The compiler is imported lazily, so
 * students never download it (they never get past useCanEditPage).
 *
 * One request + compile per page, shared by all slots (module cache, kept
 * CACHE_MS so a later visit after an edit refetches).
 */

interface Compiled { solutions: Array<{ title: string | null; node: ReactNode }>; answers: ReactNode[] }

const CACHE_MS = 10_000
const cache = new Map<string, { at: number; promise: Promise<Compiled | null> }>()

async function load(pageId: string): Promise<Compiled | null> {
  const r = await fetch(`/api/pages/${pageId}/teacher-content`)
  if (!r.ok) return null
  const data = (await r.json()) as { solutions: TeacherSolution[]; answers: string[]; files: SkriptFilesData; skriptId: string }
  const [{ compileMarkdown }, { createMarkdownComponents }] = await Promise.all([
    import('@/lib/markdown-compiler'),
    import('@/lib/markdown-components'),
  ])
  const components = createMarkdownComponents(data.files, { pageId, skriptId: data.skriptId })
  // Answers sit inside a line: no paragraph around them.
  const inline = { ...components, p: ({ children }: { children?: ReactNode }) => <>{children}</> }
  const [solutions, answers] = await Promise.all([
    Promise.all(data.solutions.map(async (s) => ({ title: s.title, node: await compileMarkdown(s.markdown, { components, anchors: false }) }))),
    Promise.all(data.answers.map((md) => compileMarkdown(md, { components: inline, anchors: false }))),
  ])
  return { solutions, answers }
}

function useTeacherContent(pageId: string | undefined): Compiled | null {
  const canEdit = useCanEditPage(pageId)
  const [content, setContent] = useState<Compiled | null>(null)
  useEffect(() => {
    if (!canEdit || !pageId) return
    let entry = cache.get(pageId)
    if (!entry || Date.now() - entry.at > CACHE_MS) {
      entry = { at: Date.now(), promise: load(pageId).catch(() => null) }
      cache.set(pageId, entry)
    }
    let cancelled = false
    void entry.promise.then((c) => { if (!cancelled) setContent(c) })
    return () => { cancelled = true }
  }, [canEdit, pageId])
  return content
}

/** Placeholder of a stripped `<solution teacher>`: the solution, for authors only. */
export function TeacherSolutionSlot({ slot, pageId }: { slot: number; pageId?: string }) {
  const content = useTeacherContent(pageId)
  const solution = content?.solutions[slot]
  if (!solution) return null
  return <Solution teacher title={solution.title ?? undefined} pageId={pageId}>{solution.node}</Solution>
}

/**
 * The line of a <blank>, with its answer written in, in pen colour
 * (.blank-answer, globals.css), when there is one to show. The answer is
 * either compiled with the page (`children`: editor preview, which has the
 * full markdown) or fetched by `slot` (public page, authors only). In the
 * print view it shows only in the teacher copy. Without an answer the line is
 * exactly the plain blank; with one it grows with a longer answer (minWidth),
 * so an author's layout can differ slightly from the students'.
 */
export function BlankLine({ width, slot, pageId, children }: { width: number; slot?: number; pageId?: string; children?: ReactNode }) {
  const { active, teacher } = usePrintState()
  const content = useTeacherContent(slot != null ? pageId : undefined)
  const answer = slot != null ? content?.answers[slot] : children
  if (answer == null || (active && !teacher)) {
    return <span aria-hidden="true" className="blank-line" style={{ width }}>{'\u00a0'}</span>
  }
  return <span className="blank-line" style={{ minWidth: width }}><span className="blank-answer">{answer}</span>{'\u00a0'}</span>
}
