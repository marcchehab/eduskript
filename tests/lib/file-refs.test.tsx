import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'

const { fileFindMany, videoFindMany } = vi.hoisted(() => ({
  fileFindMany: vi.fn(),
  videoFindMany: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { file: { findMany: fileFindMany }, video: { findMany: videoFindMany } },
}))
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}))
vi.mock('@/lib/s3', () => ({
  getTeacherFileUrl: (key: string) => `https://cdn.example/${key}`,
}))

import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createSkriptFiles, resolveFile, resolveVideo, skriptFileNames, type SkriptFilesData, type VideoInfo } from '@/lib/skript-files'
import { fetchSkriptFiles } from '@/lib/skript-files.server'
import { getFileExtension, getS3Key, sanitizeFilename } from '@/lib/file-storage'
import { buildFileEmbed, decodeFileRef, encodeFileRef, fileKind, matchByRefs, renameFileRefs } from '@/lib/file-refs'
import { repairFileRefs } from '@/lib/file-ref-repair'
import { extractReferencedFilenames, extractReferencedVideoFilenames } from '@/lib/extract-file-references'

const URL_OK = 'https://cdn.example/resolved'

const STEMS: Array<[label: string, stem: string]> = [
  ['macOS screenshot', 'Bildschirmfoto 2026-03-20 um 11.27.29'],
  ['U+202F before AM', 'Screenshot 2026-03-20 at 11.27.29 AM'],
  ['NBSP', 'Foto Klasse'],
  ['double space', 'two  spaces'],
  ['multiple dots', 'Version.1.2.final'],
  ['umlauts NFC', 'Prüfung Übung'.normalize('NFC')],
  ['umlauts NFD', 'Prüfung Übung'.normalize('NFD')],
  ['brackets', 'Übersicht [Entwurf]'],
  ['parentheses', 'Bild (1)'],
  ['unbalanced open', 'Bild (1'],
  ['unbalanced close', 'Bild 1)'],
  ['ampersand', 'A & B'],
  ['entity lookalike', 'R&copy.x'],
  ['hash', 'Aufgabe #3'],
  ['percent', '100%'],
  ['percent sequence', '50%25'],
  ['plus', 'C++ + Java'],
  ['apostrophe', "l'école"],
  ['double quotes', 'He said "hi"'],
  ['backtick', 'a`tick'],
  ['emoji', '📸 Foto'],
  ['ZWJ emoji', '👩‍💻 code'],
  ['leading spaces', '  leading'],
  ['scheme lookalike', 'https-basics'],
  ['math lookalike', '$x$ und $y$'],
  ['emphasis lookalike', 'a_b_c*d*'],
  ['spaced emphasis', 'a *b* c'],
  ['pipe', 'pipe|name'],
  ['colon', 'a:b'],
  ['braces', 'a{b}'],
  ['comma', 'a,b'],
]

const EXTENSIONS = [
  'png', 'PNG', 'jpg', 'JPG', 'jpeg', 'gif', 'webp', 'svg',
  'excalidraw', 'pdf', 'PDF', 'db', 'sqlite', 'SQLITE',
  'mp4', 'mov', 'MOV', 'mp3', 'wav', 'ogg',
  'zip', 'docx', 'csv', 'webm',
]

function filesFor(name: string): SkriptFilesData {
  const list = [{ id: 'f1', name, url: URL_OK }]
  if (fileKind(name) === 'excalidraw') {
    list.push(
      { id: 'f2', name: `${name}.light.svg`, url: `${URL_OK}/light` },
      { id: 'f3', name: `${name}.dark.svg`, url: `${URL_OK}/dark` }
    )
  }
  const videos: VideoInfo[] = fileKind(name) === 'video'
    ? [{ id: 'v1', filename: name, provider: 'self', metadata: {} }]
    : []
  return createSkriptFiles(list, videos)
}

/** Compile and render, then return the URL or lookup result the embed ended at. */
async function renderedTarget(md: string, files: SkriptFilesData): Promise<string> {
  let db: string | undefined
  let video: string | undefined
  const components = {
    ...createMarkdownComponents(files, { pageId: 'p1' }),
    // CodeEditor and MuxVideo need a browser runtime, so capture what they
    // receive and run the lookups their wrappers run.
    'code-editor': (props: Record<string, string>) => { db = props['data-db'] ?? props.dataDb; return null },
    muxvideo: (props: { src: string }) => { video = props.src; return null },
  }
  const tree = (await compileMarkdown(md, { components: components as never, fileNames: skriptFileNames(files) })) as ReactNode
  const { container, unmount } = render(<>{tree}</>)
  const url = container.querySelector('img, iframe, audio')?.getAttribute('src')
    ?? container.querySelector('a[href]')?.getAttribute('href')
    ?? (db !== undefined ? resolveFile(files, db)?.url : undefined)
    ?? (video !== undefined && resolveVideo(files, video) ? URL_OK : undefined)
    ?? `NOT RESOLVED: ${container.innerHTML}`
  unmount()
  return url
}

