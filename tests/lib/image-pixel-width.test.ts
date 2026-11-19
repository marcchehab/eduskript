import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'
import { parsePixelWidth } from '@/components/markdown/content-image'

async function html(md: string): Promise<string> {
  const components = createMarkdownComponents(createEmptySkriptFiles())
  return renderToStaticMarkup((await compileMarkdown(md, { components })) as ReactNode)
}

describe('image width in pixels', () => {
  it('parses pixel widths and leaves percentages alone', () => {
    expect(parsePixelWidth('200px')).toBe(200)
    expect(parsePixelWidth(' 200 px ')).toBe(200)
    expect(parsePixelWidth('200')).toBe(200)
    expect(parsePixelWidth(200)).toBe(200)
    expect(parsePixelWidth('25%')).toBeUndefined()
    expect(parsePixelWidth('10em')).toBeUndefined()
    expect(parsePixelWidth(undefined)).toBeUndefined()
  })

  it('<img style="width: 200px"> is capped at 200px instead of filling the page', async () => {
    const out = await html('<img src="https://example.com/a.png" alt="a" style="width: 200px">')
    expect(out).toContain('max-width:200px')
  })

  it('a percentage width still works', async () => {
    const out = await html('<img src="https://example.com/a.png" alt="a" style="width: 25%">')
    expect(out).toContain('width:25%')
    expect(out).not.toContain('max-width:200px')
  })
})
