import { replaceOutsideFences } from '@/lib/markdown-fences'
import { setMediaLayoutAttrs, type MediaLayout } from '@/lib/media-layout'

/**
 * Source rewrites for the YouTube gizmos (start time, resize/align/wrap).
 * Called by markdown-renderer.client.tsx; pure so they can be unit-tested.
 *
 * A video is addressed by id + source line + `nth` (data-source-nth, set by
 * rehypeSourceLine): the nth embed of that id on that line, or in the whole
 * document when the embed has no line. All three source forms are counted
 * in ONE pattern, in document order, because rehypeSourceLine counts the
 * rendered embeds regardless of the form they were written in:
 *   - `<youtube … id="x" …>`            rewritten
 *   - `![caption](https://youtu.be/x)`  layout: replaced by a full tag; start time: left as is
 *   - `<youtube-embed … data-id="x" …>` counted, never rewritten
 * Returns null when nothing changes (the caller then does nothing).
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** One alternation over the three forms, so `nth` counts across them. */
function anyFormPattern(id: string): RegExp {
  const e = escapeRegExp(id)
  const tag = `<youtube\\s[^>]*\\bid=["']${e}["'][^>]*>`
  const raw = `<youtube-embed\\s[^>]*\\bdata-id=["']${e}["'][^>]*>`
  const shorthand = `!\\[[^\\]]*\\]\\(\\s*<?https?://[^)\\s]*${e}[^)]*\\)`
  return new RegExp(`${tag}|${raw}|${shorthand}`, 'i')
}

type Form = 'tag' | 'raw' | 'shorthand'
function formOf(match: string): Form {
  if (/^<youtube-embed/i.test(match)) return 'raw'
  return match.startsWith('<') ? 'tag' : 'shorthand'
}

function rewrite(content: string, id: string, line: number | undefined, nth: number, fn: (match: string, form: Form) => string): string | null {
  if (!content || !id) return null
  const out = replaceOutsideFences(content, anyFormPattern(id), (m) => fn(m, formOf(m)), line, nth)
  return out !== null && out !== content ? out : null
}

/** Set (or remove, when null/0) startTime on the addressed <youtube> tag. Only that attribute changes. */
export function rewriteYoutubeStartTime(content: string, id: string, startTime: number | null, line?: number, nth = 0): string | null {
  return rewrite(content, id, line, nth, (tag, form) => {
    if (form !== 'tag') return tag
    // Accepts the same shapes remark-plugins/youtube.ts parses: {123}, "123", '123', 123
    const stripped = tag.replace(/\s+startTime=(\{\d*\}|"\d*"|'\d*'|\d+)/, '')
    return startTime ? stripped.replace(/\s*(\/?>)$/, (_, end: string) => ` startTime="${startTime}"${end === '/>' ? ' />' : '>'}`) : stripped
  })
}

/**
 * Set width/align/wrap on the addressed video. A <youtube> tag keeps its other
 * attributes; a `![](url)` shorthand becomes `shorthandTag` (built by the
 * component), since the bracket syntax has no place for layout.
 */
export function rewriteYoutubeLayout(content: string, id: string, layout: MediaLayout, shorthandTag: string, line?: number, nth = 0): string | null {
  return rewrite(content, id, line, nth, (match, form) => {
    if (form === 'tag') return setMediaLayoutAttrs(match, layout)
    if (form === 'shorthand') return shorthandTag
    return match
  })
}
