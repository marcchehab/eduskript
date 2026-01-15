import { describe, it, expect } from 'vitest'
import { parseJsonResponse, isValidEditPlan } from '@/lib/ai/parse-json-response'

describe('parseJsonResponse', () => {
  describe('valid JSON responses', () => {
    it('parses clean JSON with no overflow', () => {
      const response = '{"edits":[{"pageId":"abc123","pageTitle":"Introduction","pageSlug":"intro","summary":"Add learning objectives section","isNew":false}],"overallSummary":"Adding learning objectives to the introduction page"}'

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toHaveLength(1)
        expect(result.data.edits[0].pageTitle).toBe('Introduction')
        expect(result.data.overallSummary).toBe('Adding learning objectives to the introduction page')
        expect(result.overflowBefore).toBeNull()
        expect(result.overflowAfter).toBeNull()
      }
    })

    it('parses JSON with new page (pageId: null)', () => {
      const response = '{"edits":[{"pageId":null,"pageTitle":"New Chapter","pageSlug":"new-chapter","summary":"Create new chapter","isNew":true}],"overallSummary":"Creating a new chapter"}'

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits[0].pageId).toBeNull()
        expect(result.data.edits[0].isNew).toBe(true)
      }
    })

    it('parses empty edits array', () => {
      const response = '{"edits":[],"overallSummary":"No changes needed"}'

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toHaveLength(0)
        expect(result.data.overallSummary).toBe('No changes needed')
      }
    })
  })

  describe('faulty responses with overflow', () => {
    it('extracts JSON with text before', () => {
      const response = `I'll analyze your request and create an edit plan.

{"edits":[{"pageId":"abc123","pageTitle":"Introduction","pageSlug":"intro","summary":"Add examples","isNew":false}],"overallSummary":"Adding code examples"}`

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toHaveLength(1)
        expect(result.overflowBefore).toBe("I'll analyze your request and create an edit plan.")
        expect(result.overflowAfter).toBeNull()
      }
    })

    it('extracts JSON with text after', () => {
      const response = `{"edits":[{"pageId":"abc123","pageTitle":"Introduction","pageSlug":"intro","summary":"Add examples","isNew":false}],"overallSummary":"Adding code examples"}

Let me know if you need any adjustments to this plan.`

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toHaveLength(1)
        expect(result.overflowBefore).toBeNull()
        expect(result.overflowAfter).toBe('Let me know if you need any adjustments to this plan.')
      }
    })

    it('extracts JSON with text before and after', () => {
      const response = `I'll analyze your request and create an edit plan.

{"edits":[{"pageId":"abc123","pageTitle":"Introduction","pageSlug":"intro","summary":"Add examples","isNew":false}],"overallSummary":"Adding code examples"}

Let me know if you need any adjustments to this plan.`

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toHaveLength(1)
        expect(result.overflowBefore).toBe("I'll analyze your request and create an edit plan.")
        expect(result.overflowAfter).toBe('Let me know if you need any adjustments to this plan.')
        expect(result.fullResponse).toBe(response)
      }
    })

    it('handles JSON wrapped in markdown code fence', () => {
      const response = `Here's the edit plan:

\`\`\`json
{"edits":[{"pageId":"abc123","pageTitle":"Basics","pageSlug":"basics","summary":"Fix typos","isNew":false}],"overallSummary":"Fixing typos"}
\`\`\`

This should address your request.`

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toHaveLength(1)
        expect(result.data.edits[0].pageTitle).toBe('Basics')
      }
    })

    it('handles JSON with only markdown code fence (no other text)', () => {
      const response = `\`\`\`json
{"edits":[{"pageId":"abc123","pageTitle":"Basics","pageSlug":"basics","summary":"Fix typos","isNew":false}],"overallSummary":"Fixing typos"}
\`\`\``

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toHaveLength(1)
        expect(result.overflowBefore).toBeNull()
        expect(result.overflowAfter).toBeNull()
      }
    })
  })

  describe('text-only responses (no JSON)', () => {
    it('returns error for pure text response', () => {
      const response = `I understand you want me to respond normally rather than in the JSON format I'm required to use for content planning. However, I'm specifically designed to analyze educational content modification requests and respond only with JSON objects.

If you have a specific edit request like "add more examples" or "translate to German", I can help with that.`

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('No valid JSON object found in response')
        expect(result.fullResponse).toBe(response)
      }
    })

    it('returns error for empty response', () => {
      const response = ''

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('No valid JSON object found in response')
      }
    })

    it('returns error for response with only whitespace', () => {
      const response = '   \n\n   '

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(false)
    })
  })

  describe('malformed JSON', () => {
    it('returns error for incomplete JSON object', () => {
      const response = '{"edits":[{"pageId":"abc123"'

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(false)
    })

    it('returns error for JSON missing required fields', () => {
      const response = '{"edits":[{"pageId":"abc123"}]}'

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Parsed JSON does not match expected structure')
      }
    })

    it('returns error for JSON with wrong structure', () => {
      const response = '{"pages":[],"summary":"test"}'

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Parsed JSON does not match expected structure')
      }
    })
  })

  describe('edge cases', () => {
    it('handles nested JSON objects in strings', () => {
      const response = '{"edits":[{"pageId":"abc123","pageTitle":"Test","pageSlug":"test","summary":"Add JSON example: {\\"key\\": \\"value\\"}","isNew":false}],"overallSummary":"Adding examples"}'

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits[0].summary).toBe('Add JSON example: {"key": "value"}')
      }
    })

    it('handles multiple JSON objects (takes first valid one)', () => {
      const response = `{"edits":[{"pageId":"first","pageTitle":"First","pageSlug":"first","summary":"First edit","isNew":false}],"overallSummary":"First"}

{"edits":[{"pageId":"second","pageTitle":"Second","pageSlug":"second","summary":"Second edit","isNew":false}],"overallSummary":"Second"}`

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits[0].pageId).toBe('first')
        expect(result.overflowAfter).toContain('second')
      }
    })

    it('handles curly braces in surrounding text', () => {
      // Parser should skip {curly braces} and {formatting} as they don't validate,
      // and find the actual JSON object
      const response = `Here's a tip: use {curly braces} carefully.

{"edits":[{"pageId":"abc123","pageTitle":"Test","pageSlug":"test","summary":"Test","isNew":false}],"overallSummary":"Test"}

Remember: {formatting} matters!`

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toHaveLength(1)
        expect(result.overflowBefore).toContain('curly braces')
        expect(result.overflowAfter).toContain('formatting')
      }
    })

    it('handles markdown code block without json tag', () => {
      const response = `Here's the plan:

\`\`\`
{"edits":[{"pageId":"abc123","pageTitle":"Test","pageSlug":"test","summary":"Test","isNew":false}],"overallSummary":"Test"}
\`\`\``

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toHaveLength(1)
      }
    })

    it('handles unicode and emojis in content', () => {
      const response = '{"edits":[{"pageId":"abc123","pageTitle":"Einführung 🎉","pageSlug":"einfuhrung","summary":"Add examples with émojis 👍 and ümlauts","isNew":false}],"overallSummary":"Adding unicode content 中文"}'

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits[0].pageTitle).toBe('Einführung 🎉')
        expect(result.data.edits[0].summary).toContain('émojis 👍')
        expect(result.data.overallSummary).toContain('中文')
      }
    })

    it('handles extra unexpected fields in JSON', () => {
      const response = '{"edits":[{"pageId":"abc123","pageTitle":"Test","pageSlug":"test","summary":"Test","isNew":false,"unexpectedField":"should be ignored","anotherExtra":123}],"overallSummary":"Test","extraTopLevel":"also ignored"}'

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toHaveLength(1)
        expect(result.data.edits[0].pageTitle).toBe('Test')
      }
    })

    it('handles empty strings for optional display fields', () => {
      // Empty strings are valid - the validator checks type, not content
      const response = '{"edits":[{"pageId":"abc123","pageTitle":"","pageSlug":"test","summary":"","isNew":false}],"overallSummary":""}'

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits[0].pageTitle).toBe('')
        expect(result.data.edits[0].summary).toBe('')
      }
    })

    it('handles multiple markdown code blocks (first invalid, second valid)', () => {
      const response = `Here's some example code:

\`\`\`javascript
function test() { return "hello" }
\`\`\`

And here's the edit plan:

\`\`\`json
{"edits":[{"pageId":"abc123","pageTitle":"Test","pageSlug":"test","summary":"Test","isNew":false}],"overallSummary":"Test"}
\`\`\``

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toHaveLength(1)
      }
    })

    it('extracts valid object from inside JSON array', () => {
      const response = '[{"edits":[{"pageId":"abc123","pageTitle":"Test","pageSlug":"test","summary":"Test","isNew":false}],"overallSummary":"Test"}]'

      const result = parseJsonResponse(response, isValidEditPlan)

      // Parser finds the valid object inside the array - robust extraction
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toHaveLength(1)
        expect(result.overflowBefore).toBe('[')
        expect(result.overflowAfter).toBe(']')
      }
    })

    it('handles deeply escaped quotes', () => {
      const response = '{"edits":[{"pageId":"abc123","pageTitle":"Test","pageSlug":"test","summary":"Use \\"double quotes\\" and \'single quotes\'","isNew":false}],"overallSummary":"Test"}'

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits[0].summary).toBe('Use "double quotes" and \'single quotes\'')
      }
    })

    it('handles very long response', () => {
      // Generate a response with many edits
      const edits = Array.from({ length: 100 }, (_, i) => ({
        pageId: `page${i}`,
        pageTitle: `Page ${i} with some longer title text`,
        pageSlug: `page-${i}`,
        summary: `Edit summary for page ${i} with additional description text`,
        isNew: false
      }))
      const response = JSON.stringify({ edits, overallSummary: 'Large batch of edits' })

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toHaveLength(100)
      }
    })

    it('handles HTML-like wrapper around JSON', () => {
      const response = `<response>
{"edits":[{"pageId":"abc123","pageTitle":"Test","pageSlug":"test","summary":"Test","isNew":false}],"overallSummary":"Test"}
</response>`

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toHaveLength(1)
        expect(result.overflowBefore).toContain('<response>')
        expect(result.overflowAfter).toContain('</response>')
      }
    })

    it('handles BOM character at start', () => {
      const bom = '\uFEFF'
      const response = bom + '{"edits":[{"pageId":"abc123","pageTitle":"Test","pageSlug":"test","summary":"Test","isNew":false}],"overallSummary":"Test"}'

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toHaveLength(1)
      }
    })

    it('rejects JSON with trailing commas (invalid JSON)', () => {
      const response = '{"edits":[{"pageId":"abc123","pageTitle":"Test","pageSlug":"test","summary":"Test","isNew":false,}],"overallSummary":"Test",}'

      const result = parseJsonResponse(response, isValidEditPlan)

      // Trailing commas make it invalid JSON
      expect(result.success).toBe(false)
    })

    it('rejects JSON with comments (invalid JSON)', () => {
      const response = `{
        // This is a comment
        "edits":[{"pageId":"abc123","pageTitle":"Test","pageSlug":"test","summary":"Test","isNew":false}],
        "overallSummary":"Test"
      }`

      const result = parseJsonResponse(response, isValidEditPlan)

      // Comments make it invalid JSON
      expect(result.success).toBe(false)
    })

    it('handles newlines inside JSON string values', () => {
      const response = '{"edits":[{"pageId":"abc123","pageTitle":"Test","pageSlug":"test","summary":"Line 1\\nLine 2\\nLine 3","isNew":false}],"overallSummary":"Multi\\nline\\nsummary"}'

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits[0].summary).toBe('Line 1\nLine 2\nLine 3')
        expect(result.data.overallSummary).toBe('Multi\nline\nsummary')
      }
    })

    it('handles whitespace-heavy formatting', () => {
      const response = `
        {
          "edits": [
            {
              "pageId": "abc123",
              "pageTitle": "Test",
              "pageSlug": "test",
              "summary": "Test",
              "isNew": false
            }
          ],
          "overallSummary": "Test"
        }
      `

      const result = parseJsonResponse(response, isValidEditPlan)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toHaveLength(1)
      }
    })
  })
})