describe('every embed type with unusual filenames', () => {
  const cases = STEMS.flatMap(([label, stem]) =>
    EXTENSIONS.map((ext) => ({ label, ext, raw: `${stem}.${ext}` }))
  )

  it.each(cases)('$label .$ext: stored as uploaded', async ({ raw }) => {
    // Videos bypass sanitizeFilename (videos/upload-url only trims).
    const stored = fileKind(raw) === 'video' ? raw.trim() : sanitizeFilename(raw)
    expect(await renderedTarget(buildFileEmbed(stored), filesFor(stored))).toContain(URL_OK)
  })

  it.each(cases)('$label .$ext: row stored before sanitizing normalized it', async ({ raw }) => {
    expect(await renderedTarget(buildFileEmbed(raw), filesFor(raw))).toContain(URL_OK)
  })

  it.each(cases)('$label .$ext: file link', async ({ raw }) => {
    if (fileKind(raw) === 'video' || fileKind(raw) === 'excalidraw' || fileKind(raw) === 'audio') return
    expect(await renderedTarget(buildFileEmbed(raw, 'link'), filesFor(raw))).toContain(URL_OK)
  })

  it.each(cases)('$label .$ext: reference extraction finds the stored name', ({ raw }) => {
    const md = buildFileEmbed(raw)
    const found = fileKind(raw) === 'video' ? extractReferencedVideoFilenames(md) : extractReferencedFilenames(md)
    expect(found).toContain(raw)
  })

  it.each(cases)('$label .$ext: survives a rename', ({ raw }) => {
    const md = `before ${buildFileEmbed(raw)} after`
    expect(renameFileRefs(md, raw, 'new name.png')).toContain('new%20name.png')
  })
})

describe('pages stored by older editors', () => {
  // Names that were accepted by sanitizeFilename and can be embedded raw.
  const RAW_STEMS = STEMS.filter(([label]) => [
    'macOS screenshot', 'U+202F before AM', 'NBSP', 'double space', 'multiple dots',
    'umlauts NFC', 'umlauts NFD', 'brackets', 'parentheses', 'ampersand', 'hash',
    'percent', 'percent sequence', 'plus', 'apostrophe', 'emoji', 'ZWJ emoji',
    'unbalanced open', 'unbalanced close', 'math lookalike', 'spaced emphasis',
  ].includes(label))

  it.each(RAW_STEMS)('%s: image', async (_, stem) => {
    const name = `${stem}.png`
    expect(await renderedTarget(`![](${name})`, filesFor(name))).toContain(URL_OK)
  })

  it.each(RAW_STEMS)('%s: uppercase extension', async (_, stem) => {
    const name = `${stem}.PNG`
    expect(await renderedTarget(`![](${name})`, filesFor(name))).toContain(URL_OK)
  })

  it.each(RAW_STEMS)('%s: excalidraw', async (_, stem) => {
    const name = `${stem}.excalidraw`
    expect(await renderedTarget(`![](${name})`, filesFor(name))).toContain(URL_OK)
  })

  it.each(RAW_STEMS)('%s: video', async (_, stem) => {
    const name = `${stem}.mp4`
    expect(await renderedTarget(`![](${name})`, filesFor(name))).toContain(URL_OK)
  })

  it.each(RAW_STEMS)('%s: file link', async (_, stem) => {
    const name = `${stem}.zip`
    expect(await renderedTarget(`[Download](${name})`, filesFor(name))).toContain(URL_OK)
  })

  it.each(RAW_STEMS)('%s: pdf tag', async (_, stem) => {
    const name = `${stem}.pdf`
    expect(await renderedTarget(`<pdf src="${name}" height="1267"></pdf>`, filesFor(name))).toContain(URL_OK)
  })

  it.each(RAW_STEMS)('%s: audio tag', async (_, stem) => {
    const name = `${stem}.mp3`
    expect(await renderedTarget(`<audio controls src="${name}"></audio>`, filesFor(name))).toContain(URL_OK)
  })

  it.each(RAW_STEMS)('%s: sql editor', async (_, stem) => {
    const name = `${stem}.db`
    const md = `\`\`\`sql editor id="x" db="${name}"\nSELECT 1;\n\`\`\``
    expect(await renderedTarget(md, filesFor(name))).toContain(URL_OK)
  })

  it.each(RAW_STEMS)('%s: angle-bracket destination', async (_, stem) => {
    const name = `${stem}.png`
    expect(await renderedTarget(`![](<${name}>)`, filesFor(name))).toContain(URL_OK)
  })

  it.each(RAW_STEMS)('%s: extraction', (_, stem) => {
    const name = `${stem}.png`
    expect(extractReferencedFilenames(`![](${name})`)).toContain(name)
  })

  it('leaves plain names exactly as they were', () => {
    expect(buildFileEmbed('photo.png')).toBe('![](photo.png)')
    expect(buildFileEmbed('Müller.png')).toBe('![](Müller.png)')
    expect(buildFileEmbed('clip.mp3')).toBe('<audio controls src="clip.mp3"></audio>')
    expect(buildFileEmbed('notes.zip')).toBe('[notes](notes.zip)')
    expect(extractReferencedFilenames('![](photo.png)')).toEqual(['photo.png'])
  })

  it('keeps `{invert}` after a repaired image', async () => {
    const name = 'a b.png'
    const md = `![](${name}){invert}`
    const components = createMarkdownComponents(filesFor(name), { pageId: 'p1' })
    const { container } = render(<>{(await compileMarkdown(md, { components })) as ReactNode}</>)
    expect(container.textContent).not.toContain('invert')
  })

  it('does not repair references in code or in ordinary prose', async () => {
    const files = filesFor('a b.png')
    const components = createMarkdownComponents(files, { pageId: 'p1' })
    const md = '`![](a b.png)`\n\n```\n![](a b.png)\n```\n\nsee [the docs](for more)'
    const { container } = render(<>{(await compileMarkdown(md, { components })) as ReactNode}</>)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
  })
})

