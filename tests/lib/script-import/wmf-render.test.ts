// @vitest-environment node
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { renderEmfToPng, renderWmfToPng, wmfSize } from '@/lib/script-import/wmf-render'

/** Build a placeable WMF: header + records ([fn, int16 params]) + EOF. */
function wmf(records: [number, number[] | Buffer][], bbox = [0, 0, 1440, 480]): Buffer {
  const place = Buffer.alloc(22)
  place.writeUInt32LE(0x9ac6cdd7, 0)
  bbox.forEach((v, i) => place.writeInt16LE(v, 6 + i * 2))
  place.writeUInt16LE(1440, 14)
  const header = Buffer.alloc(18)
  header.writeUInt16LE(1, 0)
  header.writeUInt16LE(9, 2)
  header.writeUInt16LE(0x300, 4)
  const recs = [...records, [0, []] as [number, number[]]].map(([fn, params]) => {
    const body = Buffer.isBuffer(params) ? params : Buffer.from(Int16Array.from(params).buffer)
    const r = Buffer.alloc(6 + body.length + (body.length % 2))
    r.writeUInt32LE(r.length / 2, 0)
    r.writeUInt16LE(fn, 4)
    body.copy(r, 6)
    return r
  })
  return Buffer.concat([place, header, ...recs])
}

describe('wmf-render', () => {
  it('reads the size from the placeable header (96 dpi)', () => {
    expect(wmfSize(wmf([]))).toEqual({ w: 96, h: 32 })
    expect(wmfSize(Buffer.from('not a wmf at all, no header here.'))).toBeNull()
  })

  it('renders lines and text to a PNG', () => {
    const font = Buffer.alloc(50)
    font.writeInt16LE(-300, 0) // height
    font.writeInt16LE(400, 8) // weight
    font.write('Times New Roman', 18, 'latin1')
    const text = Buffer.alloc(12)
    text.writeInt16LE(300, 0) // y
    text.writeInt16LE(100, 2) // x
    text.writeInt16LE(3, 4) // count
    text.write('x=1', 8, 'latin1')
    const png = renderWmfToPng(
      wmf([
        [0x20c, [480, 1440]], // window ext
        [0x2fb, font],
        [0x12d, [0]], // select font
        [0x12e, [24]], // baseline
        [0xa32, text],
        [0x214, [400, 0]], // moveto
        [0x213, [400, 1440]], // lineto
      ])
    )
    expect(png?.subarray(1, 4).toString()).toBe('PNG')
  })

  it('returns null for non-WMF input', () => {
    expect(renderWmfToPng(Buffer.alloc(40))).toBeNull()
  })
})

function emfHeader(bounds: [number, number, number, number]) {
  const h = Buffer.alloc(88)
  h.writeUInt32LE(1, 0)
  h.writeUInt32LE(88, 4)
  bounds.forEach((v, i) => h.writeInt32LE(v, 8 + i * 4))
  h.writeUInt32LE(0x464d4520, 40)
  return h
}
const emfEof = () => {
  const e = Buffer.alloc(8)
  e.writeUInt32LE(14, 0)
  e.writeUInt32LE(8, 4)
  return e
}

describe('renderEmfToPng', () => {
  it('draws an embedded 24-bit DIB (EMR_STRETCHDIBITS) into its rect', async () => {
    // 2x1 bottom-up DIB: red, blue. Row stride padded to 8 bytes.
    const bmi = Buffer.alloc(40)
    bmi.writeUInt32LE(40, 0)
    bmi.writeInt32LE(2, 4)
    bmi.writeInt32LE(1, 8)
    bmi.writeUInt16LE(1, 12)
    bmi.writeUInt16LE(24, 14)
    const bits = Buffer.from([0, 0, 255, 255, 0, 0, 0, 0])
    const rec = Buffer.alloc(80 + bmi.length + bits.length)
    rec.writeUInt32LE(81, 0)
    rec.writeUInt32LE(rec.length, 4)
    rec.writeUInt32LE(80, 48) // offBmiSrc
    rec.writeUInt32LE(120, 56) // offBitsSrc
    rec.writeInt32LE(20, 72) // cxDest
    rec.writeInt32LE(10, 76) // cyDest
    bmi.copy(rec, 80)
    bits.copy(rec, 120)
    const png = await renderEmfToPng(Buffer.concat([emfHeader([0, 0, 19, 9]), rec, emfEof()]))
    const { data, info } = await sharp(png!).raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)]
    expect(at(2, 2)).toEqual([255, 0, 0])
    expect(at(info.width - 3, 2)).toEqual([0, 0, 255])
  })

  it('draws vector lines', async () => {
    const rec = (type: number, ...ints: number[]) => {
      const r = Buffer.alloc(8 + ints.length * 4)
      r.writeUInt32LE(type, 0)
      r.writeUInt32LE(r.length, 4)
      ints.forEach((v, i) => r.writeInt32LE(v, 8 + i * 4))
      return r
    }
    const png = await renderEmfToPng(Buffer.concat([emfHeader([0, 0, 49, 49]), rec(27, 0, 25), rec(54, 49, 25), emfEof()]))
    expect(png?.subarray(1, 4).toString()).toBe('PNG')
  })

  it('returns null for non-EMF or empty input', async () => {
    expect(await renderEmfToPng(emfEof())).toBeNull()
    expect(await renderEmfToPng(Buffer.concat([emfHeader([0, 0, 9, 9]), emfEof()]))).toBeNull()
  })
})
