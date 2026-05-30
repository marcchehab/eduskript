import { describe, it, expect } from 'vitest'
import { splitSlides, stripSlideDirectives } from '@/lib/markdown-slides'

describe('splitSlides', () => {
  it('returns the whole document as one slide when there are no breaks', () => {
    const r = splitSlides('# Title\n\nsome text')
    expect(r.slides).toHaveLength(1)
    expect(r.slides[0]).toContain('some text')
  })

  it('splits on a --- divider', () => {
    const r = splitSlides('slide one\n\n---\n\nslide two')
    expect(r.slides).toEqual(['slide one\n', '\nslide two'])
  })

  it('splits on an invisible ---/ divider', () => {
    const r = splitSlides('slide one\n---/\nslide two')
    expect(r.slides).toEqual(['slide one', 'slide two'])
  })

  it('starts a new slide on # and ## headings, keeping the heading', () => {
    const r = splitSlides('intro\n## A\nbody a\n# B\nbody b')
    expect(r.slides).toEqual(['intro', '## A\nbody a', '# B\nbody b'])
  })

  it('does not split on ### or deeper headings', () => {
    const r = splitSlides('## A\n### sub\nbody')
    expect(r.slides).toEqual(['## A\n### sub\nbody'])
  })

  it('excludes content from ---x up to the next break', () => {
    const r = splitSlides('keep 1\n---x\ndrop this\nand this\n---\nkeep 2')
    expect(r.slides).toEqual(['keep 1', 'keep 2'])
  })

  it('excludes from ---x to end of document when no further break', () => {
    const r = splitSlides('keep\n---x\ndrop to EOF')
    expect(r.slides).toEqual(['keep'])
  })

  it('ends an excluded region at the next heading too', () => {
    const r = splitSlides('keep\n---x\ndrop\n## Next\nkeep again')
    expect(r.slides).toEqual(['keep', '## Next\nkeep again'])
  })

  it('does not split on markers inside fenced code blocks', () => {
    const md = 'before\n```\n---\n---/\n---x\n## not a heading\n```\nafter'
    const r = splitSlides(md)
    expect(r.slides).toHaveLength(1)
    expect(r.slides[0]).toContain('---x')
  })

  it('coalesces empty slides from adjacent / leading / trailing breaks', () => {
    const r = splitSlides('---\n\n---\nreal\n---\n\n---')
    expect(r.slides).toEqual(['real'])
  })

  it('drops the empty slide a divider right before a heading would create', () => {
    const r = splitSlides('## A\n---\n## B')
    expect(r.slides).toEqual(['## A', '## B'])
  })

  it('keeps content before the first heading as slide 0', () => {
    const r = splitSlides('lead-in prose\n\n## First')
    expect(r.slides).toEqual(['lead-in prose\n', '## First'])
  })

  it('reports the 1-based start line of each slide', () => {
    // line 1: intro, 2: blank, 3: ## A, 4: a, 5: ---, 6: ## B
    const r = splitSlides('intro\n\n## A\na\n---\n## B')
    expect(r.slides).toEqual(['intro\n', '## A\na', '## B'])
    expect(r.startLines).toEqual([1, 3, 6])
  })
})

describe('stripSlideDirectives', () => {
  it('blanks ---/ and ---x marker lines', () => {
    expect(stripSlideDirectives('a\n---/\nb\n---x\nc')).toBe('a\n\nb\n\nc')
  })

  it('leaves --- (thematic break) untouched', () => {
    expect(stripSlideDirectives('a\n---\nb')).toBe('a\n---\nb')
  })

  it('is line-count-preserving', () => {
    const input = 'a\n---/\n---x\nb'
    expect(stripSlideDirectives(input).split('\n')).toHaveLength(input.split('\n').length)
  })

  it('does not touch markers inside fenced code blocks', () => {
    const md = '```\n---/\n---x\n```'
    expect(stripSlideDirectives(md)).toBe(md)
  })

  it('leaves excluded body content in place (only the marker line is blanked)', () => {
    expect(stripSlideDirectives('---x\nlong prose stays')).toBe('\nlong prose stays')
  })
})