describe('resolution', () => {
  it('gives "50%.png" and "50%25.png" their own embeds', async () => {
    const files = createSkriptFiles([
      { id: 'plain', name: '50%.png', url: `${URL_OK}/plain` },
      { id: 'literal', name: '50%25.png', url: `${URL_OK}/literal` },
    ])
    expect(await renderedTarget(buildFileEmbed('50%.png'), files)).toBe(`${URL_OK}/plain`)
    expect(await renderedTarget(buildFileEmbed('50%25.png'), files)).toBe(`${URL_OK}/literal`)
    // Stored by an older editor, raw.
    expect(await renderedTarget('![](50%.png)', files)).toBe(`${URL_OK}/plain`)
    expect(await renderedTarget('![](50%25.png)', files)).toBe(`${URL_OK}/literal`)
  })

  it('documents the limitation: the reference a%20b.png cannot name "a b.png" next to a literal sibling', () => {
    const files = createSkriptFiles([
      { id: 'spaced', name: 'a b.png' },
      { id: 'literal', name: 'a%20b.png' },
    ])
    expect(resolveFile(files, encodeFileRef('a b.png'))?.id).toBe('literal')
    expect(resolveFile(files, encodeFileRef('a%20b.png'))?.id).toBe('literal')
    expect(resolveFile(files, 'a b.png')?.id).toBe('spaced')
  })

  it('prefers an exact name over a decoded one', () => {
    const files = createSkriptFiles([
      { id: 'literal', name: 'a%20b.png' },
      { id: 'decoded', name: 'a b.png' },
    ])
    expect(resolveFile(files, 'a%20b.png')?.id).toBe('literal')
    expect(resolveFile(files, 'a b.png')?.id).toBe('decoded')
  })

  it('matches across NFC, NFD, U+202F and NBSP', () => {
    const files = createSkriptFiles([{ id: 'f', name: 'Müller AM x.png' }])
    expect(resolveFile(files, 'Müller AM x.png')?.id).toBe('f')
    expect(resolveFile(files, 'M%C3%BCller%20AM%20x.png')?.id).toBe('f')
  })

  it('tolerates malformed percent sequences', () => {
    expect(decodeFileRef('100%.png')).toBe('100%.png')
    expect(decodeFileRef('50%25%20x%.png')).toBe('50% x%.png')
  })

  it('round-trips every name through encode and decode', () => {
    for (const [, stem] of STEMS) {
      expect(decodeFileRef(encodeFileRef(`${stem}.png`))).toBe(`${stem}.png`)
    }
  })

  it('finds an embed inside a container re-parsed from raw HTML', async () => {
    const name = 'Bildschirmfoto 2026.png'
    const md = `<fullwidth>\n${buildFileEmbed(name)}\n</fullwidth>`
    expect(await renderedTarget(md, filesFor(name))).toContain(URL_OK)
  })

  it('finds an embed in a GFM table cell even with a pipe in the name', async () => {
    const name = 'a|b.png'
    const md = `| x |\n| - |\n| ${buildFileEmbed(name)} |`
    expect(await renderedTarget(md, filesFor(name))).toContain(URL_OK)
  })
})

