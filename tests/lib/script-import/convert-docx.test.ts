// @vitest-environment node
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { convertDocx, inlineTextboxes, readDocxInfo, removeToc, removeTocText, rewriteImages, UNSUPPORTED_IMAGE_NOTE, widthPercent } from '@/lib/script-import/convert-docx'

describe('rewriteImages', () => {
  it('turns figures, sized imgs and md images into plain refs', () => {
    const map = new Map<string, string | null>([
      ['media/media/rId10.png', 'image-1.png'],
      ['media/media/rId11.emf', null],
    ])
    const md = [
      '<figure>\n<img src="media/media/rId10.png" style="width:5in" alt="Becher" />\n<figcaption aria-hidden="true"><p>Becher</p></figcaption>\n</figure>',
      '<img src="media/media/rId10.png" style="width:1in" />',
      '![x](media/media/rId11.emf)',
    ].join('\n\n')
    const out = rewriteImages(md, map)
    expect(out).toContain('<img src="image-1.png" alt="Becher" style="width: 79%" />')
    expect(out).toContain('<img src="image-1.png" alt="" style="width: 16%" />')
    expect(out).toContain(UNSUPPORTED_IMAGE_NOTE)
    expect(out).not.toContain('<figure>')
  })
})

describe('convertDocx (pandoc-wasm round trip)', () => {
  it('keeps math, tables and sub/sup from a real docx', async () => {
    // Build a .docx with pandoc itself (math becomes Word OMML), then import it.
    const { convert } = await import('pandoc-wasm')
    const src = '# Titel\n\nWasser: H~2~O\n\n$$E = mc^2$$\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'
    const made = await convert({ from: 'markdown', to: 'docx', 'output-file': 'out.docx' }, src, {})
    const blob = made.files['out.docx'] as Blob
    const { markdown, pageCount } = await convertDocx(Buffer.from(await blob.arrayBuffer()))
    expect(markdown).toContain('H<sub>2</sub>O')
    expect(markdown).toMatch(/\$\$E = mc\^\{?2\}?\$\$/)
    expect(markdown).toMatch(/\| a +\| b +\|/)
    expect(pageCount).toBe(1) // read from docProps/app.xml
  }, 60_000)
})

describe('readDocxInfo', () => {
  it('finds legacy formula previews via ProgID and rels', async () => {
    const zip = new JSZip()
    zip.file('docProps/app.xml', '<Properties><Pages>7</Pages></Properties>')
    zip.file(
      'word/_rels/document.xml.rels',
      '<Relationships><Relationship Id="rId7" Target="media/image1.wmf"/><Relationship Id="rId9" Target="media/image2.wmf"/></Relationships>'
    )
    zip.file(
      'word/document.xml',
      '<w:body><w:object><v:shape><v:imagedata r:id="rId7"/></v:shape><o:OLEObject ProgID="Equation.3" r:id="rId8"/></w:object>' +
        '<w:object><v:shape style="width:90pt;height:20pt"><v:imagedata r:id="rId9"/></v:shape><o:OLEObject ProgID="Excel.Sheet.12"/></w:object>' +
        '<w:drawing><wp:extent cx="1270000" cy="5"/><a:blip r:embed="rId7"/></w:drawing></w:body>'
    )
    const info = await readDocxInfo(await zip.generateAsync({ type: 'nodebuffer' }))
    expect(info.pageCount).toBe(7)
    expect([...info.formulaMedia]).toEqual(['media/media/image1.wmf'])
    expect(info.widths.get('media/media/image2.wmf')).toBe('90pt')
    expect(info.widths.get('media/media/image1.wmf')).toBe('100pt') // EMU / 12700
  })
})

describe('inlineTextboxes', () => {
  const box = (inner: string) =>
    `<w:r><mc:AlternateContent><mc:Choice><w:drawing><wps:txbx><w:txbxContent>${inner}</w:txbxContent></wps:txbx></w:drawing></mc:Choice>` +
    `<mc:Fallback><w:pict><v:textbox><w:txbxContent>${inner}</w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r>`
  const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`

  it('moves a real text box after its paragraph, once', () => {
    const xml = `<w:body><w:p><w:r><w:t>Anker</w:t></w:r>${box(p('Merke: Energie bleibt erhalten, immer.'))}</w:p>${p('Weiter')}</w:body>`
    const { xml: out, count, drawings } = inlineTextboxes(xml)
    expect([count, drawings]).toEqual([1, 0])
    expect(out.match(/Energie bleibt/g)).toHaveLength(1)
    expect(out.indexOf('TEXTFELD-ANFANG')).toBeGreaterThan(out.indexOf('Anker'))
    expect(out.indexOf('TEXTFELD-ENDE')).toBeLessThan(out.indexOf('Weiter'))
  })

  it('drops short label boxes and marks the drawing once', () => {
    const xml = `<w:body><w:p>${box(p('ja'))}${box(p('nein'))}</w:p></w:body>`
    const { xml: out, count, drawings } = inlineTextboxes(xml)
    expect([count, drawings]).toEqual([0, 1])
    expect(out).not.toContain('>ja<')
    expect(out.match(/ZEICHNUNG-FEHLT/g)).toHaveLength(1)
  })
})

describe('widthPercent', () => {
  it('maps Word widths to % of the text width', () => {
    expect(widthPercent('width:3.15in;height:2in')).toBe(50)
    expect(widthPercent('width:8cm')).toBe(50)
    expect(widthPercent('width:6.2in')).toBeNull() // ~full width → plain markdown
    expect(widthPercent('')).toBeNull()
  })
})

describe('table of contents', () => {
  it('removes paragraphs with a TOC style (localized id, English name)', () => {
    const styles = '<w:style w:type="paragraph" w:styleId="Verzeichnis1"><w:name w:val="toc 1"/></w:style>'
    const doc = '<w:body><w:p><w:pPr><w:pStyle w:val="Verzeichnis1"/></w:pPr><w:r><w:t>Kapitel 1</w:t></w:r></w:p><w:p><w:r><w:t>Text</w:t></w:r></w:p></w:body>'
    const { xml, removed } = removeToc(doc, styles)
    expect(removed).toBe(1)
    expect(xml).not.toContain('Kapitel 1')
    expect(xml).toContain('Text')
  })

  it('drops a link-style TOC and its heading from markdown', () => {
    const md = '**Inhaltsverzeichnis**\n\n[Eins 2](#eins)\n\n[Zwei 3](#zwei)\n\n2.1 Drei [5](#drei)\n\n# Eins\n\nText'
    expect(removeTocText(md)).toBe('# Eins\n\nText')
  })
})

describe('inlineTextboxes with Word formulas', () => {
  it('keeps a text box that only holds an OMML formula', () => {
    const xml = '<w:body><w:p><w:r><w:drawing><wps:txbx><w:txbxContent><w:p><m:oMath><m:r><m:t>F</m:t></m:r></m:oMath></w:p></w:txbxContent></wps:txbx></w:drawing></w:r></w:p></w:body>'
    const { count, drawings } = inlineTextboxes(xml)
    expect([count, drawings]).toEqual([1, 0])
  })
})