describe('isValidEditPlan', () => {
  it('validates correct structure', () => {
    const valid = {
      edits: [
        { pageId: 'abc', pageTitle: 'Title', pageSlug: 'slug', summary: 'Summary' }
      ],
      overallSummary: 'Overall'
    }
    expect(isValidEditPlan(valid)).toBe(true)
  })

  it('validates with null pageId', () => {
    const valid = {
      edits: [
        { pageId: null, pageTitle: 'Title', pageSlug: 'slug', summary: 'Summary', isNew: true }
      ],
      overallSummary: 'Overall'
    }
    expect(isValidEditPlan(valid)).toBe(true)
  })

  it('validates empty edits array', () => {
    const valid = { edits: [], overallSummary: 'No changes' }
    expect(isValidEditPlan(valid)).toBe(true)
  })

  it('rejects missing edits', () => {
    const invalid = { overallSummary: 'Test' }
    expect(isValidEditPlan(invalid)).toBe(false)
  })

  it('rejects missing overallSummary', () => {
    const invalid = { edits: [] }
    expect(isValidEditPlan(invalid)).toBe(false)
  })

  it('rejects edits with missing required fields', () => {
    const invalid = {
      edits: [{ pageId: 'abc' }],
      overallSummary: 'Test'
    }
    expect(isValidEditPlan(invalid)).toBe(false)
  })

  it('rejects non-object input', () => {
    expect(isValidEditPlan(null)).toBe(false)
    expect(isValidEditPlan('string')).toBe(false)
    expect(isValidEditPlan(123)).toBe(false)
    expect(isValidEditPlan([])).toBe(false)
  })
})
