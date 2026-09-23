import { cookies, headers } from 'next/headers'
import { UI_LOCALE_COOKIE, resolveUiLocale, type UiLocale } from './locale'

/** UI locale for the current request (server components / route handlers). */
export async function getUiLocale(): Promise<UiLocale> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()])
  return resolveUiLocale(cookieStore.get(UI_LOCALE_COOKIE)?.value, headerList.get('accept-language'))
}
