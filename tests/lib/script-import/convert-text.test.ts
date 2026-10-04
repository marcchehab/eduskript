// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { convertText, detectTextFormat, extractHtmlImages } from '@/lib/script-import/convert-text'

describe('detectTextFormat', () => {
  it('recognises LaTeX, Markdown, HTML and plain text', () => {
    expect(detectTextFormat('\\section{Kinematik}\nDie Beschleunigung $a$ ist \\textbf{konstant}.\n\\begin{equation}v=at\\end{equation}')).toBe('latex')
    expect(detectTextFormat('# Titel\n\n- eins\n- zwei\n\n## Teil')).toBe('markdown')
    expect(detectTextFormat('Titel\nText', '<html><body><h1>Titel</h1><p>Text</p></body></html>')).toBe('html')
    expect(detectTextFormat('Ein einfacher Absatz ohne Auszeichnung.')).toBe('markdown')
  })

  it('prefers recognisable Markdown over clipboard HTML (code editors copy coloured HTML)', () => {
    expect(detectTextFormat('# A\n\n- b\n- c', '<div><span style="color:red"># A</span></div>')).toBe('markdown')
  })
})

describe('extractHtmlImages', () => {
  it('turns data: images into assets and drops local file refs', () => {
    const png = Buffer.from([137, 80, 78, 71]).toString('base64')
    const { html, assets, dropped } = extractHtmlImages(
      `<p><img src="data:image/png;base64,${png}"> <img src="file:///C:/Temp/clip_image002.png"> <img src="https://x.ch/a.png"></p>`
    )
    expect(assets.map((a) => a.name)).toEqual(['image-1.png'])
    expect(dropped).toBe(1)
    expect(html).toContain('src="image-1.png"')
    expect(html).toContain('https://x.ch/a.png')
  })
})

describe('convertText', () => {
  it('converts LaTeX with math via pandoc', async () => {
    const { markdown, format } = await convertText('\\section{Fall}\nEs gilt $s = \\frac{1}{2} g t^2$ und \\textbf{wichtig}.\n\\begin{itemize}\\item eins\\item zwei\\end{itemize}')
    expect(format).toBe('latex')
    expect(markdown).toContain('# Fall')
    expect(markdown).toContain('$s = \\frac{1}{2} g t^2$')
    expect(markdown).toContain('**wichtig**')
  }, 60_000)

  it('converts clipboard HTML (headings, tables)', async () => {
    const { markdown } = await convertText('x', '<h2>Teil</h2><p>Hallo <b>Welt</b></p><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>')
    expect(markdown).toContain('## Teil')
    expect(markdown).toContain('**Welt**')
    expect(markdown).toMatch(/\| a +\| b +\|/)
  }, 60_000)

  it('passes Markdown through', async () => {
    expect((await convertText('# A\n\n- b\n- c')).markdown).toBe('# A\n\n- b\n- c')
  })
})
