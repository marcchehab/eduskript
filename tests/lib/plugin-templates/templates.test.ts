import { describe, it, expect } from 'vitest'
import { expandTemplates, findTemplateRefs, BUILTIN_TEMPLATES } from '@/lib/plugin-templates'
import { sanitizeSvg } from '@/lib/plugin-templates/sanitize'

describe('plugin template tags', () => {
  const html = '<div><es-template name="europe"></es-template></div><es-template name="world" /><es-template name="europe"/>'
  it('finds referenced slugs once', () => {
    expect(findTemplateRefs(html)).toEqual(['europe', 'world'])
  })
  it('inlines known SVGs and marks unknown ones', () => {
    const out = expandTemplates(html, { europe: '<svg>E</svg>' })
    expect(out).toContain('<div><svg>E</svg></div>')
    expect(out).toContain('Template "world" not found.')
  })
  it('ships the built-in maps with ids and names', () => {
    const eu = BUILTIN_TEMPLATES.find((t) => t.slug === 'europe')!
    expect(eu.shapes.find((s) => s.id === 'ch')?.name).toBe('Schweiz')
    expect(eu.points.find((p) => p.of === 'ch')?.name).toBe('Bern')
  })
})

describe('sanitizeSvg', () => {
  it('strips scripts and handlers, names shapes by <title>', () => {
    const raw = '<?xml version="1.0"?><svg width="10" height="10" viewBox="0 0 10 10"><script>alert(1)</script><path id="ch" onclick="x()" d="M0 0"><title>Switzerland</title></path><g id="de" inkscape:label="Germany"></g></svg>'
    const { svg, meta } = sanitizeSvg(raw, 'test')
    expect(svg).not.toMatch(/script|onclick|width="10"/)
    expect(svg).toContain('class="es-shapes" data-template="test"')
    expect(meta.shapes).toEqual([{ id: 'ch', name: 'Switzerland' }, { id: 'de', name: 'Germany' }])
  })
  it('rejects non-SVG content', () => {
    expect(() => sanitizeSvg('<html></html>', 'x')).toThrow(/not an SVG/)
  })
})

describe('sanitizeSvg on Wikimedia-style maps', () => {
  it('adds a viewBox from width/height, names ISO ids, skips editor ids', () => {
    const raw = '<svg width="1525" height="1440"><g id="layer1"><path id="dz" d="M0 0"/><path id="path3021" d="M1 1"/></g></svg>'
    const { svg, meta } = sanitizeSvg(raw, 'africa')
    expect(svg).toContain('viewBox="0 0 1525 1440"')
    expect(meta.shapes).toEqual([{ id: 'dz', name: 'Algerien' }])
  })
})
