/** Step over / step into line targeting for the Kara replay (kara-line-extension.ts). */
import { describe, it, expect } from 'vitest'
import { helperFrame, karaStepTarget } from '@/components/public/code-editor/kara-line-extension'

describe('karaStepTarget', () => {
  const helperStep = { l: 5, f: 'befehle.py', fl: 8, fn: 'drei_vor' }

  it('step over keeps the marker on the call line and names the helper frame', () => {
    expect(karaStepTarget(helperStep, 'over')).toEqual({ line: 5, via: 'drei_vor() · befehle.py:8' })
  })

  it('step into targets the helper file and line, with the call line as note and over-fallback', () => {
    expect(karaStepTarget(helperStep, 'into')).toEqual({
      line: 8,
      file: 'befehle.py',
      via: 'drei_vor() · called from line 5',
      over: { line: 5, via: 'drei_vor() · befehle.py:8' },
    })
  })

  it('step into on a main.py step stays in main.py', () => {
    expect(karaStepTarget({ l: 3 }, 'into')).toEqual({ line: 3, via: undefined })
  })

  it('step into without a helper line (fl) falls back to over', () => {
    expect(karaStepTarget({ l: 2, f: 'befehle.py' }, 'into')).toEqual({ line: 2, via: 'befehle.py' })
  })

  it('module-level helper code (<module>) gets no function name', () => {
    expect(helperFrame({ f: 'befehle.py', fl: 1, fn: '<module>' })).toBe('befehle.py:1')
    expect(karaStepTarget({ l: 1, f: 'befehle.py', fl: 1, fn: '<module>' }, 'into').via).toBe('called from line 1')
  })
})
