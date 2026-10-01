import { describe, it, expect } from 'vitest'
import { readVisitSource, sanitizeLabel, sanitizeVisitSource, visitCounterNames } from '@/lib/visit-source'

const url = (q: string) => new URL(`https://eduskript.org/${q}`)

describe('readVisitSource', () => {
  it('reads ref, utm and the referring domain', () => {
    const source = readVisitSource(
      url('?ref=Coldmail-Chemie&utm_source=svia&utm_campaign=kickoff'),
      'https://www.svia.ch/themengruppen/personal-page?x=1',
    )
    expect(source).toEqual({ ref: 'coldmail-chemie', utm: 'svia/-/kickoff', referrer: 'svia.ch' })
  })

  it('keeps only the domain of the referrer, never the path', () => {
    expect(readVisitSource(url(''), 'https://schule.ch/lehrer/hans-muster')?.referrer).toBe('schule.ch')
  })

  it('ignores own hosts and login round-trips', () => {
    expect(readVisitSource(url(''), 'https://eduskript.org/dashboard')).toBeNull()
    expect(readVisitSource(url(''), 'https://atlas.eduskript.org/')).toBeNull()
    expect(readVisitSource(url(''), 'https://login.microsoftonline.com/common/oauth2')).toBeNull()
    expect(readVisitSource(url(''), '')).toBeNull()
  })

  it('returns null for a plain visit', () => {
    expect(readVisitSource(url('skript/abc'), null)).toBeNull()
  })
})

describe('sanitizing', () => {
  it('strips everything but a short slug', () => {
    expect(sanitizeLabel('  <script>alert(1)</script> ')).toBe('script-alert-1-script')
    expect(sanitizeLabel('x'.repeat(200))).toHaveLength(64)
    expect(sanitizeLabel('---')).toBeNull()
  })

  it('re-validates client input', () => {
    expect(sanitizeVisitSource({ ref: 'A B', utm: 'x/!!/y', referrer: 'evil.ch/path', extra: 1 }))
      .toEqual({ ref: 'a-b', utm: 'x/-/y', referrer: 'evil.ch-path' })
    expect(sanitizeVisitSource('nope')).toBeNull()
    expect(sanitizeVisitSource({})).toBeNull()
  })
})

describe('visitCounterNames', () => {
  it('builds one counter per kind', () => {
    expect(visitCounterNames({ ref: 'a', utm: 's/m/c', referrer: 'x.ch' }))
      .toEqual(['visit:ref:a', 'visit:utm:s/m/c', 'visit:referrer:x.ch'])
  })
})
