/**
 * Shared `className` manipulation for rehype plugins.
 *
 * hast specifies `className` as a space-separated list, i.e. `string[]`, and
 * @types/hast >= 3.0.5 enforces that. Trees we touch can still carry a plain
 * string at runtime: remark plugins are free to hand-write `hProperties`, and
 * mdast-util-to-hast passes those through without normalizing. So the string
 * branch below is live, not dead — it just isn't reachable through the types.
 */
import type { Properties } from 'hast'

/** Normalize `className` to an array, tolerating a hand-written string. */
export function classList(properties: Properties): string[] {
  const existing = properties.className
  if (Array.isArray(existing)) return existing.map(String)
  if (typeof existing === 'string') return (existing as string).split(/\s+/).filter(Boolean)
  return []
}

/** Add `cls` to `properties.className`, no-op if already present. */
export function addClass(properties: Properties, cls: string): void {
  const list = classList(properties)
  if (!list.includes(cls)) list.push(cls)
  properties.className = list
}
