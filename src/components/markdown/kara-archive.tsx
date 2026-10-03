'use client'

/**
 * `<kara-archive of="w5-l3">`: the code a student wrote for a Kara level with
 * `archive: true`, as saved at the latest win (src/lib/kara/progress.ts), shown
 * read-only in a terminal frame. When nothing is saved (other browser while
 * logged out, level never won, no skript context such as the dashboard
 * preview) it shows the author's fallback: the `fallback` attribute (`\n`
 * = newline) or the element's text children (a ```python fence inside the
 * tag). Lines appear one after the other once the block scrolls into view
 * (no animation with prefers-reduced-motion, see the inline <style>).
 *
 * The saved code is read from the student's own progress record only; there
 * is no teacher view of it.
 */

import { useEffect, useRef, useState } from 'react'
import { useUserDataContext } from '@/lib/userdata/provider'
import { loadKaraArchive, subscribeKaraProgress, type KaraArchived } from '@/lib/kara/progress'

export const KARA_ARCHIVE_TITLE = 'Archiv · Wartungsauftrag 4471 · Tag 120, 23:41'

export interface KaraArchiveProps {
  skriptId?: string
  /** Level id (`id:` in the kara-world block, else the editor id). */
  of: string
  title?: string
  /** Fallback code (attribute or children text), already as plain text. */
  fallback?: string
}

/**
 * Plain code from a fallback: `\n` escapes become newlines; a ``` fence that
 * reached the component as literal text (no blank line after the opening
 * tag) is unwrapped; surrounding blank lines are dropped.
 */
export function karaArchiveFallback(raw: string | undefined): string {
  if (!raw) return ''
  let text = raw.includes('\n') ? raw : raw.replace(/\\n/g, '\n')
  const fence = text.match(/^\s*(```|~~~)[^\n]*\n([\s\S]*?)\n?\s*\1\s*$/)
  if (fence) text = fence[2]
  return text.replace(/^\s*\n/, '').replace(/\s+$/, '')
}

// Explicit stack: in a headless test, the font-mono class alone rendered the page's body font here (cause not tracked down).
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

type State = { kind: 'loading' } | { kind: 'saved'; entry: KaraArchived } | { kind: 'fallback' }

export function KaraArchive({ skriptId, of, title = KARA_ARCHIVE_TITLE, fallback }: KaraArchiveProps) {
  const { isDbReady } = useUserDataContext()
  const [state, setState] = useState<State>(skriptId ? { kind: 'loading' } : { kind: 'fallback' })
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!skriptId || !isDbReady) return
    let alive = true
    const apply = (entry: KaraArchived | null | undefined) => { if (alive) setState(entry ? { kind: 'saved', entry } : { kind: 'fallback' }) }
    void loadKaraArchive(skriptId, of).then(apply)
    const unsubscribe = subscribeKaraProgress(skriptId, p => apply(p.archive?.[of]))
    return () => { alive = false; unsubscribe() }
  }, [skriptId, isDbReady, of])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // No observer (old browser, tests): show at once. Reduced motion is handled in CSS.
    if (typeof IntersectionObserver === 'undefined') { void Promise.resolve().then(() => setVisible(true)); return }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect() }
    }, { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const code = state.kind === 'saved' ? state.entry.code : state.kind === 'fallback' ? karaArchiveFallback(fallback) : ''
  const lines = code.replace(/\s+$/, '').split('\n')
  const width = String(lines.length).length
  const source = state.kind === 'saved'
    ? `source: your program · ${new Date(state.entry.at).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}`
    : state.kind === 'fallback' ? 'source: reference copy' : 'loading…'

  return (
    <div ref={ref} className="not-prose my-6 overflow-hidden rounded-lg border border-slate-700 bg-slate-950 font-mono text-[13px] text-slate-200 shadow-lg" style={{ fontFamily: MONO }} data-interactive="true" data-kara-archive={of}>
      <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5 text-[11px] uppercase tracking-wider text-amber-300">
        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 normal-case tracking-normal text-slate-500">read-only</span>
      </div>
      {/* A div, not <pre>: .prose-theme pre would paint it with the page's code-block colors. */}
      <div role="region" className="overflow-x-auto whitespace-pre px-3 py-3 leading-relaxed" aria-label={`Archived code of ${of}`}>
        {state.kind !== 'loading' && lines.map((line, i) => (
          <div
            key={i}
            className={visible ? 'kara-archive-line' : 'opacity-0'}
            style={visible ? { animationDelay: `${i * 70}ms` } : undefined}
          >
            <span className="mr-3 inline-block select-none text-right text-slate-600" style={{ width: `${width}ch` }}>{i + 1}</span>
            <span className="text-emerald-300">{line || ' '}</span>
          </div>
        ))}
        {state.kind !== 'loading' && (
          <span
            className={`${visible ? 'kara-archive-cursor' : 'opacity-0'} inline-block h-4 w-2 translate-y-0.5 bg-emerald-300`}
            style={{ marginLeft: `calc(${width}ch + 0.75rem)`, ...(visible ? { animationDelay: `${lines.length * 70}ms` } : {}) }}
            aria-hidden
          />
        )}
      </div>
      <div className="border-t border-slate-800 px-3 py-1 text-[11px] text-slate-500">{source}</div>
      <style>{`
        .kara-archive-line { opacity: 0; animation: kara-archive-in 0.25s ease-out forwards; }
        .kara-archive-cursor { opacity: 0; animation: kara-archive-in 0.1s forwards, kara-archive-blink 1s steps(1) infinite; }
        @keyframes kara-archive-in { from { opacity: 0; transform: translateX(-4px); } to { opacity: 1; transform: none; } }
        @keyframes kara-archive-blink { 50% { opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .kara-archive-line, .kara-archive-cursor { animation: none; opacity: 1; } }
      `}</style>
    </div>
  )
}
