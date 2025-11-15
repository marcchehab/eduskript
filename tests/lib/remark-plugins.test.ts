import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkCodeEditor from '@/lib/remark-plugins/code-editor'
import { remarkImageAttributes } from '@/lib/remark-plugins/image-attributes'
import { remarkFileResolver } from '@/lib/remark-plugins/file-resolver'

describe('Remark Plugins', () => {
  describe('remarkCodeEditor', () => {
    it('should convert code block with editor meta to code-editor element', async () => {
      const markdown = '```python editor\nprint("Hello")\n```'

      const processor = unified()
        .use(remarkParse)
        .use(remarkCodeEditor)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      // Find the code-editor node
      const codeEditorNode = findNode(tree, (node: any) => node.type === 'code-editor')

      expect(codeEditorNode).toBeDefined()
      expect(codeEditorNode?.data?.hName).toBe('code-editor')
      expect(codeEditorNode?.data?.hProperties?.dataLanguage).toBe('python')
      expect(codeEditorNode?.data?.hProperties?.dataCode).toContain('print')
    })

    it('should escape HTML in code content', async () => {
      const markdown = '```javascript editor\nconst html = "<script>alert(1)</script>"\n```'

      const processor = unified()
        .use(remarkParse)
        .use(remarkCodeEditor)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const codeEditorNode = findNode(tree, (node: any) => node.type === 'code-editor')

      expect(codeEditorNode?.data?.hProperties?.dataCode).toContain('&lt;script&gt;')
      expect(codeEditorNode?.data?.hProperties?.dataCode).not.toContain('<script>')
    })

    it('should parse additional attributes from meta', async () => {
      const markdown = '```python editor id=my-editor height=400\nprint("test")\n```'

      const processor = unified()
        .use(remarkParse)
        .use(remarkCodeEditor)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const codeEditorNode = findNode(tree, (node: any) => node.type === 'code-editor')

      expect(codeEditorNode?.data?.hProperties?.dataId).toBe('my-editor')
      expect(codeEditorNode?.data?.hProperties?.dataHeight).toBe('400')
    })

    it('should use language from code block', () => {
      // Test that the plugin uses the specified language
      const markdown = '```javascript editor\nconsole.log("test")\n```'

      const processor = unified()
        .use(remarkParse)
        .use(remarkCodeEditor)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const codeEditorNode = findNode(tree, (node: any) => node.type === 'code-editor')

      expect(codeEditorNode?.data?.hProperties?.dataLanguage).toBe('javascript')
    })

    it('should not modify code blocks without editor meta', async () => {
      const markdown = '```python\nprint("Hello")\n```'

      const processor = unified()
        .use(remarkParse)
        .use(remarkCodeEditor)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      // Should still be a code node
      const codeNode = findNode(tree, (node: any) => node.type === 'code')
      const codeEditorNode = findNode(tree, (node: any) => node.type === 'code-editor')

      expect(codeNode).toBeDefined()
      expect(codeEditorNode).toBeUndefined()
    })

    it('should handle empty code blocks', async () => {
      const markdown = '```python editor\n\n```'

      const processor = unified()
        .use(remarkParse)
        .use(remarkCodeEditor)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const codeEditorNode = findNode(tree, (node: any) => node.type === 'code-editor')

      expect(codeEditorNode).toBeDefined()
      expect(codeEditorNode?.data?.hProperties?.dataCode).toBe('')
    })

    it('should handle multiple code editors in same document', async () => {
      const markdown = `
\`\`\`python editor
print("first")
\`\`\`

Some text

\`\`\`javascript editor
console.log("second")
\`\`\`
`

      const processor = unified()
        .use(remarkParse)
        .use(remarkCodeEditor)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const codeEditorNodes = findAllNodes(tree, (node: any) => node.type === 'code-editor')

      expect(codeEditorNodes).toHaveLength(2)
      expect(codeEditorNodes[0]?.data?.hProperties?.dataLanguage).toBe('python')
      expect(codeEditorNodes[1]?.data?.hProperties?.dataLanguage).toBe('javascript')
    })

    it('should remove quotes from attribute values', () => {
      // Note: Current implementation splits by space, so quoted values with spaces don't work correctly
      // Using single-word value to test quote removal
      const markdown = '```python editor id="my-editor" title="TestEditor"\nprint("test")\n```'

      const processor = unified()
        .use(remarkParse)
        .use(remarkCodeEditor)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const codeEditorNode = findNode(tree, (node: any) => node.type === 'code-editor')

      expect(codeEditorNode?.data?.hProperties?.dataId).toBe('my-editor')
      expect(codeEditorNode?.data?.hProperties?.dataTitle).toBe('TestEditor')
    })

    it('should escape all HTML special characters', async () => {
      const markdown = '```javascript editor\nconst test = "A & B < C > D \' E"\n```'

      const processor = unified()
        .use(remarkParse)
        .use(remarkCodeEditor)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const codeEditorNode = findNode(tree, (node: any) => node.type === 'code-editor')
      const code = codeEditorNode?.data?.hProperties?.dataCode

      expect(code).toContain('&amp;')
      expect(code).toContain('&lt;')
      expect(code).toContain('&gt;')
      expect(code).toContain('&quot;')
      expect(code).toContain('&#039;')
    })
  })

  describe('remarkImageAttributes', () => {
    it('should parse width attribute and apply as inline style', () => {
      const markdown = '![test](image.jpg){width=50%}'

      const processor = unified()
        .use(remarkParse)
        .use(remarkImageAttributes)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const img = findNode(tree, (node: any) => node.type === 'image')

      expect(img?.data?.hProperties?.style).toContain('width: 50%')
      expect(img?.data?.hProperties?.style).toContain('height: auto')
    })

    it('should parse align attribute', () => {
      const markdown = '![test](image.jpg){align=left}'

      const processor = unified()
        .use(remarkParse)
        .use(remarkImageAttributes)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const img = findNode(tree, (node: any) => node.type === 'image')

      expect(img?.data?.hProperties?.['data-align']).toBe('left')
    })

    it('should parse multiple attributes separated by semicolon', () => {
      const markdown = '![test](image.jpg){width=75%;align=center}'

      const processor = unified()
        .use(remarkParse)
        .use(remarkImageAttributes)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const img = findNode(tree, (node: any) => node.type === 'image')

      expect(img?.data?.hProperties?.style).toContain('width: 75%')
      expect(img?.data?.hProperties?.['data-align']).toBe('center')
    })

    it('should parse wrap attribute', () => {
      const markdown = '![test](image.jpg){wrap=true}'

      const processor = unified()
        .use(remarkParse)
        .use(remarkImageAttributes)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const img = findNode(tree, (node: any) => node.type === 'image')

      expect(img?.data?.hProperties?.['data-wrap']).toBe('true')
    })

    it('should remove attribute text from markdown after parsing', () => {
      const markdown = '![test](image.jpg){width=50%}'

      const processor = unified()
        .use(remarkParse)
        .use(remarkImageAttributes)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      // Find the paragraph node
      const paragraph = findNode(tree, (node: any) => node.type === 'paragraph')

      // Check if there's a text node with the attributes (should be removed or empty)
      const textNode = paragraph?.children?.find((child: any) => child.type === 'text')

      if (textNode) {
        expect(textNode.value).not.toContain('{width=50%}')
      }
    })

    it('should handle images without attributes', () => {
      const markdown = '![test](image.jpg)'

      const processor = unified()
        .use(remarkParse)
        .use(remarkImageAttributes)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const img = findNode(tree, (node: any) => node.type === 'image')

      expect(img?.data?.hProperties).toBeUndefined()
    })

    it('should support various width units', () => {
      const markdown = '![test](image.jpg){width=500px}'

      const processor = unified()
        .use(remarkParse)
        .use(remarkImageAttributes)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const img = findNode(tree, (node: any) => node.type === 'image')

      expect(img?.data?.hProperties?.style).toContain('width: 500px')
    })

    it('should handle all three attributes together', () => {
      const markdown = '![test](image.jpg){width=60%;align=right;wrap=true}'

      const processor = unified()
        .use(remarkParse)
        .use(remarkImageAttributes)

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const img = findNode(tree, (node: any) => node.type === 'image')

      expect(img?.data?.hProperties?.style).toContain('width: 60%')
      expect(img?.data?.hProperties?.['data-align']).toBe('right')
      expect(img?.data?.hProperties?.['data-wrap']).toBe('true')
    })
  })

  describe('remarkFileResolver', () => {
    it('should resolve file path from file list', () => {
      const markdown = '![test](myimage.jpg)'

      const fileList = [
        { id: 'file1', name: 'myimage.jpg', url: '/files/myimage.jpg' }
      ]

      const processor = unified()
        .use(remarkParse)
        .use(remarkFileResolver, { fileList })

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const img = findNode(tree, (node: any) => node.type === 'image')

      expect(img?.url).toBe('/files/myimage.jpg')
      expect(img?.data?.hProperties?.['data-original-src']).toBe('myimage.jpg')
    })

    it('should skip absolute URLs', () => {
      const markdown = '![test](https://example.com/image.jpg)'

      const processor = unified()
        .use(remarkParse)
        .use(remarkFileResolver, { fileList: [] })

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const img = findNode(tree, (node: any) => node.type === 'image')

      expect(img?.url).toBe('https://example.com/image.jpg')
    })

    it('should skip URLs starting with slash', () => {
      const markdown = '![test](/absolute/path.jpg)'

      const processor = unified()
        .use(remarkParse)
        .use(remarkFileResolver, { fileList: [] })

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const img = findNode(tree, (node: any) => node.type === 'image')

      expect(img?.url).toBe('/absolute/path.jpg')
    })

    it('should handle missing files with /missing-file/ path', () => {
      const markdown = '![test](notfound.jpg)'

      const processor = unified()
        .use(remarkParse)
        .use(remarkFileResolver, { fileList: [] })

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const img = findNode(tree, (node: any) => node.type === 'image')

      expect(img?.url).toBe('/missing-file/notfound.jpg')
    })

    it('should resolve file by basename when path differs', () => {
      const markdown = '![test](subdir/image.jpg)'

      const fileList = [
        { id: 'file1', name: 'image.jpg', url: '/files/image.jpg' }
      ]

      const processor = unified()
        .use(remarkParse)
        .use(remarkFileResolver, { fileList })

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const img = findNode(tree, (node: any) => node.type === 'image')

      expect(img?.url).toBe('/files/image.jpg')
    })

    it('should handle excalidraw files with light and dark variants', () => {
      const markdown = '![test](diagram.excalidraw)'

      const fileList = [
        { id: 'light1', name: 'diagram.excalidraw.light.svg', url: '/files/light.svg' },
        { id: 'dark1', name: 'diagram.excalidraw.dark.svg', url: '/files/dark.svg' }
      ]

      const processor = unified()
        .use(remarkParse)
        .use(remarkFileResolver, { fileList })

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const img = findNode(tree, (node: any) => node.type === 'image')

      expect(img?.url).toContain('/files/light.svg')
      expect(img?.data?.hProperties?.['data-excalidraw']).toBe('diagram.excalidraw')
      expect(img?.data?.hProperties?.['data-light-src']).toContain('/files/light.svg')
      expect(img?.data?.hProperties?.['data-dark-src']).toContain('/files/dark.svg')
    })

    it('should handle excalidraw files with missing variants', () => {
      const markdown = '![test](diagram.excalidraw)'

      const fileList = [
        { id: 'light1', name: 'diagram.excalidraw.light.svg', url: '/files/light.svg' }
        // Missing dark variant
      ]

      const processor = unified()
        .use(remarkParse)
        .use(remarkFileResolver, { fileList })

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const img = findNode(tree, (node: any) => node.type === 'image')

      expect(img?.url).toContain('/missing-file/diagram.excalidraw')
      expect(img?.url).toContain('missing=dark')
    })

    it('should use file id when url not provided', () => {
      const markdown = '![test](myfile.jpg)'

      const fileList = [
        { id: 'abc123', name: 'myfile.jpg' } // No url property
      ]

      const processor = unified()
        .use(remarkParse)
        .use(remarkFileResolver, { fileList })

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const img = findNode(tree, (node: any) => node.type === 'image')

      expect(img?.url).toBe('/api/files/abc123')
    })

    it('should skip directories in file list', () => {
      const markdown = '![test](folder)'

      const fileList = [
        { id: 'dir1', name: 'folder', isDirectory: true }
      ]

      const processor = unified()
        .use(remarkParse)
        .use(remarkFileResolver, { fileList })

      const tree = processor.parse(markdown)
      processor.runSync(tree)

      const img = findNode(tree, (node: any) => node.type === 'image')

      expect(img?.url).toBe('/missing-file/folder')
    })
  })
})

/**
 * Helper function to find a node in the AST
 */
function findNode(tree: any, predicate: (node: any) => boolean): any {
  let found: any = undefined

  function visit(node: any) {
    if (predicate(node)) {
      found = node
      return
    }
    if (node.children) {
      for (const child of node.children) {
        visit(child)
        if (found) return
      }
    }
  }

  visit(tree)
  return found
}

/**
 * Helper function to find all nodes matching predicate
 */
function findAllNodes(tree: any, predicate: (node: any) => boolean): any[] {
  const found: any[] = []

  function visit(node: any) {
    if (predicate(node)) {
      found.push(node)
    }
    if (node.children) {
      for (const child of node.children) {
        visit(child)
      }
    }
  }

  visit(tree)
  return found
}
