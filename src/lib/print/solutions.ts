'use client'

/**
 * Solutions collected for the end of the print view. <solution>, [!solution]
 * callouts and quiz answer keys register here while the print view is open;
 * PrintSolutions renders them in document order (sorted by their placeholder's
 * DOM position, since React mount order is not guaranteed to be page order).
 */

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react'

export interface SolutionEntry {
  id: string
  title?: string
  /** Read at render time, so a re-render of the source does not re-register. */
  content: RefObject<ReactNode>
  /** Quiz keys: the question itself is the heading at the end (may hold math). */
  heading?: RefObject<ReactNode>
  anchor: RefObject<HTMLElement | null>
}

let entries: SolutionEntry[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

function inDocumentOrder(list: SolutionEntry[]): SolutionEntry[] {
  return [...list].sort((a, b) => {
    const x = a.anchor.current
    const y = b.anchor.current
    if (!x || !y) return 0
    return x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  })
}

export function useSolutionEntries(): SolutionEntry[] {
  return useSyncExternalStore(subscribe, () => entries, () => entries)
}

/**
 * Printed name of a solution: its title, or "Solution n" counting only the
 * untitled ones in document order (a title already identifies the task).
 */
export function solutionLabel(list: SolutionEntry[], id: string): string | null {
  const entry = list.find((e) => e.id === id)
  if (!entry) return null
  if (entry.title) return entry.title
  if (entry.heading) return 'Answer'
  return `Solution ${list.filter((e) => !e.title && !e.heading).findIndex((e) => e.id === id) + 1}`
}

/**
 * Register a solution while `active`. Returns its printed label
 * (solutionLabel), or null while not registered. Content changes re-register.
 */
export function useRegisterSolution(
  active: boolean,
  anchor: RefObject<HTMLElement | null>,
  content: ReactNode,
  title?: string,
  heading?: ReactNode,
): string | null {
  const id = useId()
  const contentRef = useRef<ReactNode>(content)
  const headingRef = useRef<ReactNode>(heading)
  const hasHeading = heading != null
  useEffect(() => { contentRef.current = content; headingRef.current = heading })
  useEffect(() => {
    if (!active) return
    entries = inDocumentOrder([...entries.filter((e) => e.id !== id), { id, title, content: contentRef, heading: hasHeading ? headingRef : undefined, anchor }])
    emit()
    return () => {
      entries = entries.filter((e) => e.id !== id)
      emit()
    }
  }, [active, id, title, hasHeading, anchor])
  const list = useSolutionEntries()
  return solutionLabel(list, id)
}

/** Plain text of a React node (titles for the solution list). */
export function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (node && typeof node === 'object' && 'props' in node) return nodeText((node as { props: { children?: ReactNode } }).props.children)
  return ''
}

const MEDIA_TAGS = new Set(['img', 'svg', 'iframe', 'video', 'audio', 'canvas', 'math', 'hr'])

/**
 * True when a node renders nothing a reader would see: only whitespace text
 * and plain HTML wrappers around it. Components (function types) and media
 * count as content, since their output is unknown here.
 */
export function isEmptyContent(node: ReactNode): boolean {
  if (node == null || typeof node === 'boolean') return true
  if (typeof node === 'string') return node.trim() === ''
  if (typeof node === 'number') return false
  if (Array.isArray(node)) return node.every(isEmptyContent)
  if (typeof node === 'object' && 'props' in node) {
    const el = node as { type: unknown; props: { children?: ReactNode } }
    if (typeof el.type !== 'string' || MEDIA_TAGS.has(el.type)) return false
    return isEmptyContent(el.props.children)
  }
  return false
}
