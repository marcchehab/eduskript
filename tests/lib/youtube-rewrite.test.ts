import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { rewriteYoutubeStartTime, rewriteYoutubeLayout } from '@/lib/youtube-rewrite'

const half = { width: 50, align: 'left' as const, wrap: false }

/** [line, nth] of every rendered <youtube-embed>, in document order. */
async function embeds(md: string): Promise<Array<[number | undefined, number]>> {
  const html = renderToStaticMarkup((await compileMarkdown(md)) as ReactNode)
  return [...html.matchAll(/<youtube-embed[^>]*>/g)].map(([tag]) => {
    const line = tag.match(/data-source-line-start="(\d+)"/)?.[1]
    const nth = tag.match(/data-source-nth="(\d+)"/)?.[1]
    return [line ? Number(line) : undefined, Number(nth)]
  })
}

describe('two identical YouTube videos on one page', () => {
  const md = ['# T', '', '<youtube id="abc" />', '', 'Text', '', '<youtube id="abc" />'].join('\n')

  it('each embed carries its own line, nth 0', async () => {
    expect(await embeds(md)).toEqual([[3, 0], [7, 0]])
  })

  it('start-time gizmo of the second video rewrites the second tag only', () => {
    const out = rewriteYoutubeStartTime(md, 'abc', 90, 7, 0)!.split('\n')
    expect(out[2]).toBe('<youtube id="abc" />')
    expect(out[6]).toBe('<youtube id="abc" startTime="90" />')
  })

  it('layout gizmo of the second video rewrites the second tag only', () => {
    const out = rewriteYoutubeLayout(md, 'abc', half, '', 7, 0)!.split('\n')
    expect(out[2]).toBe('<youtube id="abc" />')
    expect(out[6]).toMatch(/^<youtube id="abc" width="50%" align="left"/)
  })
})

describe('twins on the same line', () => {
  const md = '<youtube id="abc" /> <youtube id="abc" />'

  it('nth counts within the line', async () => {
    expect(await embeds(md)).toEqual([[1, 0], [1, 1]])
  })

  it('nth 1 rewrites the second tag on the line', () => {
    expect(rewriteYoutubeStartTime(md, 'abc', 30, 1, 1)).toBe('<youtube id="abc" /> <youtube id="abc" startTime="30" />')
    expect(rewriteYoutubeStartTime(md, 'abc', 30, 1, 0)).toBe('<youtube id="abc" startTime="30" /> <youtube id="abc" />')
  })
})

describe('mixed forms of the same video', () => {
  const md = ['![Intro](https://youtu.be/abc)', '', '<youtube id="abc" startTime="10" />'].join('\n')

  it('layout on the shorthand replaces only the shorthand', () => {
    const out = rewriteYoutubeLayout(md, 'abc', half, '<youtube id="abc" caption="Intro" width="50%" align="left" />', 1, 0)!.split('\n')
    expect(out[0]).toBe('<youtube id="abc" caption="Intro" width="50%" align="left" />')
    expect(out[2]).toBe('<youtube id="abc" startTime="10" />')
  })

  it('start time on the tag removes it there, shorthand untouched', () => {
    const out = rewriteYoutubeStartTime(md, 'abc', null, 3, 0)!.split('\n')
    expect(out[0]).toBe('![Intro](https://youtu.be/abc)')
    expect(out[2]).toBe('<youtube id="abc" />')
  })

  it('start time on a shorthand is a no-op', () => {
    expect(rewriteYoutubeStartTime(md, 'abc', 5, 1, 0)).toBeNull()
  })
})

describe('fenced examples and missing lines', () => {
  it('a fenced example with the same id is neither counted nor rewritten', () => {
    const md = ['```', '<youtube id="abc" />', '```', '', '<youtube id="abc" />'].join('\n')
    expect(rewriteYoutubeStartTime(md, 'abc', 60, 5, 0)!.split('\n')[4]).toBe('<youtube id="abc" startTime="60" />')
    expect(rewriteYoutubeStartTime(md, 'abc', 60, 2, 0)).toBeNull()
  })

  it('without a line, nth counts in the whole document', () => {
    const md = ['<youtube id="abc" />', '', '<youtube id="abc" />'].join('\n')
    expect(rewriteYoutubeStartTime(md, 'abc', 15, undefined, 1)!.split('\n')[2]).toBe('<youtube id="abc" startTime="15" />')
  })
})
