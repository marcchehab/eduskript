import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeStringify from 'rehype-stringify'
import { rehypeAlignTags } from '@/lib/rehype-plugins/align-tags'

async function compile(md: string): Promise<string> {
  const out = await unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeAlignTags)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(md)
  return String(out)
}

describe('rehypeAlignTags', () => {
  it('rewrites <center> to a div with es-align-center class', async () => {
    const html = await compile('<center>\n\n## Heading\n\n</center>')
    expect(html).toContain('<div class="es-align-center">')
    expect(html).toContain('<h2>Heading</h2>')
  })

  it('supports <left> and <right>', async () => {
    expect(await compile('<left>\n\nhi\n\n</left>')).toContain('class="es-align-left"')
    expect(await compile('<right>\n\nhi\n\n</right>')).toContain('class="es-align-right"')
  })

  it('parses nested markdown blocks inside the wrapper', async () => {
    const html = await compile('<center>\n\n## Title\n\nA paragraph.\n\n</center>')
    expect(html).toContain('<div class="es-align-center">')
    expect(html).toContain('<h2>Title</h2>')
    expect(html).toContain('<p>A paragraph.</p>')
  })

  it('leaves unrelated tags untouched', async () => {
    const html = await compile('<div>hi</div>')
    expect(html).not.toContain('es-align-')
    expect(html).toContain('<div>hi</div>')
  })

  it('does not eat stray colons in body text', async () => {
    // The whole point of replacing remark-directive: inline `:foo` survives.
    const html = await compile('Note: see :hello there.')
    expect(html).toContain(':hello')
  })
})