describe('repairFileRefs', () => {
  it('leaves valid markdown byte-identical', () => {
    const md = '![](a.png) [x](y.pdf "t") ![](<a b.png>) [z](a_(1).png) [site](https://x.org/a b.png)'
    expect(repairFileRefs(md)).toBe(md)
  })

  it('does not let a link swallow the next one on the line', () => {
    expect(repairFileRefs('[a](https://x.org) ![](b c.png)')).toBe('[a](https://x.org) ![](b%20c.png)')
  })

  it('keeps code exactly as written, indented blocks too', () => {
    const md = '`![](a b.png)`\n\n    ![](a b.png)\n\n> ```\n> ![](a b.png)\n> ```'
    expect(repairFileRefs(md)).toBe(md)
  })

  it('keeps the title and the line count', () => {
    expect(repairFileRefs('x\n![](a b.mp4 "thumb.jpg")\ny')).toBe('x\n![](a%20b.mp4 "thumb.jpg")\ny')
  })

  it('repairs inside a raw HTML block', () => {
    expect(repairFileRefs('<question>\n![](a b.png)\n</question>')).toContain('a%20b.png')
  })

  it('reads a nested label', () => {
    expect(repairFileRefs('[Plan [v1]](Plan [v1].pdf)')).toBe('[Plan [v1]](Plan%20%5Bv1%5D.pdf)')
  })
})

