// @vitest-environment node
import { afterAll, describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'
import { buildTikzDocument } from '@/lib/tikz/document'
import { darkSvg, textToPaths, TIKZ_DARK } from '@/lib/tikz/svg'
import { renderTikz, stopTikzWorker, texErrorFromLog } from '@/lib/tikz/render.server'
import { renderTikzForSkript } from '@/lib/tikz/skript.server'
import { createSkriptFiles } from '@/lib/skript-files'
import { TikzImageView } from '@/components/markdown/tikz-image'
import { createElement } from 'react'

afterAll(() => stopTikzWorker())

const svgOf = (dataUrl: string) => decodeURIComponent(dataUrl.slice('data:image/svg+xml,'.length))

describe('tikz document', () => {
  it('moves \\usetikzlibrary and \\usepackage lines to the preamble and keeps the defaults', () => {
    const result = buildTikzDocument('\\usetikzlibrary{patterns, calc}\n\\usepackage{amssymb}\n\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}')
    if (!('document' in result)) throw new Error(result.error)
    expect(result.document.libraries.split(',')).toEqual(['automata', 'positioning', 'arrows.meta', 'calc', 'patterns'])
    expect(result.document.packages).toEqual({ amssymb: '' })
    expect(result.document.body).not.toContain('usetikzlibrary')
    expect(result.document.body).not.toContain('usepackage')
  })

  it('wraps a bare body in a tikzpicture, but not a macro from the skript preamble', () => {
    const bare = buildTikzDocument('\\draw (0,0) -- (1,1);')
    expect('document' in bare && bare.document.body).toBe('\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}')

    const preamble = '\\newcommand{\\zd}[1]{\\begin{tikzpicture}#1\\end{tikzpicture}}'
    const macro = buildTikzDocument('\\zd{\\node {x};}', preamble)
    expect('document' in macro && macro.document.body).toBe('\\zd{\\node {x};}')
    expect('document' in macro && macro.document.preamble).toBe(preamble)
  })

  it('reads alt and caption comments and ignores other comments', () => {
    const result = buildTikzDocument('% alt: Ein Automat\n% caption: Abb. 1\n\\draw (0,0)--(1,0); % \\undefined\n')
    if (!('document' in result)) throw new Error(result.error)
    expect(result.document.alt).toBe('Ein Automat')
    expect(result.document.caption).toBe('Abb. 1')
    expect(result.document.body).not.toContain('undefined')
  })

  it('rejects packages that are not installed, an empty block and oversized input', () => {
    expect(buildTikzDocument('\\usepackage{fontspec}\n\\draw (0,0)--(1,0);')).toEqual({ error: expect.stringContaining('fontspec') })
    expect(buildTikzDocument('% only a comment')).toEqual({ error: expect.stringContaining('empty') })
    expect(buildTikzDocument('x'.repeat(20_001))).toEqual({ error: expect.stringContaining('too long') })
  })

  it('gives the same key for the same inputs and another one when the preamble changes', () => {
    const key = (source: string, preamble = '') => {
      const result = buildTikzDocument(source, preamble)
      return 'document' in result ? result.document.key : ''
    }
    expect(key('\\draw (0,0)--(1,0);')).toBe(key('\\draw (0,0)--(1,0);'))
    expect(key('\\draw (0,0)--(1,0);', '\\definecolor{a}{RGB}{1,2,3}')).not.toBe(key('\\draw (0,0)--(1,0);'))
  })
})

describe('tikz svg post-processing', () => {
  it('replaces text by glyph outlines, one definition per distinct glyph', () => {
    const font = {
      forEachGlyph(text: string, x: number, y: number, size: number, _o: unknown, cb: (g: { index: number; getPath: () => { toPathData: () => string } }, gx: number, gy: number, s: number) => void) {
        ;[...text].forEach((char, i) => cb({ index: char.charCodeAt(0), getPath: () => ({ toPathData: () => `M${char}` }) }, x + i * 5, y, size))
        return 0
      },
    }
    const { svg, missingFonts } = textToPaths(
      '<svg width="10" height="10"><text x="1" y="2" font-family="cmr10" font-size="10" fill="#0000ff">aba</text><text x="0" y="0" font-family="nope" font-size="10">z</text></svg>',
      (family) => (family === 'cmr10' ? font : undefined),
    )
    expect(svg).not.toContain('<text')
    expect(svg.match(/<path id=/g)).toHaveLength(2) // a and b, a only once
    expect(svg.match(/<use /g)).toHaveLength(3)
    expect(svg).toContain('<g fill="#0000ff" stroke="none">')
    expect(missingFonts).toEqual(['nope'])
  })

  it('dark variant: black to ink, white to paper, pale fills dimmed, strong colours kept', () => {
    const dark = darkSvg('<g stroke="#000" fill="black"><path fill="#fff"/><path fill="#91d79b" stroke="#91d79b"/><path fill="#b91c1c"/></g>')
    expect(dark).toContain(`stroke="${TIKZ_DARK.ink}" fill="${TIKZ_DARK.ink}"`)
    expect(dark).toContain(`<path fill="${TIKZ_DARK.paper}"/>`)
    expect(dark).not.toContain('fill="#91d79b"')
    expect(dark).toContain('stroke="#91d79b"')
    expect(dark).toContain('fill="#b91c1c"')
  })

  it('extracts the error and its line from a TeX log', () => {
    const log = 'This is TeX\n! Undefined control sequence.\n<recently read> \\foo\nl.3 \\node {x} \\foo\n! Emergency stop.\nl.3 \\node {x} \\foo\n'
    expect(texErrorFromLog(log)).toBe('Undefined control sequence.\nat: \\node {x} \\foo')
    expect(texErrorFromLog('all fine')).toBeUndefined()
  })
})

describe('tikz rendering (real TeX)', () => {
  const PREAMBLE = String.raw`\definecolor{colGreen}{RGB}{145,215,155}
\tikzset{zdiag/.style={>={Stealth[length=2.4mm]}, every state/.style={draw, minimum size=9.5mm}, auto, node distance=2.6cm}}
\newcommand{\zd}[1]{\begin{tikzpicture}[zdiag]#1\end{tikzpicture}}`

  it('renders an automaton with a skript preamble to light and dark SVG without <text>', async () => {
    const result = await renderTikz(
      String.raw`% alt: Automat
\zd{
  \node[state, initial] (q0) {$q_0$};
  \node[state, accepting, right=of q0, fill=colGreen] (q1) {Zustände};
  \path[->] (q0) edge[bend left] node {a} ($(q1.west)+(0,0.1)$);
}`,
      PREAMBLE,
    )
    if (!('image' in result)) throw new Error(result.error)
    const light = svgOf(result.image.light)
    const dark = svgOf(result.image.dark)
    expect(result.image.alt).toBe('Automat')
    expect(result.image.width).toBeGreaterThan(100)
    expect(light).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+" viewBox=/)
    expect(light).not.toContain('<text')
    expect(light).toContain('<use ')
    expect(light).toContain('#91d79b')
    expect(dark).toContain(TIKZ_DARK.ink)
    expect(dark).not.toMatch(/"(?:#000|black)"/)
  }, 30_000)

  it('renders an extra library and writes no undeclared xlink prefix', async () => {
    const result = await renderTikz('\\usetikzlibrary{shapes.geometric, patterns}\n\\node[draw, diamond] {x};\n\\draw[pattern=north east lines] (2,0) rectangle (3,1);')
    if (!('image' in result)) throw new Error(result.error)
    const svg = svgOf(result.image.light)
    expect(svg).toContain('<path')
    // dvi2svg references pattern symbols as xlink:href without the namespace,
    // which would make the whole image invalid XML.
    expect(svg).not.toContain('xlink:')
  }, 30_000)

  it('reports a TeX error with its line, and renders the next block normally', async () => {
    const bad = await renderTikz(String.raw`\node {x} \undefinedmacro;`)
    expect(bad).toEqual({ error: expect.stringContaining('Undefined control sequence') })
    const good = await renderTikz(String.raw`\draw (0,0) circle (1);`)
    expect('image' in good).toBe(true)
  }, 30_000)

  it('stops an endless loop and recovers', async () => {
    const hung = await renderTikz(String.raw`\loop\iftrue\repeat`)
    expect(hung).toEqual({ error: expect.stringContaining('did not finish') })
    const good = await renderTikz(String.raw`\draw (0,0) -- (2,1);`)
    expect('image' in good).toBe(true)
  }, 40_000)
})

describe('tikz with the skript preamble file', () => {
  const files = createSkriptFiles([{ id: 'f1', name: 'tikz-preamble.tex', url: 'https://files.example/abc.tex' }])

  it('loads tikz-preamble.tex once and puts it in front of the block', async () => {
    const fetchMock = vi.fn(async () => new Response('\\newcommand{\\kreis}{\\begin{tikzpicture}\\draw (0,0) circle (1);\\end{tikzpicture}}'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      expect('image' in (await renderTikzForSkript('\\kreis', files))).toBe(true)
      expect('image' in (await renderTikzForSkript('\\kreis % again', files))).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      // Without the file the macro does not exist.
      expect(await renderTikzForSkript('\\kreis', undefined)).toEqual({ error: expect.stringContaining('Undefined control sequence') })
    } finally {
      vi.unstubAllGlobals()
    }
  }, 30_000)

  it('reports a preamble that cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    try {
      const other = createSkriptFiles([{ id: 'f2', name: 'tikz-preamble.tex', url: 'https://files.example/missing.tex' }])
      expect(await renderTikzForSkript('\\draw (0,0)--(1,1);', other)).toEqual({ error: 'Could not load tikz-preamble.tex: HTTP 404' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('tikz in the markdown pipeline', () => {
  // Without a server renderer the block goes to /api/tikz from the browser and
  // shows a placeholder until then.
  async function html(md: string): Promise<string> {
    const components = {
      ...createMarkdownComponents(createEmptySkriptFiles()),
      solution: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
    }
    return renderToStaticMarkup((await compileMarkdown(md, { components })) as ReactNode)
  }
  const FENCE = '```tikz\n\\draw[->] (0,0) -- (2,1) node[right] {$x < y$ & "z"};\n```'
  const quoted = (text: string) => text.split('\n').map((line) => `> ${line}`).join('\n')

  const CASES: Record<string, string> = {
    'at the top level': FENCE,
    'in a callout': `> [!example] Beispiel\n${quoted(FENCE)}`,
    'in a list item': `- Punkt\n\n  ${FENCE.replace(/\n/g, '\n  ')}`,
    'in a <flex-item>': `<flex>\n<flex-item>\n\n${FENCE}\n\n</flex-item>\n</flex>`,
    'in a callout inside a <solution>': `<solution>\n\n> [!note] X\n${quoted(FENCE)}\n\n</solution>`,
  }
  for (const [where, md] of Object.entries(CASES)) {
    it(`becomes a figure ${where}`, async () => {
      const out = await html(md)
      expect(out).toContain('tikz-loading')
      expect(out).not.toContain('\\draw')
    })
  }

  it('hands the fence body to the renderer unchanged', async () => {
    const seen: string[] = []
    const components = createMarkdownComponents(createEmptySkriptFiles(), {
      tikzRender: async (source) => {
        seen.push(source)
        return { error: 'not rendered in this test' }
      },
    })
    const tree = (await compileMarkdown(`> [!note] X\n${quoted(FENCE)}`, { components })) as ReactNode
    // The server component is async; call it the way React would.
    const visit = async (node: unknown): Promise<void> => {
      if (Array.isArray(node)) { for (const child of node) await visit(child); return }
      if (!node || typeof node !== 'object' || !('props' in node)) return
      const element = node as { type: unknown; props: Record<string, unknown> }
      if (typeof element.type === 'function' && 'render' in element.props && 'source' in element.props) {
        await (element.type as (p: unknown) => Promise<unknown>)(element.props)
        return
      }
      if (typeof element.type === 'function') {
        // Components with hooks cannot be called outside React: look at their children instead.
        try { await visit((element.type as (p: unknown) => unknown)(element.props)) } catch { await visit(element.props.children) }
        return
      }
      await visit(element.props.children)
    }
    await visit(tree)
    expect(seen).toEqual(['\\draw[->] (0,0) -- (2,1) node[right] {$x < y$ & "z"};'])
  })

  it('shows the picture or the error', () => {
    const picture = renderToStaticMarkup(createElement(TikzImageView, { result: { image: { light: 'data:image/svg+xml,L', dark: 'data:image/svg+xml,D', width: 120, height: 60, alt: 'Automat', caption: 'Abb. 1' } } }))
    expect(picture).toContain('class="plot-light')
    expect(picture).toContain('class="plot-dark')
    expect(picture).toContain('alt="Automat"')
    expect(picture).toContain('Abb. 1')
    const error = renderToStaticMarkup(createElement(TikzImageView, { result: { error: 'Undefined control sequence.\nat: \\foo' } }))
    expect(error).toContain('TikZ error: Undefined control sequence.')
    expect(error).toContain('at: \\foo')
  })
})
