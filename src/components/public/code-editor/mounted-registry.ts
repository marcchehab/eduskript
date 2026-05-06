// Module-level registry of currently-mounted code-editor componentIds, keyed
// by pageId. Used by the orphaned-versions feature to compute "componentIds
// present in IndexedDB for this pageId but not on screen".
//
// Sets are *replaced* (not mutated) on every change so consumers using
// `useSyncExternalStore` get stable reference equality between unchanged
// reads and a new reference whenever the contents change. The empty case
// returns a shared sentinel Set so a page with no registered editors yet
// doesn't churn references on every read either.

const byPage = new Map<string, Set<string>>()
const listeners = new Set<() => void>()
const EMPTY_SET: Set<string> = new Set()

function notify() {
  listeners.forEach((l) => l())
}

export function registerEditor(pageId: string, componentId: string): () => void {
  const current = byPage.get(pageId)
  const next = new Set(current)
  next.add(componentId)
  byPage.set(pageId, next)
  notify()

  return () => {
    const cur = byPage.get(pageId)
    if (!cur || !cur.has(componentId)) return
    const updated = new Set(cur)
    updated.delete(componentId)
    if (updated.size === 0) byPage.delete(pageId)
    else byPage.set(pageId, updated)
    notify()
  }
}

export function getMountedIds(pageId: string): Set<string> {
  return byPage.get(pageId) ?? EMPTY_SET
}

export function subscribeToMounted(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
