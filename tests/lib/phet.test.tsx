import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'
import {
  compactPhetCatalogue,
  isValidPhetLocale,
  isValidPhetSim,
  phetSimUrl,
  phetTitle,
  searchPhetSims,
} from '@/lib/phet'

// Trimmed shape of https://phet.colorado.edu/services/metadata/1.3/simulations
const raw = {
  categories: {
    '1': { id: 1, parent: '' },
    '4': { id: 4, parent: 1 },
    '5': { id: 5, parent: 4 },
    '13': { id: 13, parent: 1 },
    '19': { id: 19, parent: 13 },
    '15': { id: 15, parent: 1 },
  },
  projects: [
    {
      simulations: [
        {
          name: 'projectile-motion',
          subjects: [4, 5],
          lowGradeLevel: 2,
          highGradeLevel: 4,
          localizedSimulations: {
            en: { title: 'Projectile Motion', description: 'Blast a car out of a cannon' },
            de: { title: 'Wurfbewegung', description: 'Schiesse ein Auto aus einer Kanone' },
            ja: { title: '放物運動' },
          },
        },
        {
          name: 'acid-base-solutions',
          subjects: [19],
          localizedSimulations: {
            en: { title: 'Acid-Base Solutions', description: 'How do strong and weak acids differ?' },
          },
        },
        // Dropped: no English title / invalid slug / duplicate
        { name: 'no-title', localizedSimulations: { de: { title: 'Nur Deutsch' } } },
        { name: '../evil', localizedSimulations: { en: { title: 'Evil' } } },
        { name: 'projectile-motion', localizedSimulations: { en: { title: 'Dup' } } },
      ],
    },
  ],
}

describe('compactPhetCatalogue', () => {
  const sims = compactPhetCatalogue(raw)

  it('keeps valid sims, drops untitled/invalid/duplicate ones, sorts by English title', () => {
    expect(sims.map((s) => s.sim)).toEqual(['acid-base-solutions', 'projectile-motion'])
  })

  it('resolves child categories to their top-level subject', () => {
    expect(sims.find((s) => s.sim === 'acid-base-solutions')?.subjects).toEqual(['chemistry'])
    expect(sims.find((s) => s.sim === 'projectile-motion')?.subjects).toEqual(['physics'])
  })

  it('keeps only en/de/fr/it titles but lists every available locale', () => {
    const pm = sims.find((s) => s.sim === 'projectile-motion')!
    expect(pm.titles).toEqual({ en: 'Projectile Motion', de: 'Wurfbewegung' })
    expect(pm.locales).toEqual(['de', 'en', 'ja'])
  })

  it('tolerates garbage input', () => {
    expect(compactPhetCatalogue(null as unknown)).toEqual([])
    expect(compactPhetCatalogue({})).toEqual([])
  })
})

describe('searchPhetSims', () => {
  const sims = compactPhetCatalogue(raw)

  it('matches German titles and slugs case-insensitively', () => {
    expect(searchPhetSims(sims, 'wurf').map((s) => s.sim)).toEqual(['projectile-motion'])
    expect(searchPhetSims(sims, 'ACID').map((s) => s.sim)).toEqual(['acid-base-solutions'])
  })

  it('ranks title hits above description-only hits', () => {
    const all = compactPhetCatalogue({
      ...raw,
      projects: [{ simulations: [
        { name: 'b-sim', localizedSimulations: { en: { title: 'Other', description: 'about gravity' } } },
        { name: 'a-sim', localizedSimulations: { en: { title: 'Gravity Lab' } } },
      ] }],
    })
    expect(searchPhetSims(all, 'gravity').map((s) => s.sim)).toEqual(['a-sim', 'b-sim'])
  })

  it('filters by subject', () => {
    expect(searchPhetSims(sims, '', 'chemistry').map((s) => s.sim)).toEqual(['acid-base-solutions'])
  })
})

describe('phet helpers', () => {
  it('validates slugs and locales', () => {
    expect(isValidPhetSim('projectile-motion')).toBe(true)
    expect(isValidPhetSim('Projectile')).toBe(false)
    expect(isValidPhetSim('a/../b')).toBe(false)
    expect(isValidPhetSim(undefined)).toBe(false)
    expect(isValidPhetLocale('de')).toBe(true)
    expect(isValidPhetLocale('pt_BR')).toBe(true)
    expect(isValidPhetLocale('de"><script>')).toBe(false)
  })

  it('builds the all-locales URL and only appends a valid locale', () => {
    expect(phetSimUrl('projectile-motion', 'de')).toBe(
      'https://phet.colorado.edu/sims/html/projectile-motion/latest/projectile-motion_all.html?locale=de',
    )
    expect(phetSimUrl('projectile-motion', 'x y')).toBe(
      'https://phet.colorado.edu/sims/html/projectile-motion/latest/projectile-motion_all.html',
    )
  })

  it('falls back to the English title', () => {
    const [acid] = compactPhetCatalogue(raw)
    expect(phetTitle(acid, 'de')).toBe('Acid-Base Solutions')
  })
})

describe('<phet> in markdown', () => {
  const render = async (md: string) => {
    const components = createMarkdownComponents(createEmptySkriptFiles())
    const tree = (await compileMarkdown(md, { components })) as ReactNode
    return renderToStaticMarkup(<>{tree}</>)
  }

  it('renders the sim iframe with locale and the CC BY attribution, keeping following content', async () => {
    const html = await render('<phet sim="projectile-motion" locale="de" />\n\nDanach.')
    expect(html).toContain('src="https://phet.colorado.edu/sims/html/projectile-motion/latest/projectile-motion_all.html?locale=de"')
    expect(html).toContain('PhET Interactive Simulations, University of Colorado Boulder')
    expect(html).toContain('CC BY 4.0')
    expect(html).toContain('Danach.')
  })

  it('refuses an invalid slug instead of building a URL from it', async () => {
    const html = await render('<phet sim="../../evil" />')
    expect(html).not.toContain('<iframe')
    expect(html).toContain('invalid')
  })
})

describe('<phet> inside running text', () => {
  it('stays valid HTML (no block element inside <p>) when text follows on the next line', async () => {
    const components = createMarkdownComponents(createEmptySkriptFiles())
    const tree = (await compileMarkdown('<phet sim="pendulum-lab" />\nHallo', { components })) as ReactNode
    const html = renderToStaticMarkup(<>{tree}</>)
    expect(html).toContain('<iframe')
    expect(html).not.toMatch(/<p>(?:(?!<\/p>).)*<(?:div|figure)/s)
  })
})
