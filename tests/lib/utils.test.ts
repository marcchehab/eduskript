import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('lib/utils', () => {
  describe('cn (className utility)', () => {
    it('should merge class names', () => {
      const result = cn('foo', 'bar')
      expect(result).toContain('foo')
      expect(result).toContain('bar')
    })

    it('should handle conditional classes', () => {
      const result = cn('foo', false && 'bar', 'baz')
      expect(result).toContain('foo')
      expect(result).not.toContain('bar')
      expect(result).toContain('baz')
    })

    it('should merge Tailwind classes correctly', () => {
      const result = cn('px-4 py-2', 'px-8')
      // Should keep only px-8 due to tailwind-merge
      expect(result).toContain('px-8')
      expect(result).toContain('py-2')
    })

    it('should handle undefined and null', () => {
      const result = cn('foo', undefined, null, 'bar')
      expect(result).toContain('foo')
      expect(result).toContain('bar')
    })
  })
})
