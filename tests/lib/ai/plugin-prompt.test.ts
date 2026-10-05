import { describe, it, expect } from 'vitest'
import { extractPluginHtml, parsePluginResponse } from '@/lib/ai/plugin-prompt'

const HTML = '<style>body{color:red}</style>\n<div id="q"></div>\n<script>var a = 1</script>'

describe('extractPluginHtml', () => {
  it('returns bare HTML unchanged (trimmed)', () => {
    expect(extractPluginHtml(`\n${HTML}\n`)).toBe(HTML)
  })

  it('strips a fence wrapping the whole response', () => {
    expect(extractPluginHtml('```html\n' + HTML + '\n```')).toBe(HTML)
    expect(extractPluginHtml('```\n' + HTML + '\n```\n')).toBe(HTML)
  })

  it('drops chat prose before the fence (QA: plugin-ai-generation-leaks-prose-into-html)', () => {
    const text = "Here's a ready-to-run quiz cell for identifying cell organelles.\n\n```html\n" + HTML + '\n```'
    expect(extractPluginHtml(text)).toBe(HTML)
  })

  it('drops prose after the closing fence', () => {
    const text = 'Sure:\n```html\n' + HTML + '\n```\n\nLet me know if you want more questions.'
    expect(extractPluginHtml(text)).toBe(HTML)
  })

  it('keeps everything after an unclosed opening fence', () => {
    expect(extractPluginHtml('Here you go:\n```html\n' + HTML)).toBe(HTML)
  })

  it('leaves fences inside unwrapped plugin HTML alone', () => {
    const inner = '<div></div>\n<script>\nvar md = `\n```js\nx()\n```\n`\n</script>'
    expect(extractPluginHtml(inner)).toBe(inner)
  })
})

describe('extractPluginHtml without a fence', () => {
  it('drops prose before the first tag and after the last tag line', () => {
    const text = "Here's your memory game!\n\n" + HTML + '\n\nEnjoy it with your class.'
    expect(extractPluginHtml(text)).toBe(HTML)
  })
})

describe('parsePluginResponse', () => {
  it('returns the summary and strips its comment', () => {
    const r = parsePluginResponse('<!-- summary: Die Karten sind jetzt grösser. -->\n' + HTML)
    expect(r).toEqual({ html: HTML, summary: 'Die Karten sind jetzt grösser.', question: null, needsTemplate: null })
  })

  it('returns a clarifying question when no HTML came back', () => {
    const r = parsePluginResponse('<!-- question: Was genau soll besser werden? -->')
    expect(r).toEqual({ html: '', summary: null, question: 'Was genau soll besser werden?', needsTemplate: null })
  })

  it('ignores a question when HTML is present', () => {
    expect(parsePluginResponse('<!-- question: Okay? -->\n' + HTML).question).toBeNull()
  })
})
