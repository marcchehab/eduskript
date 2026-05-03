import { describe, it, expect } from 'vitest'
import { generateExcerpt, generateSlug, validateMarkdown } from '@/lib/markdown'

describe('Markdown Processing', () => {
  // Note: processMarkdown was removed in the unified MDX pipeline refactor
  // MDX compilation is now handled by compileMDX in mdx-compiler.ts
  // See tests/lib/mdx-compiler.test.ts for MDX compilation tests

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

      expect(excerpt.length).toBeLessThanOrEqual(101) // 100 + '…'
      expect(excerpt).toContain('…')
    })

    it('should truncate at last space before maxLength', () => {
      const content = 'word1 word2 word3 word4 word5 word6 word7 word8'

      const excerpt = generateExcerpt(content, 20)

      expect(excerpt).toContain('…')
      expect(excerpt).not.toContain('word8')
      // Should end at a space, not mid-word
      expect(excerpt.substring(0, excerpt.length - 1).trim()).not.toMatch(/\w{10,}/)
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

      expect(excerpt.length).toBeLessThanOrEqual(161) // 160 + '…'
    })

    // The Eduskript-specific syntax that broke og:descriptions in production.
    it('should strip Eduskript callout syntax', () => {
      const content = '> [!success] Lernziele\n> \n> - Sie können im Binärsystem zählen.\n> - Sie können Dezimalzahlen umwandeln.'

      const excerpt = generateExcerpt(content)

      expect(excerpt).not.toContain('>')
      expect(excerpt).not.toContain('[!success]')
      expect(excerpt).not.toContain('Lernziele') // callout title is meta, not content
      expect(excerpt).toContain('Sie können im Binärsystem zählen.')
    })

    it('should strip collapsible callout markers', () => {
      const content = '> [!note]- Folded content\n> Body text here'

      const excerpt = generateExcerpt(content)

      expect(excerpt).not.toContain('[!note]')
      expect(excerpt).not.toContain('Folded content')
      expect(excerpt).toContain('Body text here')
    })

    it('should strip fenced code blocks', () => {
      const content = 'Before code.\n\n```python editor\nprint("hello")\n```\n\nAfter code.'

      const excerpt = generateExcerpt(content)

      expect(excerpt).not.toContain('print')
      expect(excerpt).not.toContain('```')
      expect(excerpt).toContain('Before code.')
      expect(excerpt).toContain('After code.')
    })

    it('should strip raw HTML and custom Eduskript components', () => {
      const content = 'Real content. <plugin src="x"/><tabs-container data-items=\'["A"]\'><tab-item>Hidden</tab-item></tabs-container> More content.'

      const excerpt = generateExcerpt(content)

      expect(excerpt).not.toContain('<')
      expect(excerpt).not.toContain('plugin')
      expect(excerpt).toContain('Real content.')
      expect(excerpt).toContain('More content.')
    })

    it('should decode common HTML entities', () => {
      const content = 'Text with &amp; and &gt; and &quot;quoted&quot; words.'

      const excerpt = generateExcerpt(content)

      expect(excerpt).toContain('&')
      expect(excerpt).toContain('>')
      expect(excerpt).toContain('"quoted"')
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
