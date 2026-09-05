import { describe, it, expect } from 'vitest'
import { buildDirectoryEntries, type DirectorySiteRow } from '@/lib/site-directory'

function site(overrides: Partial<DirectorySiteRow> = {}): DirectorySiteRow {
  return {
    id: 'site1',
    slug: 'my-site',
    userId: 'user1',
    pageName: 'My Site',
    pageDescription: 'About my site',
    pageLanguage: 'de-CH',
    extraSettings: {},
    user: { name: 'Teacher' },
    organization: null,
    teacherCustomDomains: [],
    ...overrides,
  }
}

describe('buildDirectoryEntries', () => {
  it('builds an eduskript.org/slug URL when no custom domain exists', () => {
    const entries = buildDirectoryEntries([site()])
    expect(entries).toEqual([
      {
        url: 'https://eduskript.org/my-site',
        name: 'My Site',
        description: 'About my site',
        language: 'de-CH',
      },
    ])
  })

  it('prefers a verified teacher custom domain', () => {
    const entries = buildDirectoryEntries([
      site({ teacherCustomDomains: [{ domain: 'informatikgarten.ch' }] }),
    ])
    expect(entries[0].url).toBe('https://informatikgarten.ch')
  })

  it('uses a legacy (siteId-null) domain resolved to the primary site', () => {
    const entries = buildDirectoryEntries(
      [site()],
      new Map([['site1', 'legacy-domain.ch']])
    )
    expect(entries[0].url).toBe('https://legacy-domain.ch')
  })

  it('uses the org custom domain for org sites', () => {
    const entries = buildDirectoryEntries([
      site({
        user: null,
        userId: null,
        organization: { name: 'School', customDomains: [{ domain: 'school.edu' }] },
      }),
    ])
    expect(entries[0].url).toBe('https://school.edu')
  })

  it('falls back to /slug when the org domain is the app host itself', () => {
    const entries = buildDirectoryEntries([
      site({
        slug: 'eduskript',
        user: null,
        userId: null,
        organization: { name: 'Eduskript', customDomains: [{ domain: 'eduskript.org' }] },
      }),
    ])
    expect(entries[0].url).toBe('https://eduskript.org/eduskript')
  })

  it('skips sites that opted out via extraSettings.directoryOptOut', () => {
    const entries = buildDirectoryEntries([
      site({ extraSettings: { directoryOptOut: true } }),
      site({ id: 'site2', slug: 'other' }),
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0].url).toBe('https://eduskript.org/other')
  })

  it('falls back through pageName → user name → org name → slug', () => {
    expect(buildDirectoryEntries([site({ pageName: null })])[0].name).toBe('Teacher')
    expect(
      buildDirectoryEntries([
        site({ pageName: null, user: null, organization: { name: 'Org', customDomains: [] } }),
      ])[0].name
    ).toBe('Org')
    expect(
      buildDirectoryEntries([site({ pageName: null, user: null })])[0].name
    ).toBe('my-site')
  })

  it('defaults language to en and description to null', () => {
    const entries = buildDirectoryEntries([site({ pageLanguage: null, pageDescription: null })])
    expect(entries[0].language).toBe('en')
    expect(entries[0].description).toBeNull()
  })
})
