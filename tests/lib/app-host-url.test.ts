/**
 * appHostUrl exists because a host-relative `/<pageSlug>` is wrong whenever the
 * dashboard was reached over a custom domain: the proxy prefixes that domain
 * owner's slug, so the link lands on a path that does not exist and 404s. It
 * bit the admin user list (a link to another teacher's page) and the "view your
 * public page" button in page settings.
 *
 * The escape hatch matters as much as the rewrite — a build without
 * NEXTAUTH_URL must degrade to the old relative behaviour rather than send
 * users to a portless http://localhost.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { appHostUrl } from '@/lib/custom-domain'

const original = process.env.NEXT_PUBLIC_APP_HOSTNAME

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_HOSTNAME = original
})

describe('appHostUrl', () => {
  it('pins the path to the app host in production', () => {
    process.env.NEXT_PUBLIC_APP_HOSTNAME = 'eduskript.org'
    expect(appHostUrl('/evh')).toBe('https://eduskript.org/evh')
  })

  it('honours a non-default app host, e.g. ngrok', () => {
    process.env.NEXT_PUBLIC_APP_HOSTNAME = 'abc.ngrok.app'
    expect(appHostUrl('/evh')).toBe('https://abc.ngrok.app/evh')
  })

  it('stays relative on localhost, whose port next.config strips', () => {
    process.env.NEXT_PUBLIC_APP_HOSTNAME = 'localhost'
    expect(appHostUrl('/evh')).toBe('/evh')
  })

  it('stays relative when unset, matching the pre-fix behaviour', () => {
    delete process.env.NEXT_PUBLIC_APP_HOSTNAME
    expect(appHostUrl('/evh')).toBe('/evh')
  })
})
