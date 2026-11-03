import { describe, expect, it } from 'vitest'
import { PAPER_PX_PER_MM, formatPrintLengthCm, parsePrintLength } from '@/lib/print/geometry'

describe('parsePrintLength', () => {
  it('reads a bare number as centimetres', () => {
    expect(parsePrintLength('6')).toBeCloseTo(60 * PAPER_PX_PER_MM)
  })
  it('accepts units, spaces and a decimal comma', () => {
    expect(parsePrintLength('6cm')).toBeCloseTo(60 * PAPER_PX_PER_MM)
    expect(parsePrintLength('6 cm')).toBeCloseTo(60 * PAPER_PX_PER_MM)
    expect(parsePrintLength('6,5')).toBeCloseTo(65 * PAPER_PX_PER_MM)
    expect(parsePrintLength('60mm')).toBeCloseTo(60 * PAPER_PX_PER_MM)
    expect(parsePrintLength('400px')).toBe(400)
  })
  it('rejects anything else', () => {
    expect(parsePrintLength('abc')).toBeUndefined()
    expect(parsePrintLength('')).toBeUndefined()
    expect(parsePrintLength(undefined)).toBeUndefined()
  })
})

describe('formatPrintLengthCm', () => {
  it('round-trips through parsePrintLength in cm', () => {
    expect(formatPrintLengthCm(parsePrintLength('60mm')!)).toBe('6cm')
    expect(formatPrintLengthCm(parsePrintLength('6,5')!)).toBe('6.5cm')
  })
})
