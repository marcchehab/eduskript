import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'

// Bare filenames in links and audio tags resolve to the file's current URL at
// render time, so authored markdown never carries an S3 URL.
const files = createEmptySkriptFiles()
files.files['clip.mp3'] = { id: 'f1', name: 'clip.mp3', url: 'https://cdn.example/abc.mp3' }
files.files['handout.pdf'] = { id: 'f2', name: 'handout.pdf', url: 'https://cdn.example/def.pdf' }
files.files['photo.png'] = { id: 'f3', name: 'photo.png', url: 'https://cdn.example/ghi.png' }

async function renderMd(md: string) {
  const components = createMarkdownComponents(files, { pageId: 'p1' })
  const tree = (await compileMarkdown(md, { components })) as ReactNode
  return render(<>{tree}</>).container
}

describe('file links', () => {
  it('resolves a bare filename link to the file URL', async () => {
    const c = await renderMd('[Handout](handout.pdf)')
    const a = c.querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://cdn.example/def.pdf')
    expect(a.textContent).toBe('Handout')
  })

  it('resolves a link to an image file too (it is a link, not an embed)', async () => {
    const c = await renderMd('[Download](photo.png)')
    expect(c.querySelector('a')!.getAttribute('href')).toBe('https://cdn.example/ghi.png')
  })

  it('leaves absolute links alone', async () => {
    const c = await renderMd('[Site](https://example.org/x.pdf)')
    expect(c.querySelector('a')!.getAttribute('href')).toBe('https://example.org/x.pdf')
  })
})

describe('audio', () => {
  it('resolves src on <audio>', async () => {
    const c = await renderMd('<audio controls src="clip.mp3"></audio>')
    const audio = c.querySelector('audio')!
    expect(audio.getAttribute('src')).toBe('https://cdn.example/abc.mp3')
    expect(audio.hasAttribute('controls')).toBe(true)
  })

  it('resolves src on a <source> child', async () => {
    const c = await renderMd('<audio controls>\n  <source src="clip.mp3" type="audio/mpeg">\n</audio>')
    expect(c.querySelector('audio source')!.getAttribute('src')).toBe('https://cdn.example/abc.mp3')
  })

  it('passes absolute URLs through', async () => {
    const c = await renderMd('<audio controls src="https://cdn.example/other.mp3"></audio>')
    expect(c.querySelector('audio')!.getAttribute('src')).toBe('https://cdn.example/other.mp3')
  })
})
