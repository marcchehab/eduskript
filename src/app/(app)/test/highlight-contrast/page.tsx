'use client'

// Temporary visual-contrast harness for <mark> / es-bg-* highlights and the
// sticky-note / snap title bars. Mirrors the classes used by
// src/components/annotations/{sticky-notes-layer,snaps-display}.tsx — it does
// not import them, so it drifts if those change. Delete when done checking.
const COLORS = ['yellow', 'red', 'green', 'blue', 'purple', 'pink', 'orange'] as const

const NOTE_CFG = {
  yellow: { bg: 'bg-yellow-50 dark:bg-yellow-950/50', header: 'bg-yellow-100 dark:bg-yellow-900/70', border: 'border-yellow-200 dark:border-yellow-800' },
  blue: { bg: 'bg-sky-50 dark:bg-sky-950/50', header: 'bg-sky-100 dark:bg-sky-900/70', border: 'border-sky-200 dark:border-sky-800' },
  green: { bg: 'bg-emerald-50 dark:bg-emerald-950/50', header: 'bg-emerald-100 dark:bg-emerald-900/70', border: 'border-emerald-200 dark:border-emerald-800' },
  pink: { bg: 'bg-rose-50 dark:bg-rose-950/50', header: 'bg-rose-100 dark:bg-rose-900/70', border: 'border-rose-200 dark:border-rose-800' },
  purple: { bg: 'bg-violet-50 dark:bg-violet-950/50', header: 'bg-violet-100 dark:bg-violet-900/70', border: 'border-violet-200 dark:border-violet-800' },
  orange: { bg: 'bg-orange-50 dark:bg-orange-950/50', header: 'bg-orange-100 dark:bg-orange-900/70', border: 'border-orange-200 dark:border-orange-800' },
} as const

export default function Page() {
  return (
    <div className="p-8 space-y-8 bg-background text-foreground min-h-screen">
      <button
        className="px-3 py-1.5 text-sm rounded border border-border"
        onClick={() => document.documentElement.classList.toggle('dark')}
      >
        Toggle dark
      </button>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">mark.text-highlight-*</h2>
        {COLORS.map(c => (
          <p key={c} className="text-lg">
            You can <mark className={`text-highlight text-highlight-${c}`}>highlight {c}</mark>, sure…
          </p>
        ))}
        <p className="text-lg">Bare <mark>mark element</mark> default.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">es-bg-*</h2>
        {COLORS.map(c => (
          <p key={c} className="text-lg">
            Span <span className={`es-bg-${c}`}>background {c}</span> inline.
          </p>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Note / snap title bars</h2>
        <div className="flex flex-wrap gap-3">
          {Object.entries(NOTE_CFG).map(([name, cfg]) => (
            <div key={name} className={`rounded-xl border shadow-md overflow-hidden w-56 ${cfg.bg} ${cfg.border}`}>
              <div className={`flex items-center gap-1 px-2 py-1.5 ${cfg.header} border-b ${cfg.border}`}>
                <span className="w-3 h-3 rounded-sm bg-current opacity-30 shrink-0" />
                <span className="w-3 h-3 rounded-sm bg-current opacity-50 shrink-0" />
                <span
                  className="snap-title text-xs opacity-85 truncate flex-1 min-w-0"
                  style={{ fontFamily: 'var(--font-heading), system-ui, sans-serif', fontWeight: 600 }}
                >
                  …or write a note ({name})
                </span>
              </div>
              <div className="p-3 text-sm">body text</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
