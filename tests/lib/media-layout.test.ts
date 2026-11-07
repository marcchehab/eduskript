import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import {
  buildYoutubeTag,
  mediaLayoutAttrs,
  parseMediaAlign,
  parseMediaFlag,
  parseMediaWidth,
  setMediaLayoutAttrs,
} from '@/lib/media-layout'
import { buildMuxVideoTag } from '@/components/markdown/mux-video-options'
import { replaceOutsideFences } from '@/lib/markdown-fences'

const plain = { width: 100, align: 'center' as const, wrap: false }
const noFlags = { gif: false, autoplay: false, loop: false, pin: false }

describe('media layout parsing', () => {
  it('reads width in the <excali> spellings', () => {
    expect(parseMediaWidth('50%')).toBe(50)
    expect(parseMediaWidth('50')).toBe(50)
    expect(parseMediaWidth(50)).toBe(50)
    expect(parseMediaWidth(undefined)).toBeUndefined()
    expect(parseMediaWidth('auto')).toBeUndefined()
  })

  it('reads align and bare wrap', () => {
    expect(parseMediaAlign('left')).toBe('left')
    expect(parseMediaAlign('nonsense')).toBe('center')
    expect(parseMediaFlag('')).toBe(true)
    expect(parseMediaFlag('true')).toBe(true)
    expect(parseMediaFlag(undefined)).toBe(false)
  })
})

describe('media layout serialization', () => {
  it('omits defaults', () => {
    expect(mediaLayoutAttrs(plain)).toEqual([])
    expect(mediaLayoutAttrs({ width: 49.6, align: 'right', wrap: true })).toEqual(['width="50%"', 'align="right"', 'wrap'])
  })

  it('replaces layout attrs on a tag and keeps the rest', () => {
    const tag = '<youtube id="abc" startTime={120} width="30%" wrap caption="wrap up" />'
    expect(setMediaLayoutAttrs(tag, { width: 60, align: 'left', wrap: false }))
      .toBe('<youtube id="abc" startTime={120} caption="wrap up" width="60%" align="left" />')
    expect(setMediaLayoutAttrs('<youtube id="abc">', { width: 40, align: 'center', wrap: true }))
      .toBe('<youtube id="abc" width="40%" wrap>')
    expect(setMediaLayoutAttrs('<youtube id="abc" width="40%" />', plain)).toBe('<youtube id="abc" />')
  })

  it('builds a <youtube> tag for the image shorthand', () => {
    expect(buildYoutubeTag({ id: 'abc', startTime: 120, caption: 'Say "hi"', layout: { width: 50, align: 'center', wrap: false } }))
      .toBe('<youtube id="abc" startTime="120" caption="Say &quot;hi&quot;" width="50%" />')
  })

  it('keeps layout when <muxvideo> flags are rewritten', () => {
    expect(buildMuxVideoTag('a.mp4', 'Cap', undefined, { ...noFlags, loop: true }, { width: 70, align: 'right', wrap: true }))
      .toBe('<muxvideo src="a.mp4" alt="Cap" loop width="70%" align="right" wrap />')
    expect(buildMuxVideoTag('a.mp4', undefined, undefined, noFlags)).toBe('<muxvideo src="a.mp4" />')
  })
})

describe('layout attributes survive the compile pipeline', () => {
  async function html(md: string): Promise<string> {
    return renderToStaticMarkup((await compileMarkdown(md)) as ReactNode)
  }

  it('<muxvideo width align wrap>', async () => {
    const out = await html('<muxvideo src="a.mp4" width="50%" align="left" wrap />')
    expect(out).toMatch(/<muxvideo[^>]*width="50%"/)
    expect(out).toMatch(/<muxvideo[^>]*align="left"/)
    expect(out).toMatch(/<muxvideo[^>]*wrap=""/)
  })

  it('<youtube width align wrap> → data-* on <youtube-embed>', async () => {
    const out = await html('<youtube id="abc" width="40%" align="right" wrap caption="wrap up" />')
    expect(out).toMatch(/data-width="40"/)
    expect(out).toMatch(/data-align="right"/)
    expect(out).toMatch(/data-wrap="true"/)
  })

  it('a caption containing "wrap" is not the wrap flag', async () => {
    const out = await html('<youtube id="abc" caption="wrap up" />')
    expect(out).not.toMatch(/data-wrap/)
  })
})

describe('replaceOutsideFences with a source line', () => {
  const md = ['![a](x.png)', '', 'text', '', '![b](x.png)', '', '```', '![c](x.png)', '```', '', '![d](x.png)'].join('\n')
  const pattern = /!\[[^\]]*\]\(x\.png\)/

  it('rewrites the image on the given line, not the first one', () => {
    const out = replaceOutsideFences(md, pattern, 'B', 5)?.split('\n')
    expect(out?.[4]).toBe('B')
    expect(out?.[0]).toBe('![a](x.png)')
  })

  it('returns null when nothing matches on that line (no twin elsewhere)', () => {
    expect(replaceOutsideFences(md, pattern, 'X', 3)).toBeNull()
    expect(replaceOutsideFences(md, pattern, 'X', 8)).toBeNull() // fenced example
    expect(replaceOutsideFences(md, pattern, 'X', 99)).toBeNull()
  })

  it('first match without a line', () => {
    expect(replaceOutsideFences(md, pattern, 'A')?.split('\n')[0]).toBe('A')
  })
})

describe('source lines on video/molecule elements', () => {
  it('youtube-embed and molecule carry data-source-line-start', async () => {
    const out = renderToStaticMarkup((await compileMarkdown('# T\n\n<youtube id="abc" />\n\n<molecule smiles="CCO" />')) as ReactNode)
    expect(out).toMatch(/<youtube-embed[^>]*data-source-line-start="3"/)
    expect(out).toMatch(/<molecule[^>]*data-source-line-start="5"/)
  })
})
