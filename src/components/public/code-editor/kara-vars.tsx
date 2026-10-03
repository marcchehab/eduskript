'use client'

/**
 * Variable drawers under the Kara world: one labelled box per variable of the
 * student's program, showing its value after the replayed position (decoded by
 * buildVars in src/lib/kara/world.ts from the trace's `w` deltas, recorded by
 * kara-module.ts `_watch`). Every variable the run ever had gets its box from
 * the start (empty until assigned), so the strip never changes height while
 * stepping. A value the current step changed is highlighted. Locals show as
 * `fn.name`. The course explains variables as a drawer with a label
 * (Woche 4), hence the look: label tab on top, value inside.
 */
import { cn } from '@/lib/utils'
import type { KaraVars } from '@/lib/kara/world'

export function KaraVarsStrip({ vars, pos }: { vars: KaraVars; pos: number }) {
  const now = vars.at(pos)
  const changed = new Set(vars.changed(pos))
  return (
    <div
      className="flex shrink-0 flex-wrap items-end gap-1.5 border-t bg-muted/20 px-2 py-1.5"
      title="Variables after this step"
      aria-label="Variables"
    >
      {vars.names.map(name => {
        const value = now[name]
        const hot = changed.has(name)
        return (
          <div key={name} className="flex min-w-0 max-w-[14rem] flex-col items-start">
            <span className="rounded-t border border-b-0 bg-background px-1.5 font-mono text-[10px] leading-4 text-muted-foreground">
              {name}
            </span>
            <span
              className={cn(
                'min-w-[3rem] max-w-full truncate rounded-b rounded-tr border border-b-2 px-1.5 py-0.5 font-mono text-xs tabular-nums transition-colors',
                value === undefined
                  ? 'text-muted-foreground/50'
                  : hot
                    ? 'border-amber-400 bg-amber-100 text-amber-950 dark:border-amber-500/70 dark:bg-amber-900/40 dark:text-amber-100'
                    : 'bg-background',
              )}
              title={value ?? 'not defined yet'}
            >
              {value ?? '–'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
