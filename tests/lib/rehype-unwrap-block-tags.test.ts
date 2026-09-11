import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeStringify from 'rehype-stringify'
import { rehypeUnwrapBlockTags } from '@/lib/rehype-plugins/unwrap-block-tags'
import { rehypeMarkdownChildren } from '@/lib/rehype-plugins/markdown-children'

async function render(md: string) {
  const out = await unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeUnwrapBlockTags)
    .use(rehypeMarkdownChildren)
    .use(rehypeStringify)
    .process(md)
  return String(out)
}

describe('banner', () => {
  it('single-line form is hoisted out of <p> and text is inline', async () => {
    const html = await render('<banner>New: [Atlas](https://x.org) here</banner>\n\nBody')
    expect(html).toMatch(/^<banner>New: <a href="https:\/\/x.org">Atlas<\/a> here<\/banner>/)
    expect(html).not.toMatch(/<p><banner>/)
  })
  it('multi-line form works', async () => {
    const html = await render('<banner>\nNew: **Atlas**\n</banner>\n\nBody')
    expect(html).toContain('<banner>New: <strong>Atlas</strong></banner>')
  })
  it('banner mixed into running text stays put', async () => {
    const html = await render('Hello <banner>x</banner> world')
    expect(html).toContain('<p>Hello <banner>x</banner> world</p>')
  })
})
