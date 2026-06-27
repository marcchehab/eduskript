import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'

// Proves <onlyfor> survives the sanitizer and its attributes reach the
// component (a stripped tag or dropped attr would fail silently in prod).
function gateProbe(props: Record<string, unknown>) {
  const present = (k: string) => (props[k] !== undefined ? '1' : '0')
  const cls =
    (typeof props.class === 'string' && props.class) ||
    (typeof props.className === 'string' && props.className) ||
    ''
  return (
    <div
      data-auth={present('auth')}
      data-students={present('students')}
      data-anon={present('anon')}
      data-class={String(cls)}
      data-prompt={String(props.prompt ?? '')}
    >
      {props.children as ReactNode}
    </div>
  )
}

async function render(md: string): Promise<string> {
  const tree = (await compileMarkdown(md, { components: { onlyfor: gateProbe } })) as ReactNode
  return renderToStaticMarkup(tree)
}

describe('<onlyfor> markdown pipeline', () => {
  it('keeps the tag, the auth attr, and the wrapped children', async () => {
    const html = await render('<onlyfor auth>\n\nGATED_BODY\n\n</onlyfor>')
    expect(html).toContain('GATED_BODY')
    expect(html).toContain('data-auth="1"')
    expect(html).toContain('data-students="0"')
  })

  it('passes students + prompt through', async () => {
    const html = await render('<onlyfor students prompt="Members only">\n\nX\n\n</onlyfor>')
    expect(html).toContain('data-students="1"')
    expect(html).toContain('data-prompt="Members only"')
  })

  it('delivers class="3a" (as class or className)', async () => {
    const html = await render('<onlyfor class="3a">\n\nX\n\n</onlyfor>')
    expect(html).toContain('data-class="3a"')
  })
})
