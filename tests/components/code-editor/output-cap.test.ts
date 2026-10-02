import { describe, it, expect } from 'vitest'
import { appendOutputCapped, MAX_OUTPUT_LINES } from '@/components/public/code-editor/output-cap'
import { OutputLevel, type OutputEntry } from '@/components/public/code-editor/types'

const entry = (message: string, level = OutputLevel.OUTPUT): OutputEntry => ({ message, level, timestamp: 0 })

function run(messages: string[]): OutputEntry[] {
  let out: OutputEntry[] = []
  for (const m of messages) out = appendOutputCapped(out, entry(m))
  return out
}

describe('appendOutputCapped', () => {
  it('keeps everything below the cap without a notice', () => {
    const out = run(['a\n', 'b\n', 'c\n'])
    expect(out.map(e => e.message)).toEqual(['a\n', 'b\n', 'c\n'])
    expect(out.some(e => e.truncationNotice)).toBe(false)
  })

  it('keeps only the last 2000 lines of a runaway print loop and prepends one notice', () => {
    const out = run(Array.from({ length: 10_000 }, (_, i) => `zeile ${i}\n`))
    const [notice, ...rest] = out
    expect(MAX_OUTPUT_LINES).toBe(2000)
    expect(notice.truncationNotice).toBe(true)
    expect(notice.message).toBe('Output truncated — showing last 2000 lines')
    expect(rest).toHaveLength(2000)
    expect(rest[0].message).toBe('zeile 8000\n')
    expect(rest[rest.length - 1].message).toBe('zeile 9999\n')
    expect(out.filter(e => e.truncationNotice)).toHaveLength(1)
  })

  it('trims a single huge chunk to its last 2000 lines', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `l${i}`).join('\n') + '\n'
    const out = run([big])
    expect(out[0].truncationNotice).toBe(true)
    const lines = out[1].message.split('\n').filter(Boolean)
    expect(lines).toHaveLength(2000)
    expect(lines[0]).toBe('l3000')
    expect(lines[1999]).toBe('l4999')
  })
})
