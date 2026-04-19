import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import { rehypeHeadingSectionIds } from '@/lib/rehype-plugins/heading-section-ids'
import { rehypeImageWrapper } from '@/lib/rehype-plugins/image-wrapper'
import { rehypeInteractiveElements } from '@/lib/rehype-plugins/interactive-elements'
import { rehypeAllowPluginAttrs } from '@/lib/rehype-plugins/plugin-attrs'
import { sanitizeSchema } from '@/lib/markdown-compiler'

describe('Rehype Plugins', () => {
  describe('rehypeHeadingSectionIds', () => {
    it('should add data-section-id to h1 headings', async () => {
      const markdown = '# Main Heading'

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeSlug) // Adds id attribute to headings
        .use(rehypeHeadingSectionIds)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      const h1 = findNode(hast, (node: any) => node.tagName === 'h1')

      expect(h1?.properties?.['data-section-id']).toBe('h1-main-heading')
    })

    it('should add data-section-id to h2 headings', async () => {
      const markdown = '## Sub Heading'

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeSlug)
        .use(rehypeHeadingSectionIds)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      const h2 = findNode(hast, (node: any) => node.tagName === 'h2')

      expect(h2?.properties?.['data-section-id']).toBe('h2-sub-heading')
    })

    it('should add data-heading-text attribute', async () => {
      const markdown = '# Test Heading'

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeSlug)
        .use(rehypeHeadingSectionIds)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      const h1 = findNode(hast, (node: any) => node.tagName === 'h1')

      expect(h1?.properties?.['data-heading-text']).toBe('Test Heading')
    })

    it('should not modify h3 headings', async () => {
      const markdown = '### Level 3 Heading'

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeSlug)
        .use(rehypeHeadingSectionIds)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      const h3 = findNode(hast, (node: any) => node.tagName === 'h3')

      expect(h3?.properties?.['data-section-id']).toBeUndefined()
      expect(h3?.properties?.['data-heading-text']).toBeUndefined()
    })

    it('should skip headings without id', async () => {
      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        // Intentionally NOT using rehypeSlug
        .use(rehypeHeadingSectionIds)

      const tree: any = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'h1',
            properties: {}, // No id property
            children: [{ type: 'text', value: 'Test' }]
          }
        ]
      }

      const result = await processor.run(tree)
      const h1 = findNode(result, (node: any) => node.tagName === 'h1')

      expect(h1?.properties?.['data-section-id']).toBeUndefined()
    })

    it('should extract text from nested elements', async () => {
      const markdown = '# Test **Bold** Text'

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeSlug)
        .use(rehypeHeadingSectionIds)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      const h1 = findNode(hast, (node: any) => node.tagName === 'h1')

      expect(h1?.properties?.['data-heading-text']).toBe('Test Bold Text')
    })

    it('should handle multiple headings', async () => {
      const markdown = `
# Heading 1
## Heading 2
# Another H1
## Another H2
`

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeSlug)
        .use(rehypeHeadingSectionIds)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      const h1s = findAllNodes(hast, (node: any) => node.tagName === 'h1')
      const h2s = findAllNodes(hast, (node: any) => node.tagName === 'h2')

      expect(h1s).toHaveLength(2)
      expect(h2s).toHaveLength(2)

      h1s.forEach(h1 => {
        expect(h1.properties?.['data-section-id']).toMatch(/^h1-/)
        expect(h1.properties?.['data-heading-text']).toBeTruthy()
      })

      h2s.forEach(h2 => {
        expect(h2.properties?.['data-section-id']).toMatch(/^h2-/)
        expect(h2.properties?.['data-heading-text']).toBeTruthy()
      })
    })

  })

  describe('rehypeImageWrapper', () => {
    it('should wrap image in figure element', async () => {
      const markdown = '![test image](image.jpg)'

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeImageWrapper)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      const figure = findNode(hast, (node: any) => node.tagName === 'figure')

      expect(figure).toBeDefined()
      expect(figure?.children).toBeDefined()
      expect(figure?.children?.some((child: any) => child.tagName === 'img')).toBe(true)
    })

    it('should add figcaption when alt text exists', async () => {
      const markdown = '![test caption](image.jpg)'

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeImageWrapper)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      const figure = findNode(hast, (node: any) => node.tagName === 'figure')
      const figcaption = findNode(figure, (node: any) => node.tagName === 'figcaption')

      expect(figcaption).toBeDefined()
      const textNode = figcaption?.children?.[0]
      expect(textNode?.value).toBe('test caption')
    })

    it('should not add figcaption when alt text is empty', async () => {
      const markdown = '![](image.jpg)'

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeImageWrapper)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      const figure = findNode(hast, (node: any) => node.tagName === 'figure')
      const figcaption = findNode(figure, (node: any) => node.tagName === 'figcaption')

      expect(figcaption).toBeUndefined()
    })

    it('should apply alignment classes for center (default)', async () => {
      const markdown = '![test](image.jpg)'

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeImageWrapper)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      const figure = findNode(hast, (node: any) => node.tagName === 'figure')

      expect(figure?.properties?.className).toContain('mx-auto')
    })

    it('should skip excalidraw images', async () => {
      const markdown = '![test](diagram.excalidraw)'

      // Custom rehype plugin to add excalidraw data attribute
      const addExcalidrawData = () => {
        return (tree: any) => {
          const img = findNode(tree, (node: any) => node.tagName === 'img')
          if (img) {
            img.properties = img.properties || {}
            img.properties['data-excalidraw'] = 'diagram.excalidraw'
          }
        }
      }

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(addExcalidrawData)
        .use(rehypeImageWrapper)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      // Image should NOT be wrapped in figure
      const figure = findNode(hast, (node: any) => node.tagName === 'figure')
      const img = findNode(hast, (node: any) => node.tagName === 'img')

      expect(figure).toBeUndefined()
      expect(img).toBeDefined()
    })
  })

  describe('rehypeInteractiveElements', () => {
    it('should add data-interactive to code blocks', async () => {
      const markdown = '```javascript\nconsole.log("test")\n```'

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeInteractiveElements)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      const pre = findNode(hast, (node: any) => node.tagName === 'pre')

      expect(pre?.properties?.['data-interactive']).toBe('code-block')
      expect(pre?.properties?.['data-lang']).toBe('javascript')
      expect(pre?.properties?.['data-block-id']).toContain('code-block-')
    })

    it('should increment code block IDs', async () => {
      const markdown = `\`\`\`python
print("first")
\`\`\`

\`\`\`javascript
console.log("second")
\`\`\``

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeInteractiveElements)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      const pres = findAllNodes(hast, (node: any) => node.tagName === 'pre')

      expect(pres).toHaveLength(2)
      expect(pres[0]?.properties?.['data-block-id']).toBe('code-block-0')
      expect(pres[1]?.properties?.['data-block-id']).toBe('code-block-1')
    })

    it('should add data-interactive to images', async () => {
      const markdown = '![test](image.jpg)'

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeInteractiveElements)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      const img = findNode(hast, (node: any) => node.tagName === 'img')

      expect(img?.properties?.['data-interactive']).toBe('image')
      expect(img?.properties?.['data-image-id']).toContain('image-')
      expect(img?.properties?.['data-image-src']).toBeDefined()
    })

    it('should increment image IDs', async () => {
      const markdown = `![first](image1.jpg)

![second](image2.jpg)`

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeInteractiveElements)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      const images = findAllNodes(hast, (node: any) => node.tagName === 'img')

      expect(images).toHaveLength(2)
      expect(images[0]?.properties?.['data-image-id']).toBe('image-0')
      expect(images[1]?.properties?.['data-image-id']).toBe('image-1')
    })

    it('should handle code blocks without language', async () => {
      const markdown = '```\nplain text\n```'

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeInteractiveElements)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      const pre = findNode(hast, (node: any) => node.tagName === 'pre')

      expect(pre?.properties?.['data-lang']).toBe('text')
    })

    it('should store image src in data attribute', async () => {
      const markdown = '![test](path/to/image.jpg)'

      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeInteractiveElements)

      const tree = processor.parse(markdown)
      const hast = await processor.run(tree)

      const img = findNode(hast, (node: any) => node.tagName === 'img')

      expect(img?.properties?.['data-image-src']).toBe('path/to/image.jpg')
    })
  })

  describe('rehypeAllowPluginAttrs (dynamic <plugin> allowlist)', () => {
    // Build a pipeline matching compileMarkdown's: parse markdown, run
    // rehype-raw on inline HTML, dynamically extend the sanitize schema with
    // any <plugin> attrs found, then sanitize. The interesting question is
    // whether arbitrary plugin config attrs (like `font`, `mod`) survive
    // sanitization without being hand-listed.
    function runPluginPipeline(markdown: string) {
      // Clone per call — the plugin mutates the schema.
      const schema = structuredClone(sanitizeSchema)
      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw)
        .use(rehypeAllowPluginAttrs, schema)
        .use(rehypeSanitize, schema)

      const tree = processor.parse(markdown)
      return processor.run(tree)
    }

    it('preserves arbitrary plugin config attrs that aren\'t in the sanitize allowlist', async () => {
      const hast = await runPluginPipeline(
        '<plugin src="acme/clock" font="12" mod="7" lang="de"></plugin>',
      )
      const plugin = findNode(hast, (n: any) => n.tagName === 'plugin')
      expect(plugin?.properties?.font).toBe('12')
      expect(plugin?.properties?.mod).toBe('7')
      expect(plugin?.properties?.lang).toBe('de')
    })

    it('keeps intrinsic attrs (src, height, width) as real attributes and lets sanitize handle id', async () => {
      const hast = await runPluginPipeline(
        '<plugin src="acme/x" id="foo" height="200" width="400" custom="yes"></plugin>',
      )
      const plugin = findNode(hast, (n: any) => n.tagName === 'plugin')
      expect(plugin?.properties?.src).toBe('acme/x')
      // height/width get number-coerced by HAST since they're known HTML attrs;
      // PluginContainer parses them via parseInt either way.
      expect(plugin?.properties?.height).toBe(200)
      expect(plugin?.properties?.width).toBe(400)
      expect(plugin?.properties?.custom).toBe('yes')
      // rehype-sanitize prefixes `id` with `user-content-` to prevent
      // clobber attacks. We don't fight that — the PluginContainer reads
      // `id` as an opaque string and uses it for UserData persistence.
      expect(plugin?.properties?.id).toMatch(/foo$/)
    })

    it('allows distinct attrs across multiple plugins in the same document', async () => {
      const hast = await runPluginPipeline(
        '<plugin src="a/x" foo="1"></plugin>\n\n<plugin src="b/y" bar="2"></plugin>',
      )
      const plugins: any[] = []
      function collect(node: any) {
        if (node?.tagName === 'plugin') plugins.push(node)
        node?.children?.forEach(collect)
      }
      collect(hast)
      expect(plugins).toHaveLength(2)
      expect(plugins[0].properties?.foo).toBe('1')
      expect(plugins[1].properties?.bar).toBe('2')
    })

    it('does not leak allowed attrs across separate compile calls (schema clone)', async () => {
      // First call sees `font`. Second call only declares `glyph`. If the
      // schema were shared, the second call's tree would still allow `font`
      // — but the visible regression we'd care about is the *opposite*: the
      // second call should still allow its OWN attr (`glyph`) without being
      // limited to whatever the first call set up.
      const first = await runPluginPipeline('<plugin src="a/x" font="12"></plugin>')
      const second = await runPluginPipeline('<plugin src="a/x" glyph="@"></plugin>')
      expect(findNode(first, (n: any) => n.tagName === 'plugin')?.properties?.font).toBe('12')
      expect(findNode(second, (n: any) => n.tagName === 'plugin')?.properties?.glyph).toBe('@')
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
