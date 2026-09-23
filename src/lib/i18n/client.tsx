'use client'

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { DEFAULT_UI_LOCALE, UI_LOCALE_COOKIE, resolveUiLocale, type UiLocale } from './locale'

// App routes resolve the locale once per request in the (app) root layout
// (getUiLocale) and hand it down, so client components match the server HTML.
// Outside that provider — the app-wide overlays in providers.tsx (quest, help
// video) and tenant pages, whose layouts stay static and can't read request
// headers — the hook falls back to the same resolution done in the browser
// (cookie + navigator.language). Those overlays mount client-side after a
// fetch anyway, so there is no hydration mismatch to worry about.
const UiLocaleContext = createContext<UiLocale | null>(null)

export function UiLocaleProvider({ locale, children }: { locale: UiLocale; children: ReactNode }) {
  return <UiLocaleContext.Provider value={locale}>{children}</UiLocaleContext.Provider>
}

function detectBrowserLocale(): UiLocale {
  const cookie = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${UI_LOCALE_COOKIE}=`))
    ?.split('=')[1]
  return resolveUiLocale(cookie, navigator.languages?.join(',') || navigator.language || null)
}

const noopSubscribe = () => () => {}

export function useUiLocale(): UiLocale {
  const fromContext = useContext(UiLocaleContext)
  const detected = useSyncExternalStore(noopSubscribe, detectBrowserLocale, () => DEFAULT_UI_LOCALE)
  return fromContext ?? detected
}
