import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'
import { DEFAULT_TRIAL_DAYS, formatChf, monthlyEquivalent, pickPlans, type PublicPlan } from '@/lib/plan-copy'

const plans: PublicPlan[] = [
  { slug: 'classroom-monthly', name: 'Classroom', priceChf: 900, interval: 'monthly', trialDays: 15, isDefaultTrial: true },
  { slug: 'classroom-yearly', name: 'Classroom', priceChf: 7900, interval: 'yearly', trialDays: null, isDefaultTrial: false },
  { slug: 'supporter-yearly', name: 'Supporter', priceChf: 14900, interval: 'yearly', trialDays: null, isDefaultTrial: false },
]

describe('plan-copy helpers', () => {
  it('formats Rappen as CHF', () => {
    expect(formatChf(7900)).toBe('CHF 79')
    expect(formatChf(660)).toBe('CHF 6.60')
  })

  it('rounds the monthly equivalent of a yearly price to 10 Rappen', () => {
    expect(monthlyEquivalent(7900)).toBe(660)
  })

  it('picks the known plans and the default trial length', () => {
    const picked = pickPlans(plans)
    expect(picked.classroomYearly?.priceChf).toBe(7900)
    expect(picked.classroomMonthly?.priceChf).toBe(900)
    expect(picked.supporter?.slug).toBe('supporter-yearly')
    expect(picked.trialDays).toBe(15)
  })

  it('falls back to the trial.ts default when no plan carries trial days', () => {
    expect(pickPlans([]).trialDays).toBe(DEFAULT_TRIAL_DAYS)
  })
})

describe('<pricing> in markdown', () => {
  const render = async (md: string) => {
    const components = createMarkdownComponents(createEmptySkriptFiles())
    const tree = (await compileMarkdown(md, { components })) as ReactNode
    return renderToStaticMarkup(<>{tree}</>)
  }

  it('renders German copy and never a fabricated price before plans load', async () => {
    const html = await render('<pricing lang="de" />\n\nDanach.')
    expect(html).toContain('Gratis')
    expect(html).toContain('Keine Fallen, kein Lock-in')
    expect(html).toContain('CHF 0')
    expect(html).not.toContain('CHF 79')
    expect(html).toContain('Danach.')
    expect(html).not.toMatch(/<p>(?:(?!<\/p>).)*<div/s)
  })

  it('defaults to English', async () => {
    const html = await render('<pricing />')
    expect(html).toContain('No traps, no lock-in')
  })
})
