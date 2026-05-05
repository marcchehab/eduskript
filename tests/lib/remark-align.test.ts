import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import remarkDirective from 'remark-directive'
import { remarkAlign } from '@/lib/remark-plugins/align'

async function compile(md: string): Promise<string> {
  const out = await unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkAlign)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(md)
  return String(out)
}

describe('remarkAlign', () => {
  it('compiles :::center to a div with es-align-center class', async () => {
    const html = await compile(':::center\n## Heading\n:::')
    expect(html).toContain('<div class="es-align-center">')
    expect(html).toContain('<h2>Heading</h2>')
  })

  it('supports left and right', async () => {
    expect(await compile(':::left\nhi\n:::')).toContain('class="es-align-left"')
    expect(await compile(':::right\nhi\n:::')).toContain('class="es-align-right"')
  })

  it('preserves nested markdown blocks inside the directive', async () => {
    const html = await compile(':::center\n## Title\n\nA paragraph.\n:::')
    expect(html).toContain('<div class="es-align-center">')
    expect(html).toContain('<h2>Title</h2>')
    expect(html).toContain('<p>A paragraph.</p>')
  })

  it('leaves unrelated directive names untouched', async () => {
    // No transform → no es-align-* class produced.
    const html = await compile(':::other\nhi\n:::')
    expect(html).not.toContain('es-align-')
  })
})
