import { describe, it, expect } from 'vitest'
import { parseGeogebraUrl } from '@/lib/geogebra'

describe('parseGeogebraUrl', () => {
  describe('share / app URLs', () => {
    it('extracts id from /m/<ID>', () => {
      expect(parseGeogebraUrl('https://www.geogebra.org/m/dNPHaqgb')).toBe('dNPHaqgb')
    })

    it('handles the app share URLs', () => {
      expect(parseGeogebraUrl('https://www.geogebra.org/classic/RHYH3UQ8')).toBe('RHYH3UQ8')
      expect(parseGeogebraUrl('https://www.geogebra.org/graphing/aJ4ecNF6')).toBe('aJ4ecNF6')
      expect(parseGeogebraUrl('https://www.geogebra.org/geometry/x2JNtaxT')).toBe('x2JNtaxT')
      expect(parseGeogebraUrl('https://www.geogebra.org/calculator/dU2AyaCh')).toBe('dU2AyaCh')
    })

    it('handles material/show/id and material/iframe/id forms', () => {
      expect(parseGeogebraUrl('https://www.geogebra.org/material/show/id/dNPHaqgb')).toBe('dNPHaqgb')
      expect(parseGeogebraUrl('https://www.geogebra.org/material/iframe/id/dNPHaqgb/width/800/height/600')).toBe('dNPHaqgb')
    })

    it('accepts geogebra.org without www', () => {
      expect(parseGeogebraUrl('https://geogebra.org/m/dNPHaqgb')).toBe('dNPHaqgb')
    })

    it('tolerates trailing slash and query strings', () => {
      expect(parseGeogebraUrl('https://www.geogebra.org/m/dNPHaqgb/')).toBe('dNPHaqgb')
      expect(parseGeogebraUrl('https://www.geogebra.org/calculator/dU2AyaCh?embed')).toBe('dU2AyaCh')
    })

    it('preserves mixed-case ids', () => {
      expect(parseGeogebraUrl('https://www.geogebra.org/m/aJ4ecNF6')).toBe('aJ4ecNF6')
    })
  })

  describe('iframe embed snippet', () => {
    it('extracts the id from a full <iframe> embed', () => {
      const snippet = '<iframe scrolling="no" title="x" src="https://www.geogebra.org/material/iframe/id/dNPHaqgb/width/800/height/600/border/888888" width="800" height="600"></iframe>'
      expect(parseGeogebraUrl(snippet)).toBe('dNPHaqgb')
    })

    it('handles single-quoted src', () => {
      expect(parseGeogebraUrl(`<iframe src='https://www.geogebra.org/m/dNPHaqgb'></iframe>`)).toBe('dNPHaqgb')
    })
  })

  describe('bare id', () => {
    it('returns a bare material id unchanged', () => {
      expect(parseGeogebraUrl('dNPHaqgb')).toBe('dNPHaqgb')
      expect(parseGeogebraUrl('  RHYH3UQ8 ')).toBe('RHYH3UQ8')
    })
  })

  describe('non-matches → null', () => {
    it('rejects app landing pages with no id', () => {
      expect(parseGeogebraUrl('https://www.geogebra.org/graphing')).toBeNull()
      expect(parseGeogebraUrl('https://www.geogebra.org/m/')).toBeNull()
    })

    it('rejects non-geogebra URLs', () => {
      expect(parseGeogebraUrl('https://example.com/m/dNPHaqgb')).toBeNull()
      expect(parseGeogebraUrl('https://youtube.com/watch?v=abc')).toBeNull()
    })

    it('rejects profile and other non-material paths', () => {
      // /u/<username> profile — 'u' is not an app segment, no id marker.
      expect(parseGeogebraUrl('https://www.geogebra.org/u/someteacher')).toBeNull()
    })

    it('rejects empty / garbage / non-urls', () => {
      expect(parseGeogebraUrl('')).toBeNull()
      expect(parseGeogebraUrl('hello world')).toBeNull()
      expect(parseGeogebraUrl('not://a real url')).toBeNull()
    })
  })
})
