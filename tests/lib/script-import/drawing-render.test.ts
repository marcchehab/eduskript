// @vitest-environment node
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import sharp from 'sharp'
import { renderDrawings } from '@/lib/script-import/drawing-render'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const shape = (x: number, y: number, cx: number, cy: number, prst: string, extra = '') =>
  `<wps:wsp><wps:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
  `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom><a:ln w="19050"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></wps:spPr>${extra}<wps:bodyPr/></wps:wsp>`

async function docx(body: string) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>')
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${W}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
      `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ` +
      `xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`
  )
  return zip
}

const group = (children: string, cx = 1270000, cy = 635000) =>
  `<w:p><w:r><w:t>Vor der Zeichnung</w:t></w:r><w:r><w:drawing><wp:anchor><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>` +
  `<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Gruppe"/>` +
  `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><wpg:wgp><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/>` +
  `<a:ext cx="${cx}" cy="${cy}"/><a:chOff x="0" y="0"/><a:chExt cx="2000" cy="1000"/></a:xfrm></wpg:grpSpPr>${children}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`

describe('renderDrawings', () => {
  it('replaces a shape group with a rendered picture', async () => {
    const zip = await docx(
      group(
        shape(0, 500, 2000, 0, 'straightConnector1') +
          shape(1500, 0, 500, 300, 'rect', '<wps:txbx><w:txbxContent><w:p><w:r><w:t>F = m·a</w:t></w:r></w:p></w:txbxContent></wps:txbx>')
      )
    )
    expect(await renderDrawings(zip)).toBe(1)
    const doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).toContain('r:embed="rIdEduskriptDrawing1"')
    expect(doc).not.toContain('wordprocessingGroup"><wpg:wgp')
    // Floating drawing moves to its own paragraph after the anchor paragraph.
    expect(doc.indexOf('Vor der Zeichnung')).toBeLessThan(doc.indexOf('rIdEduskriptDrawing1'))
    expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain('media/eduskript-drawing-1.png')
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('Extension="png"')

    const png = await zip.file('word/media/eduskript-drawing-1.png')!.async('nodebuffer')
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    // The red connector is drawn: some pixel is clearly red.
    let red = 0
    for (let i = 0; i < data.length; i += info.channels) if (data[i] > 200 && data[i + 1] < 80 && data[i + 2] < 80) red++
    expect(red).toBeGreaterThan(10)
  })

  it('leaves decoration (text-less rectangles only) alone', async () => {
    const zip = await docx(group(shape(0, 0, 2000, 1000, 'rect')))
    expect(await renderDrawings(zip)).toBe(0)
  })

  it('does nothing without drawings', async () => {
    const zip = await docx('<w:p><w:r><w:t>Nur Text</w:t></w:r></w:p>')
    expect(await renderDrawings(zip)).toBe(0)
  })
})
