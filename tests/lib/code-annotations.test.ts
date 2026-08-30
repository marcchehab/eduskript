import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { Code, Root } from 'mdast'
import { remarkCodeAnnotations } from '@/lib/remark-plugins/code-annotations'

function firstCode(markdown: string): Code {
  const tree = unified().use(remarkParse).use(remarkCodeAnnotations).runSync(
    unified().use(remarkParse).parse(markdown),
  ) as Root
  const node = tree.children.find((n) => n.type === 'code')
  if (!node) throw new Error('no code node')
  return node as Code
}

function props(node: Code): Record<string, string> {
  return (node.data?.hProperties ?? {}) as Record<string, string>
}

describe('remarkCodeAnnotations', () => {
  it('collects ++ / -- / highlight / focus lines and strips the markers', () => {
    const node = firstCode(
      [
        '```python',
        'import turtle',
        'import os # [!code ++]',
        'turtle.done() # [!code --]',
        'window.tracer(0) # [!code highlight]',
        'ship.setx(1) # [!code focus]',
        '```',
      ].join('\n'),
    )
    expect(props(node)).toEqual({
      dataAdd: '2',
      dataDel: '3',
      dataHighlight: '4',
      dataFocus: '5',
    })
    expect(node.value).toBe(
      ['import turtle', 'import os', 'turtle.done()', 'window.tracer(0)', 'ship.setx(1)'].join('\n'),
    )
  })

  it('turns a marker-only line into an empty added line', () => {
    const node = firstCode(['```python', 'import os # [!code ++]', ' # [!code ++]', 'x = 1', '```'].join('\n'))
    expect(props(node).dataAdd).toBe('1,2')
    expect(node.value).toBe('import os\n\nx = 1')
  })

  it('applies the :N suffix to that line and the following ones', () => {
    const node = firstCode(['```js', 'a() // [!code ++:3]', 'b()', 'c()', 'd()', '```'].join('\n'))
    expect(props(node).dataAdd).toBe('1,2,3')
    expect(node.value).toBe('a()\nb()\nc()\nd()')
  })

  it('strips block and SQL comment tokens', () => {
    const node = firstCode(
      ['```sql', 'SELECT 1; -- [!code ++]', '```'].join('\n'),
    )
    expect(props(node).dataAdd).toBe('1')
    expect(node.value).toBe('SELECT 1;')

    const html = firstCode(['```html', '<p></p> <!-- [!code --] -->', '```'].join('\n'))
    expect(props(html).dataDel).toBe('1')
    expect(html.value).toBe('<p></p>')
  })

  it('reads line ranges from the info string, bare braces meaning highlight', () => {
    const node = firstCode(
      ['```python {2,4-5} add={1} del={3} focus={5}', 'a', 'b', 'c', 'd', 'e', '```'].join('\n'),
    )
    expect(props(node)).toEqual({
      dataAdd: '1',
      dataDel: '3',
      dataHighlight: '2,4,5',
      dataFocus: '5',
    })
    expect(node.value).toBe('a\nb\nc\nd\ne')
  })

  it('leaves untouched blocks without hProperties', () => {
    const node = firstCode(['```python', 'print("hi")', '```'].join('\n'))
    expect(node.data?.hProperties).toBeUndefined()
    expect(node.value).toBe('print("hi")')
  })
})
