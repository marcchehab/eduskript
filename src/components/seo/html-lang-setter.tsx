'use client'

import { useEffect } from 'react'

/**
 * Per-tenant <html lang> override applied after hydration.
 *
 * The root layout sets lang="en" at SSR because reading the request host
 * there would opt every ISR'd downstream page out of static generation.
 * This client component runs in deeper layouts that already know the
 * tenant (teacher / org) and updates document.documentElement.lang to
 * match the configured pageLanguage. Googlebot executes JS and picks up
 * the post-hydration value for language targeting.
 *
 * No-op when lang is null/undefined or already "en" — leaves the SSR'd
 * default in place to avoid an unnecessary attribute mutation.
 */
export function HtmlLangSetter({ lang }: { lang: string | null | undefined }) {
  useEffect(() => {
    if (!lang || lang === 'en') return
    const previous = document.documentElement.lang
    document.documentElement.lang = lang
    return () => {
      document.documentElement.lang = previous
    }
  }, [lang])
  return null
}
