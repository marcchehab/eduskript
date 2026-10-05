import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'

// PluginContainer needs the UserData provider; a bare <div> is enough to
// check where the plugin lands in the tree.
vi.mock('@/components/markdown/plugin-container', () => ({
  PluginContainer: ({ src }: { src: string }) => <div data-plugin={src} />,
}))

async function render(md: string) {
  const components = createMarkdownComponents(createEmptySkriptFiles())
  const tree = (await compileMarkdown(md, { components })) as ReactNode
  return renderToStaticMarkup(<>{tree}</>)
}

// QA finding plugin-in-paragraph-hydration-error: a <plugin /> on its own line
// was wrapped in <p>, and its <div> (plus the section-end marker) inside that
// <p> broke hydration.
describe('<plugin> on its own line', () => {
  it.each([
    ['alone', '<plugin src="teacher/x" height="520" />'],
    ['between paragraphs', 'Intro.\n\n<plugin src="teacher/x" height="520" />\n\nAfter.'],
  ])('is not rendered inside a <p> (%s)', async (_label, md) => {
    const html = await render(md)
    expect(html).toContain('data-plugin="teacher/x"')
    expect(html).not.toMatch(/<p[^>]*>(?:(?!<\/p>).)*<div/s)
  })
})
