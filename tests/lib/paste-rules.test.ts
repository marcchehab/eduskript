import { describe, it, expect } from 'vitest'
import { classifyPaste, type PasteSource } from '@/lib/paste-rules'

function source(text: string, opts?: { items?: DataTransferItemList | null; files?: FileList | null }): PasteSource {
  return {
    getData: (format: string) => (format === 'text/plain' ? text : ''),
    items: opts?.items ?? null,
    files: opts?.files ?? null,
  }
}

function fileSource(file: File): PasteSource {
  // Build a fake DataTransferItemList carrying one image file
  const items = [
    {
      kind: 'file' as const,
      type: file.type,
      getAsFile: () => file,
      getAsString: () => undefined,
    },
  ] as unknown as DataTransferItemList
  return {
    getData: () => '',
    items,
    files: null,
  }
}

describe('classifyPaste', () => {
  describe('YouTube URLs', () => {
    it('classifies youtube.com/watch as direct insert', () => {
      const intent = classifyPaste(source('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      expect(intent).toEqual({ kind: 'insert', text: '![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)' })
    })

    it('classifies youtu.be short URLs', () => {
      const intent = classifyPaste(source('https://youtu.be/dQw4w9WgXcQ'))
      expect(intent?.kind).toBe('insert')
    })

    it('preserves t= start time in the inserted URL', () => {
      const url = 'https://youtu.be/dQw4w9WgXcQ?t=120'
      const intent = classifyPaste(source(url))
      expect(intent).toEqual({ kind: 'insert', text: `![](${url})` })
    })

    it('classifies playlist-only URLs', () => {
      const url = 'https://www.youtube.com/playlist?list=PLxyz'
      const intent = classifyPaste(source(url))
      expect(intent).toEqual({ kind: 'insert', text: `![](${url})` })
    })

    it('classifies shorts URLs', () => {
      const intent = classifyPaste(source('https://www.youtube.com/shorts/abc123'))
      expect(intent?.kind).toBe('insert')
    })

    it('strips surrounding whitespace before classifying', () => {
      const intent = classifyPaste(source('   https://youtu.be/dQw4w9WgXcQ\n'))
      expect(intent?.kind).toBe('insert')
    })
  })

  describe('Image URLs', () => {
    it('opens a menu with embed + link options', () => {
      const intent = classifyPaste(source('https://example.com/foo.png'))
      expect(intent?.kind).toBe('menu')
      if (intent?.kind !== 'menu') throw new Error('expected menu')
      expect(intent.options).toHaveLength(2)
      expect(intent.options[0]).toMatchObject({ label: 'Embed image', insert: '![](https://example.com/foo.png)' })
      expect(intent.options[1]).toMatchObject({ label: 'Insert link', insert: '[foo.png](https://example.com/foo.png)' })
    })

    it('matches all common image extensions', () => {
      for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif']) {
        const intent = classifyPaste(source(`https://example.com/x.${ext}`))
        expect(intent?.kind, `extension ${ext}`).toBe('menu')
      }
    })

    it('matches image URLs with query strings', () => {
      const intent = classifyPaste(source('https://example.com/foo.png?v=1'))
      expect(intent?.kind).toBe('menu')
    })

    it('is case-insensitive on the extension', () => {
      const intent = classifyPaste(source('https://example.com/FOO.PNG'))
      expect(intent?.kind).toBe('menu')
    })

    it('does not match non-image URLs', () => {
      expect(classifyPaste(source('https://example.com/about'))).toBeNull()
      expect(classifyPaste(source('https://example.com/foo.txt'))).toBeNull()
    })
  })

  describe('Image blobs', () => {
    it('returns upload-image when an image File is in items', () => {
      const file = new File([new Uint8Array([1, 2, 3])], 'paste.png', { type: 'image/png' })
      const intent = classifyPaste(fileSource(file))
      expect(intent).toEqual({ kind: 'upload-image', file })
    })

    it('prefers image-blob over text when both are present', () => {
      const file = new File([new Uint8Array([1])], 'paste.png', { type: 'image/png' })
      const items = [
        { kind: 'file' as const, type: 'image/png', getAsFile: () => file, getAsString: () => undefined },
      ] as unknown as DataTransferItemList
      const intent = classifyPaste({
        getData: (f: string) => (f === 'text/plain' ? 'https://www.youtube.com/watch?v=abc' : ''),
        items,
      })
      expect(intent?.kind).toBe('upload-image')
    })

    it('ignores non-image files', () => {
      const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
      const items = [
        { kind: 'file' as const, type: 'text/plain', getAsFile: () => file, getAsString: () => undefined },
      ] as unknown as DataTransferItemList
      const intent = classifyPaste({ getData: () => '', items })
      expect(intent).toBeNull()
    })
  })

  describe('Plain text fallthrough', () => {
    it('returns null for empty paste', () => {
      expect(classifyPaste(source(''))).toBeNull()
    })

    it('returns null for plain text', () => {
      expect(classifyPaste(source('hello world'))).toBeNull()
    })

    it('returns null for non-image, non-YouTube URLs', () => {
      expect(classifyPaste(source('https://example.com/'))).toBeNull()
    })

    it('returns null for malformed URLs', () => {
      expect(classifyPaste(source('not://a real url'))).toBeNull()
    })
  })
})