describe('where a repaired destination ends', () => {
  async function page(md: string, names: string[]) {
    const files = createSkriptFiles(names.map((name, i) => ({ id: `f${i}`, name, url: `${URL_OK}/${i}` })))
    const components = createMarkdownComponents(files, { pageId: 'p1' })
    const tree = (await compileMarkdown(md, { components, fileNames: skriptFileNames(files) })) as ReactNode
    return render(<>{tree}</>).container
  }

  it('leaves `[a](b c) see (photo.png)` as text, with or without the file', async () => {
    const md = '[a](b c) see (photo.png)'
    expect(repairFileRefs(md)).toBe(md)
    expect(repairFileRefs(md, ['photo.png'])).toBe(md)
    const c = await page(md, ['photo.png'])
    expect(c.querySelector('a, img')).toBeNull()
    expect(c.textContent).toContain('see (photo.png)')
  })

  it('ends a file link at its own parenthesis', async () => {
    const md = '[a](b c.pdf) see (photo.png)'
    expect(repairFileRefs(md)).toBe('[a](b%20c.pdf) see (photo.png)')
    const c = await page(md, ['b c.pdf', 'photo.png'])
    expect(c.querySelector('a')!.getAttribute('href')).toBe(`${URL_OK}/0`)
    expect(c.textContent).toContain('see (photo.png)')
  })

  it.each([
    ['[a](b c.pdf) and [d](e f.pdf)', '[a](b%20c.pdf) and [d](e%20f.pdf)'],
    ['[a](b c) and [d](e f.pdf)', '[a](b c) and [d](e%20f.pdf)'],
    ['[a](b c.pdf) and [d](e f)', '[a](b%20c.pdf) and [d](e f)'],
    ['[a](b.pdf) and [d](e f.pdf) (see g.png)', '[a](b.pdf) and [d](e%20f.pdf) (see g.png)'],
    ['![](a b.png) ![](c d.png)', '![](a%20b.png) ![](c%20d.png)'],
  ])('two links on one line: %s', (md, expected) => {
    expect(repairFileRefs(md)).toBe(expected)
  })

  it('keeps parenthesised text after a valid image as text', async () => {
    const md = '![](a.png) (see b.png)'
    expect(repairFileRefs(md, ['a.png', 'b.png'])).toBe(md)
    const c = await page(md, ['a.png', 'b.png'])
    expect(c.querySelectorAll('img')).toHaveLength(1)
    expect(c.textContent).toContain('(see b.png)')
  })

  it('keeps legacy names with balanced parentheses working without a list', () => {
    expect(repairFileRefs('![](foto (1).png) (rechts)')).toBe('![](foto%20%281%29.png) (rechts)')
  })

  it('takes a name with stray parentheses only if that file exists', async () => {
    const md = '[a](b c) see (photo.png)'
    const name = 'b c) see (photo.png'
    expect(await renderedTarget(md, filesFor(name))).toContain(URL_OK)
    expect(repairFileRefs('![](Bild 1).png)')).toBe('![](Bild 1).png)')
    expect(repairFileRefs('![](Bild 1).png)', ['Bild 1).png'])).toBe('![](Bild%201%29.png)')
  })

  it('matches the list across percent-encoding, NFD and U+202F', () => {
    expect(repairFileRefs('![](Mu\u0308ller 1).png)', ['Müller\u202f1).png'])).toBe('![](Mu\u0308ller%201%29.png)')
  })

  it('finds both readings for copy, and matchByRefs keeps the real file', () => {
    const refs = extractReferencedFilenames('[a](b c) see (photo.png)')
    const stored = [{ name: 'b c) see (photo.png' }, { name: 'b c' }, { name: 'other.png' }]
    expect(matchByRefs(stored, refs, (f) => f.name).map((f) => f.name)).toEqual(['b c) see (photo.png', 'b c'])
  })

  it('gives the server list and the client list the same result', () => {
    fileFindMany.mockResolvedValue([{ id: 'f', name: 'Bild 1).png', hash: 'h', width: null, height: null }])
    videoFindMany.mockResolvedValue([])
    return fetchSkriptFiles('s1').then((server) => {
      const client = createSkriptFiles([{ id: 'f', name: 'Bild 1).png', url: 'x' }])
      const md = '![](Bild 1).png)'
      expect(repairFileRefs(md, skriptFileNames(server))).toBe(repairFileRefs(md, skriptFileNames(client)))
      expect(repairFileRefs(md, skriptFileNames(server))).toBe('![](Bild%201%29.png)')
    })
  })
})

describe('references compare the way rendering compares', () => {
  const stored = [{ name: 'Shot 11.27\u202fAM.png' }, { name: 'Mu\u0308ller.png' }, { name: 'other.png' }]

  it.each([
    ['plain space for U+202F', '![](Shot 11.27 AM.png)', 'Shot 11.27\u202fAM.png'],
    ['encoded space for U+202F', '![](Shot%2011.27%20AM.png)', 'Shot 11.27\u202fAM.png'],
    ['NFC for NFD', '![](Müller.png)', 'Mu\u0308ller.png'],
  ])('%s', (_, md, expected) => {
    expect(matchByRefs(stored, extractReferencedFilenames(md), (f) => f.name).map((f) => f.name)).toEqual([expected])
  })
})

describe('server and client agree', () => {
  it.each([
    'photo.PNG', 'Scan.JPG', 'Bericht.PDF', 'Bildschirmfoto 2026-03-20 um 11.27.29.png', 'Müller.Png',
  ])('%s', async (name) => {
    fileFindMany.mockResolvedValue([{ id: 'f1', name, hash: 'abc', width: null, height: null }])
    videoFindMany.mockResolvedValue([])

    const server = await fetchSkriptFiles('s1')
    // /api/upload's listing builds the client URL with getFileExtension, and
    // saveFile stores the object under the same lowercased key.
    const key = getS3Key('abc', getFileExtension(name)!)
    const client = createSkriptFiles([{ id: 'f1', name, url: `https://cdn.example/${key}` }])

    const ref = encodeFileRef(name)
    expect(resolveFile(server, ref)?.url).toBe(resolveFile(client, ref)?.url)
    expect(resolveFile(server, ref)?.url).toBe(`https://cdn.example/${key}`)
  })
})

describe('sanitizeFilename', () => {
  it('stores macOS names as NFC with plain spaces', () => {
    expect(sanitizeFilename('Müller AM x.png')).toBe('Müller AM x.png')
  })

  it('is idempotent', () => {
    for (const [, stem] of STEMS) {
      const once = sanitizeFilename(`${stem}.png`)
      expect(sanitizeFilename(once)).toBe(once)
    }
  })
})
