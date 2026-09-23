'use client'

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DEFAULT_UI_LOCALE, UI_LOCALE_COOKIE, resolveUiLocale, type UiLocale } from './locale'

// Client side of src/lib/i18n/locale.ts. The cookie is the source of truth;
// a module-level listener set lets every mounted bilingual component re-render
// when UiLocaleSwitcher changes it.
//
// The (app) root layout passes the server-resolved locale via UiLocaleProvider
// and it serves as the hydration snapshot, so SSR'd client components match.
// Outside that provider (tenant pages, whose layouts stay static) the server
// snapshot is the default; the overlays there (quest widget) mount after a
// fetch, so they never hydrate with the wrong language.
const ServerLocaleContext = createContext<UiLocale | null>(null)

export function UiLocaleProvider({ locale, children }: { locale: UiLocale; children: ReactNode }) {
  return <ServerLocaleContext.Provider value={locale}>{children}</ServerLocaleContext.Provider>
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function readCookieLocale(): UiLocale {
  const raw = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${UI_LOCALE_COOKIE}=`))
    ?.split('=')[1]
  return resolveUiLocale(raw)
}

export function useUiLocale(): UiLocale {
  const serverLocale = useContext(ServerLocaleContext) ?? DEFAULT_UI_LOCALE
  return useSyncExternalStore(subscribe, readCookieLocale, () => serverLocale)
}

function writeLocale(locale: UiLocale) {
  document.cookie = `${UI_LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`
  listeners.forEach((listener) => listener())
}

// Plain Swiss flag for German: the combined de-ch.png is unreadable at this
// size. Swiss flag is square, so it gets its own dimensions.
const OPTIONS: { value: UiLocale; flag: string; width: number; height: number }[] = [
  { value: 'de', flag: '/flags/ch.svg', width: 14, height: 14 },
  { value: 'en', flag: '/flags/en-gb.svg', width: 21, height: 14 },
]

/**
 * Small flag dropdown for the bilingual surfaces (same Radix Select + flag
 * images as the signup page's language picker). router.refresh() re-renders
 * server components (trial banner) with the new cookie too.
 */
export function UiLocaleSwitcher({ className }: { className?: string }) {
  const locale = useUiLocale()
  const router = useRouter()
  return (
    <Select
      value={locale}
      onValueChange={(value) => {
        writeLocale(value as UiLocale)
        router.refresh()
      }}
    >
      <SelectTrigger
        aria-label="Language / Sprache"
        // Stop the docked panel's drag handler from swallowing the click.
        onMouseDown={(e) => e.stopPropagation()}
        className={`h-6 w-auto gap-1 border-none bg-transparent px-1 text-xs shadow-none ${className ?? ''}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            <span className="flex items-center gap-1.5 text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element -- tiny static flag; Next's image optimizer refuses local SVGs */}
              <img src={o.flag} alt="" width={o.width} height={o.height} className="rounded-xs object-cover" />
              {o.value.toUpperCase()}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
