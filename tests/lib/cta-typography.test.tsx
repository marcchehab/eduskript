import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'
import { ctaTypography } from '@/components/markdown/cta-button'

const render = async (md: string) => {
  const components = createMarkdownComponents(createEmptySkriptFiles())
  const tree = (await compileMarkdown(md, { components })) as ReactNode
  return renderToStaticMarkup(<>{tree}</>)
}

describe('<cta> typography', () => {
  it('applies heading font, bold weight and a preset size', async () => {
    const html = await render('<cta href="/auth/signup" font="heading" weight="bold" fontsize="xl">Los</cta>')
    expect(html).toContain('font-family:var(--font-heading), sans-serif')
    expect(html).toContain('font-weight:700')
    expect(html).toContain('font-size:1.25rem')
    expect(html).toContain('height:auto')
  })

  it('accepts a raw CSS length and ignores unknown values', () => {
    expect(ctaTypography(undefined, undefined, '1.4rem').fontSize).toBe('1.4rem')
    expect(ctaTypography('comic', 'heavy', 'huge; color:red')).toEqual({})
  })

  it('leaves a plain cta unchanged', async () => {
    const html = await render('<cta href="/x">Go</cta>')
    expect(html).not.toContain('font-weight')
  })
})
