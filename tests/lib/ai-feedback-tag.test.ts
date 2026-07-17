import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'

/**
 * Pipeline-level checks for the <ai-feedback> tag: sanitizer must keep the
 * tag and its attributes, and the self-closing form must not swallow the
 * content that follows it. The React component itself is mapped in
 * markdown-components.tsx (not exercised here — compileMarkdown without a
 * components map renders the raw element).
 */
async function html(md: string): Promise<string> {
  const tree = (await compileMarkdown(md)) as ReactNode
  return renderToStaticMarkup(tree)
}

describe('ai-feedback tag pipeline', () => {
  it('keeps the tag and its attributes through sanitize', async () => {
    const out = await html('<ai-feedback id="fb1" prompt="Check the steps." label="Check my work" />')
    expect(out).toContain('ai-feedback')
    expect(out).toContain('id="fb1"')
    expect(out).toContain('prompt="Check the steps."')
    expect(out).toContain('label="Check my work"')
  })

  it('does not swallow content after a self-closing tag', async () => {
    const out = await html('## Exercise\n\n<ai-feedback prompt="p" />\n\nAfter text.')
    expect(out).toContain('After text.')
  })

  it('strips disallowed attributes', async () => {
    const out = await html('<ai-feedback prompt="p" onclick="alert(1)" />')
    expect(out).not.toContain('onclick')
  })
})
