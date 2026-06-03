import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'

/**
 * Raw <iframe> embeds (geotraceroute etc.) are allowed through the sanitizer,
 * but rehypeSandboxIframes forces a safe sandbox afterwards so authors can't
 * weaken it. See src/lib/rehype-plugins/sandbox-iframes.ts.
 */
async function html(md: string): Promise<string> {
  const tree = (await compileMarkdown(md)) as ReactNode
  return renderToStaticMarkup(tree)
}

describe('iframe embeds', () => {
  it('keeps the iframe and its https src', async () => {
    const out = await html('<iframe src="https://geotraceroute.com/?host=wairualodge.co.nz" width="100%" height="500"></iframe>')
    expect(out).toContain('<iframe')
    expect(out).toContain('src="https://geotraceroute.com/?host=wairualodge.co.nz"')
    expect(out).toContain('height="500"')
  })

  it('forces the safe sandbox even when the author omits it', async () => {
    const out = await html('<iframe src="https://example.com"></iframe>')
    expect(out).toContain('sandbox="allow-scripts allow-same-origin allow-popups allow-forms"')
    expect(out).toContain('loading="lazy"')
  })

  it('overrides an author-supplied sandbox (cannot add allow-top-navigation)', async () => {
    const out = await html('<iframe src="https://example.com" sandbox="allow-scripts allow-top-navigation"></iframe>')
    expect(out).not.toContain('allow-top-navigation')
    expect(out).toContain('sandbox="allow-scripts allow-same-origin allow-popups allow-forms"')
  })

  it('strips a javascript: src (sanitizer protocol allowlist)', async () => {
    const out = await html('<iframe src="javascript:alert(1)"></iframe>')
    expect(out).not.toContain('javascript:alert(1)')
  })
})
