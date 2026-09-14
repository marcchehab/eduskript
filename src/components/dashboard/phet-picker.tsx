'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Orbit } from 'lucide-react'
import {
  PHET_ATTRIBUTION,
  phetThumbnailUrl,
  phetTitle,
  searchPhetSims,
  type PhetSimSummary,
  type PhetSubject,
} from '@/lib/phet'

interface PhetPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInsert: (sim: string, locale: string) => void
}

const SUBJECTS: { key: PhetSubject | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'physics', label: 'Physics' },
  { key: 'chemistry', label: 'Chemistry' },
  { key: 'math', label: 'Maths' },
  { key: 'biology', label: 'Biology' },
  { key: 'earth-and-space', label: 'Earth & Space' },
]

const LOCALES: { key: string; label: string }[] = [
  { key: 'de', label: 'Deutsch' },
  { key: 'en', label: 'English' },
  { key: 'fr', label: 'Français' },
  { key: 'it', label: 'Italiano' },
]

const LOCALE_STORAGE_KEY = 'phet-picker-locale'

// Module-level so reopening the dialog doesn't refetch the catalogue.
let catalogueCache: PhetSimSummary[] | null = null

/**
 * Searchable PhET catalogue (thumbnails, subject filter, sim language) that
 * inserts `<phet sim="…" locale="…" />`. Data: /api/phet/sims. Search matches
 * slug + en/de/fr/it titles and descriptions (searchPhetSims in lib/phet.ts).
 * Keyboard: arrows move the highlight, Enter inserts it.
 */
export function PhetPicker({ open, onOpenChange, onInsert }: PhetPickerProps) {
  const [sims, setSims] = useState<PhetSimSummary[] | null>(catalogueCache)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState<PhetSubject | null>(null)
  const [locale, setLocale] = useState('de')
  const [active, setActive] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setError(false)
    try {
      const res = await fetch('/api/phet/sims')
      if (!res.ok) throw new Error(String(res.status))
      const json = (await res.json()) as { sims: PhetSimSummary[] }
      catalogueCache = json.sims
      setSims(json.sims)
    } catch (err) {
      console.error('Failed to load PhET catalogue:', err)
      setError(true)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    try {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
      if (saved && LOCALES.some((l) => l.key === saved)) setLocale(saved)
    } catch { /* storage unavailable */ }
    if (!catalogueCache) load()
  }, [open, load])

  const results = useMemo(() => (sims ? searchPhetSims(sims, query, subject) : []), [sims, query, subject])

  useEffect(() => { setActive(0) }, [query, subject])

  useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const changeLocale = (next: string) => {
    setLocale(next)
    try { localStorage.setItem(LOCALE_STORAGE_KEY, next) } catch { /* storage unavailable */ }
  }

  const choose = (sim: PhetSimSummary) => {
    onInsert(sim.sim, locale)
    onOpenChange(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!results.length) return
    const columns = gridRef.current
      ? getComputedStyle(gridRef.current).gridTemplateColumns.split(' ').length
      : 1
    const move = (delta: number) => {
      e.preventDefault()
      setActive((i) => Math.min(results.length - 1, Math.max(0, i + delta)))
    }
    if (e.key === 'ArrowRight') move(1)
    else if (e.key === 'ArrowLeft') move(-1)
    else if (e.key === 'ArrowDown') move(columns)
    else if (e.key === 'ArrowUp') move(-columns)
    else if (e.key === 'Enter') {
      e.preventDefault()
      const sim = results[active]
      if (sim) choose(sim)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col gap-3" onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Orbit className="w-5 h-5" />
            Insert PhET simulation
          </DialogTitle>
          <DialogDescription>
            Interactive simulations for physics, chemistry and maths — free to embed (CC BY 4.0).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search, e.g. Wurf, pendulum, Ableitung…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
            Language
            <select
              value={locale}
              onChange={(e) => changeLocale(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            >
              {LOCALES.map((l) => (
                <option key={l.key} value={l.key}>{l.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SUBJECTS.map(({ key, label }) => {
            const count = sims ? (key ? sims.filter((s) => s.subjects.includes(key)).length : sims.length) : null
            return (
              <button
                key={label}
                type="button"
                onClick={() => setSubject(key)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  subject === key
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
                }`}
              >
                {label}{count !== null && <span className="ml-1 opacity-70">{count}</span>}
              </button>
            )
          })}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-2 px-2">
          {error ? (
            <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
              Could not load the PhET catalogue.
              <Button size="sm" variant="outline" onClick={load}>Try again</Button>
            </div>
          ) : !sims ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="rounded-lg border overflow-hidden animate-pulse">
                  <div className="aspect-[600/394] bg-muted" />
                  <div className="p-2 space-y-1.5">
                    <div className="h-3 w-3/4 rounded bg-muted" />
                    <div className="h-2.5 w-1/2 rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : results.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No simulation matches “{query}”.</p>
          ) : (
            <div ref={gridRef} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" role="listbox">
              {results.map((sim, index) => {
                const title = phetTitle(sim, locale)
                const translated = sim.locales.includes(locale)
                const description = sim.descriptions[locale] ?? sim.descriptions.en
                return (
                  <button
                    key={sim.sim}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    data-index={index}
                    onClick={() => choose(sim)}
                    onMouseEnter={() => setActive(index)}
                    title={description}
                    className={`group text-left rounded-lg border overflow-hidden bg-background transition-all ${
                      index === active ? 'ring-2 ring-primary border-primary' : 'hover:border-foreground/30'
                    }`}
                  >
                    <div className="aspect-[600/394] bg-muted overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element -- remote PhET PNG, next/image optimisation is off */}
                      <img
                        src={phetThumbnailUrl(sim.sim)}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                      />
                    </div>
                    <div className="p-2">
                      <div className="text-sm font-medium leading-snug line-clamp-2">{title}</div>
                      {!translated && (
                        <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">Not translated — shows in English</div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Simulations by{' '}
          <a href="https://phet.colorado.edu" target="_blank" rel="noopener noreferrer" className="underline">
            {PHET_ATTRIBUTION}
          </a>
          , licensed CC BY 4.0. The attribution is shown below every embedded sim.
        </p>
      </DialogContent>
    </Dialog>
  )
}
