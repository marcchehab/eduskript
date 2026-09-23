// Language for the few UI surfaces that are bilingual: the onboarding quest,
// paywall/upgrade hints and the trial banner. The rest of the app chrome is
// English only, on purpose — see git history of this file for the decision.
//
// Resolution: `ui-locale` cookie (set by UiLocaleSwitcher) > German. German is
// the default regardless of browser language: the first market is German-
// speaking Switzerland.

export const UI_LOCALES = ['de', 'en'] as const
export type UiLocale = (typeof UI_LOCALES)[number]
export const DEFAULT_UI_LOCALE: UiLocale = 'de'
export const UI_LOCALE_COOKIE = 'ui-locale'

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === 'string' && (UI_LOCALES as readonly string[]).includes(value)
}

export function resolveUiLocale(cookieValue: string | undefined): UiLocale {
  return isUiLocale(cookieValue) ? cookieValue : DEFAULT_UI_LOCALE
}

/** Pick the string for `locale` from an inline { de, en } pair. */
export function pick<T>(locale: UiLocale, messages: Record<UiLocale, T>): T {
  return messages[locale]
}
