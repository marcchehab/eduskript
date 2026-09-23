// UI language for the app chrome (auth, dashboard, billing) — separate from a
// teacher's pageLanguage, which is the language of their public content.
//
// Resolution: `ui-locale` cookie (explicit choice) > the browser's primary
// Accept-Language tag > German. Only a primary tag starting with "en" yields
// English: the audience is ~95% German-speaking Swiss teachers, so German is
// the default and English the fallback for those who asked for it.

export const UI_LOCALES = ['de', 'en'] as const
export type UiLocale = (typeof UI_LOCALES)[number]
export const DEFAULT_UI_LOCALE: UiLocale = 'de'
export const UI_LOCALE_COOKIE = 'ui-locale'

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === 'string' && (UI_LOCALES as readonly string[]).includes(value)
}

export function resolveUiLocale(cookieValue: string | undefined, acceptLanguage: string | null): UiLocale {
  if (isUiLocale(cookieValue)) return cookieValue
  // Primary tag = first entry; browsers list preferences in order and rarely
  // use q-values to reorder them.
  const primary = acceptLanguage?.split(',')[0]?.trim().toLowerCase() ?? ''
  if (primary.startsWith('en')) return 'en'
  return DEFAULT_UI_LOCALE
}

/** Pick the string for `locale` from an inline { de, en } pair. */
export function pick<T>(locale: UiLocale, messages: Record<UiLocale, T>): T {
  return messages[locale]
}
