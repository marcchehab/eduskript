import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'
import { setPrintState } from '@/lib/print/print-mode'
import { languageForFile } from '@/components/public/code-editor/print-code'

vi.mock('@/lib/userdata', () => ({
  useSyncedUserData: () => ({ data: null, updateData: vi.fn(), isLoading: false }),
}))
// The live editors stand in for "whatever the student typed".
vi.mock('@/components/public/code-editor', () => ({
  CodeEditor: ({ outputOnly }: { outputOnly?: boolean }) => <div data-testid="live-editor">STUDENT CODE {outputOnly ? 'output-only' : ''}</div>,
}))
vi.mock('@/components/public/code-editor/html-preview-editor', () => ({
  HtmlPreviewEditor: () => <div data-testid="live-editor">STUDENT HTML</div>,
}))

async function renderMd(md: string) {
  const components = createMarkdownComponents(createEmptySkriptFiles(), { pageId: 'p1' })
  const tree = (await compileMarkdown(md, { components })) as ReactNode
  return render(<>{tree}</>)
}

const print = (active: boolean) => act(() => { setPrintState({ active }) })
afterEach(() => print(false))

const liveHidden = () => screen.getByTestId('live-editor').closest('[style*="display: none"]') !== null

describe('code editors in the print view', () => {
  it('print the author code as a code block; the live editor stays mounted, hidden', async () => {
    const { container } = await renderMd('```python editor\nprint("starter")\n```')
    expect(container.querySelector('.code-block')).toBeNull()
    expect(liveHidden()).toBe(false)

    print(true)
    const block = container.querySelector('.code-block')!
    expect(block.textContent).toContain('print("starter")')
    expect(block.textContent).not.toContain('STUDENT')
    expect(liveHidden()).toBe(true)
    // Single file: no title bar.
    expect(block.querySelector('.font-mono.text-xs')).toBeNull()

    print(false)
    expect(container.querySelector('.code-block')).toBeNull()
    expect(liveHidden()).toBe(false)
  })

  it('multi-file editors print one block per file with its name', async () => {
    const md = '```python editor id="m" file="main.py"\nimport helper\n```\n\n```python editor id="m" file="helper.py"\nX = 1\n```'
    const { container } = await renderMd(md)
    expect(screen.getAllByTestId('live-editor')).toHaveLength(1)
    print(true)
    const blocks = [...container.querySelectorAll('.code-block')]
    expect(blocks).toHaveLength(2)
    expect(blocks[0].textContent).toContain('main.py')
    expect(blocks[0].textContent).toContain('import helper')
    expect(blocks[1].textContent).toContain('helper.py')
    expect(blocks[1].textContent).toContain('X = 1')
  })

  it('html editors print their source', async () => {
    const { container } = await renderMd('```html editor\n<h1>Hi</h1>\n```')
    print(true)
    expect(container.querySelector('.code-block')!.textContent).toContain('<h1>Hi</h1>')
    expect(liveHidden()).toBe(true)
  })

  it('output-only editors stay visible (they print their output themselves)', async () => {
    const { container } = await renderMd('```python editor output-only\nprint(1)\n```')
    print(true)
    expect(container.querySelector('.code-block')).toBeNull()
    expect(liveHidden()).toBe(false)
  })
})

describe('languageForFile', () => {
  it('maps extensions, falls back to the editor language, none for data files', () => {
    expect(languageForFile('a.py', 'python')).toBe('python')
    expect(languageForFile('q.SQL', 'python')).toBe('sql')
    expect(languageForFile('main', 'javascript')).toBe('javascript')
    expect(languageForFile('data.csv', 'python')).toBeUndefined()
  })
})
