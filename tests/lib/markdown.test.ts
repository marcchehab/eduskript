import { describe, it, expect, vi } from 'vitest'
import { processMarkdown, generateExcerpt, generateSlug, validateMarkdown } from '@/lib/markdown'

describe('Markdown Processing', () => {
  describe('processMarkdown', () => {
    it('should process basic markdown to HTML', async () => {
      const markdown = '# Hello World\n\nThis is **bold** text.'

      const result = await processMarkdown(markdown)

      expect(result.content).toContain('<h1')
      expect(result.content).toContain('Hello World')
      expect(result.content).toContain('<strong>bold</strong>')
      expect(result.frontmatter).toEqual({})
    })

    it('should parse frontmatter', async () => {
      const markdown = `---
title: Test Post
author: John Doe
tags: [test, markdown]
---

# Content here`

      const result = await processMarkdown(markdown)

      expect(result.frontmatter).toEqual({
        title: 'Test Post',
        author: 'John Doe',
        tags: ['test', 'markdown']
      })
      expect(result.content).toContain('Content here')
      expect(result.content).not.toContain('title: Test Post')
    })

    it('should generate excerpt from content', async () => {
      const markdown = 'This is a test markdown content that should be excerpted.'

      const result = await processMarkdown(markdown)

      expect(result.excerpt).toBeDefined()
      expect(result.excerpt).toContain('This is a test')
    })

    it('should process markdown math', async () => {
      const markdown = 'Inline math: $x^2$ and block math:\n\n$$\ny = mx + b\n$$'

      const result = await processMarkdown(markdown)

      expect(result.content).toContain('math')
    })

    it('should process GFM tables', async () => {
      const markdown = `| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |`

      const result = await processMarkdown(markdown)

      expect(result.content).toContain('<table')
      expect(result.content).toContain('<th')
      expect(result.content).toContain('Header 1')
    })

    it('should add IDs to headings (rehypeSlug)', async () => {
      const markdown = '# Test Heading\n\n## Another Heading'

      const result = await processMarkdown(markdown)

      expect(result.content).toContain('id="test-heading"')
      expect(result.content).toContain('id="another-heading"')
    })

    it('should add autolink to headings', async () => {
      const markdown = '# Test Heading'

      const result = await processMarkdown(markdown)

      expect(result.content).toContain('heading-link')
    })

    it('should process code blocks with syntax highlighting', async () => {
      const markdown = '```javascript\nconst x = 1;\n```'

      const result = await processMarkdown(markdown)

      expect(result.content).toContain('<pre')
      expect(result.content).toContain('<code')
    })

    it('should handle empty content with frontmatter only', async () => {
      const markdown = `---
title: Empty Post
---`

      const result = await processMarkdown(markdown)

      expect(result.frontmatter).toEqual({ title: 'Empty Post' })
      expect(result.content).toBeDefined()
    })

    it('should process markdown with context (fileList)', async () => {
      const markdown = '![test](image.jpg)'
      const context = {
        fileList: [
          { id: 'file1', name: 'image.jpg', url: '/files/image.jpg' }
        ]
      }

      const result = await processMarkdown(markdown, context)

      expect(result.content).toContain('/files/image.jpg')
    })

    it('should handle markdown with image attributes', async () => {
      const markdown = '![test](image.jpg){width=50%}'

      const result = await processMarkdown(markdown)

      expect(result.content).toContain('width')
    })

    it('should process code editor blocks', async () => {
      const markdown = '```python editor\nprint("hello")\n```'

      const result = await processMarkdown(markdown)

      expect(result.content).toContain('code-editor')
    })

    it('should handle context with domain and skriptId', async () => {
      const markdown = '# Test'
      const context = {
        domain: 'testuser',
        skriptId: 'test123'
      }

      const result = await processMarkdown(markdown, context)

      expect(result.content).toBeTruthy()
    })
  })

  describe('generateExcerpt', () => {
    it('should generate excerpt from plain text', () => {
      const content = 'This is a simple test content.'

      const excerpt = generateExcerpt(content)

      expect(excerpt).toBe('This is a simple test content.')
    })

    it('should remove markdown headers', () => {
      const content = '# Main Title\n\nSome content here.'

      const excerpt = generateExcerpt(content)

      expect(excerpt).not.toContain('#')
      expect(excerpt).toContain('Main Title')
      expect(excerpt).toContain('Some content')
    })

    it('should remove bold syntax', () => {
      const content = 'This is **bold text** in content.'

      const excerpt = generateExcerpt(content)

      expect(excerpt).not.toContain('**')
      expect(excerpt).toContain('bold text')
    })

    it('should remove italic syntax', () => {
      const content = 'This is *italic text* in content.'

      const excerpt = generateExcerpt(content)

      expect(excerpt).not.toContain('*')
      expect(excerpt).toContain('italic text')
    })

    it('should remove inline code syntax', () => {
      const content = 'Use the `console.log()` function.'

      const excerpt = generateExcerpt(content)

      expect(excerpt).not.toContain('`')
      expect(excerpt).toContain('console.log()')
    })

    it('should remove link syntax but keep text', () => {
      const content = 'Check out [this link](https://example.com) for more.'

      const excerpt = generateExcerpt(content)

      expect(excerpt).not.toContain('[')
      expect(excerpt).not.toContain('](')
      expect(excerpt).toContain('this link')
      expect(excerpt).not.toContain('https://example.com')
    })

    it('should remove image syntax completely', () => {
      const content = 'Here is an image: ![alt text](image.jpg) in the content.'

      const excerpt = generateExcerpt(content)

      expect(excerpt).not.toContain('![')
      expect(excerpt).not.toContain('image.jpg')
      expect(excerpt).toContain('Here is an image:')
      expect(excerpt).toContain('in the content.')
    })

    it('should replace newlines with spaces', () => {
      const content = 'Line one\nLine two\nLine three'

      const excerpt = generateExcerpt(content)

      expect(excerpt).not.toContain('\n')
      expect(excerpt).toBe('Line one Line two Line three')
    })

    it('should truncate to maxLength', () => {
      const content = 'A'.repeat(200)

      const excerpt = generateExcerpt(content, 100)

      expect(excerpt.length).toBeLessThanOrEqual(104) // 100 + '...'
      expect(excerpt).toContain('...')
    })

    it('should truncate at last space before maxLength', () => {
      const content = 'word1 word2 word3 word4 word5 word6 word7 word8'

      const excerpt = generateExcerpt(content, 20)

      expect(excerpt).toContain('...')
      expect(excerpt).not.toContain('word8')
      // Should end at a space, not mid-word
      expect(excerpt.substring(0, excerpt.length - 3).trim()).not.toMatch(/\w{10,}/)
    })

    it('should return full text if shorter than maxLength', () => {
      const content = 'Short text'

      const excerpt = generateExcerpt(content, 100)

      expect(excerpt).toBe('Short text')
      expect(excerpt).not.toContain('...')
    })

    it('should use default maxLength of 160', () => {
      const content = 'A'.repeat(200)

      const excerpt = generateExcerpt(content)

      expect(excerpt.length).toBeLessThanOrEqual(164) // 160 + '...'
    })

    it('should handle multiple markdown elements', () => {
      const content = '# Title\n\nThis is **bold** and *italic* with `code` and [link](url) and ![img](pic.jpg)'

      const excerpt = generateExcerpt(content)

      expect(excerpt).not.toContain('#')
      expect(excerpt).not.toContain('**')
      expect(excerpt).not.toContain('`')
      expect(excerpt).not.toContain('[')
      expect(excerpt).toContain('Title')
      expect(excerpt).toContain('bold')
      expect(excerpt).toContain('italic')
      expect(excerpt).toContain('code')
      expect(excerpt).toContain('link')
      // Note: The regex removes ![...], but a single ! before img might remain
    })
  })

  describe('generateSlug', () => {
    it('should convert to lowercase', () => {
      const slug = generateSlug('Hello World')

      expect(slug).toBe('hello-world')
    })

    it('should replace spaces with hyphens', () => {
      const slug = generateSlug('This is a title')

      expect(slug).toBe('this-is-a-title')
    })

    it('should remove special characters', () => {
      const slug = generateSlug('Title with @#$% special!')

      expect(slug).toBe('title-with-special')
    })

    it('should replace multiple spaces with single hyphen', () => {
      const slug = generateSlug('Title    with    spaces')

      expect(slug).toBe('title-with-spaces')
    })

    it('should replace multiple hyphens with single hyphen', () => {
      const slug = generateSlug('Title---with---hyphens')

      expect(slug).toBe('title-with-hyphens')
    })

    it('should convert leading/trailing spaces to hyphens', () => {
      const slug = generateSlug('  Title with spaces  ')

      // Leading/trailing spaces become hyphens, trim() only removes whitespace
      expect(slug).toBe('-title-with-spaces-')
    })

    it('should handle already hyphenated text', () => {
      const slug = generateSlug('already-hyphenated-title')

      expect(slug).toBe('already-hyphenated-title')
    })

    it('should handle numbers', () => {
      const slug = generateSlug('Title 123 with numbers')

      expect(slug).toBe('title-123-with-numbers')
    })

    it('should handle underscores', () => {
      const slug = generateSlug('title_with_underscores')

      expect(slug).toBe('title_with_underscores')
    })
  })

  describe('validateMarkdown', () => {
    it('should return empty array for valid markdown', () => {
      const errors = validateMarkdown('# Title\n\nThis is **bold** and *italic* text.')

      expect(errors).toEqual([])
    })

    it('should detect empty content', () => {
      const errors = validateMarkdown('')

      expect(errors).toContain('Content cannot be empty')
    })

    it('should detect whitespace-only content', () => {
      const errors = validateMarkdown('   \n  \n   ')

      expect(errors).toContain('Content cannot be empty')
    })

    it('should detect unbalanced bold syntax', () => {
      const errors = validateMarkdown('This is **bold but not closed')

      expect(errors).toContain('Unbalanced bold syntax (**)')
    })

    it('should accept balanced bold syntax', () => {
      const errors = validateMarkdown('This is **bold** text')

      expect(errors).not.toContain('Unbalanced bold syntax (**)')
    })

    it('should detect unbalanced italic syntax', () => {
      const errors = validateMarkdown('This is *italic but not closed')

      expect(errors).toContain('Unbalanced italic syntax (*)')
    })

    it('should accept balanced italic syntax', () => {
      const errors = validateMarkdown('This is *italic* text')

      expect(errors).not.toContain('Unbalanced italic syntax (*)')
    })

    it('should not confuse bold with italic', () => {
      const errors = validateMarkdown('This is **bold** not *italic*')

      expect(errors).toEqual([])
    })

    it('should detect unbalanced inline code syntax', () => {
      const errors = validateMarkdown('Use the `code function')

      expect(errors).toContain('Unbalanced inline code syntax (`)')
    })

    it('should accept balanced inline code syntax', () => {
      const errors = validateMarkdown('Use the `code` function')

      expect(errors).not.toContain('Unbalanced inline code syntax (`)')
    })

    it('should detect multiple errors', () => {
      const errors = validateMarkdown('**bold `code *italic')

      expect(errors.length).toBeGreaterThan(1)
    })

    it('should handle code blocks (triple backticks) correctly', () => {
      const errors = validateMarkdown('```\ncode block\n```')

      // Code blocks use 6 backticks total, which is balanced
      expect(errors).not.toContain('Unbalanced inline code syntax (`)')
    })
  })
})
