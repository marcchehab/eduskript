import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'
import { isPlausibleSmiles, renderMolecule } from '@/lib/chem/molecule-svg'
import { GET } from '@/app/api/render/molecule.svg/route'
import { NextRequest } from 'next/server'

async function html(md: string): Promise<string> {
  const components = createMarkdownComponents(createEmptySkriptFiles())
  const tree = (await compileMarkdown(md, { components })) as ReactNode
  return renderToStaticMarkup(tree)
}

describe('SMILES validation', () => {
  it('accepts what SMILES actually contains', () => {
    expect(isPlausibleSmiles('O')).toBe(true)
    expect(isPlausibleSmiles('CC(=O)Oc1ccccc1C(=O)O')).toBe(true)
    expect(isPlausibleSmiles('[Fe+2]')).toBe(true)
  })

  it('rejects empty, oversized and markup-ish input', () => {
    expect(isPlausibleSmiles('')).toBe(false)
    expect(isPlausibleSmiles('C'.repeat(300))).toBe(false)
    expect(isPlausibleSmiles('<script>')).toBe(false)
    expect(isPlausibleSmiles('C C')).toBe(false)
  })
})

describe('renderMolecule', () => {
  it('draws a structural formula', () => {
    const result = renderMolecule({ smiles: 'CCO', width: 400, height: 300, theme: 'light' })
    expect('svg' in result).toBe(true)
    if (!('svg' in result)) return
    expect(result.svg).toContain('<svg')
    expect(result.svg).toMatch(/<(line|path|text)/)
  })

  it('flips only the black ink for the dark theme', () => {
    const light = renderMolecule({ smiles: 'CCO', width: 400, height: 300, theme: 'light' })
    const dark = renderMolecule({ smiles: 'CCO', width: 400, height: 300, theme: 'dark' })
    if (!('svg' in light) || !('svg' in dark)) throw new Error('expected both to render')
    expect(light.svg).toContain('rgb(0,0,0)')
    expect(dark.svg).not.toContain('rgb(0,0,0)')
    expect(dark.svg).toContain('rgb(230,230,230)')
  })

  it('reports a broken SMILES instead of throwing', () => {
    const result = renderMolecule({ smiles: 'CQ(', width: 400, height: 300, theme: 'light' })
    expect('error' in result).toBe(true)
  })
})

describe('/api/render/molecule.svg', () => {
  const call = (query: string) =>
    GET(new NextRequest(`http://localhost/api/render/molecule.svg?${query}`))

  it('serves an immutable, long-lived SVG', async () => {
    const res = await call('smiles=O&w=200&h=150')
    expect(res.headers.get('Content-Type')).toContain('image/svg+xml')
    expect(res.headers.get('Cache-Control')).toContain('immutable')
    expect(await res.text()).toContain('<svg')
  })

  it('answers a broken SMILES with a picture of the problem, uncached', async () => {
    const res = await call('smiles=CQ(')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.text()
    expect(body).toContain('<svg')
    expect(body).toContain('<text')
  })

  it('rejects input that is not SMILES at all', async () => {
    const res = await call('smiles=%3Cscript%3E')
    expect(await res.text()).toContain('Invalid SMILES')
  })
})

describe('<molecule> in the pipeline', () => {
  it('renders two themed images pointing at the route', async () => {
    const out = await html('<molecule smiles="CCO" name="Ethanol" />')
    expect(out).toContain('molecule-light')
    expect(out).toContain('molecule-dark')
    expect(out).toContain('/api/render/molecule.svg?smiles=CCO')
    expect(out).toContain('theme=dark')
    expect(out).toContain('Ethanol')
  })

  it('escapes a SMILES that needs it in the query', async () => {
    const out = await html('<molecule smiles="CC(=O)O" />')
    expect(out).toContain('smiles=CC%28%3DO%29O')
  })

  it('tells the author when smiles is missing', async () => {
    const out = await html('<molecule name="Nichts" />')
    expect(out).toContain('needs a smiles attribute')
  })
})

describe('layout attributes', () => {
  it('carries display width, alignment and wrap through to the wrapper', async () => {
    const out = await html('<molecule smiles="CCO" display-width="60" align="right" wrap="true" />')
    // ResizableWrapper renders the width as a percentage on the container.
    expect(out).toMatch(/width:\s*60%/)
    expect(out).toContain('/api/render/molecule.svg?smiles=CCO')
  })

  it('defaults to full width and centred', async () => {
    const out = await html('<molecule smiles="CCO" />')
    expect(out).toMatch(/width:\s*100%/)
  })
})

describe('stereochemistry annotations', () => {
  it('does not print a "?" at an unspecified stereocentre', () => {
    // Ibuprofen without a configuration in the SMILES: openchemlib would
    // otherwise label the stereocentre with a literal question mark.
    const result = renderMolecule({
      smiles: 'CC(C)Cc1ccc(cc1)C(C)C(=O)O',
      width: 400,
      height: 300,
      theme: 'light',
    })
    if (!('svg' in result)) throw new Error('expected a drawing')
    const texts = (result.svg.match(/<text[^>]*>([^<]*)<\/text>/g) ?? []).map((t) =>
      t.replace(/<[^>]*>/g, '')
    )
    expect(texts).not.toContain('?')
    expect(texts).toContain('O')
  })
})
