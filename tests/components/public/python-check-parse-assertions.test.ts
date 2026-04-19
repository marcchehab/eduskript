import { describe, it, expect } from 'vitest'
import { parseAssertions } from '@/components/public/code-editor/python-check-runner'

describe('parseAssertions', () => {
  describe('label extraction', () => {
    it('uses a plain string message for both pass and fail labels', () => {
      const { assertions } = parseAssertions(`assert fn(5) == 25, "fn(5) sollte 25 ergeben."`)
      expect(assertions).toHaveLength(1)
      expect(assertions[0].failLabel).toBe('fn(5) sollte 25 ergeben.')
      expect(assertions[0].passLabel).toBe('fn(5) sollte 25 ergeben.')
    })

    it('extracts f-string messages and strips {interpolations} from the label', () => {
      // Regression: the previous regex required a bare quote, missed the `f`
      // prefix, and fell back to showing the whole raw assert source as the
      // test name. f-string labels with `{var}` parts were doubly bad — they'd
      // show the raw assert plus the rendered error.
      const { assertions } = parseAssertions(
        `assert "regenschirm" in res.lower(), f"Bei (10, True) fehlt 'Regenschirm'. Antwort war: {res}"`,
      )
      expect(assertions).toHaveLength(1)
      expect(assertions[0].failLabel).toBe(
        "Bei (10, True) fehlt 'Regenschirm'. Antwort war: …",
      )
    })

    it('handles single-quoted messages', () => {
      const { assertions } = parseAssertions(`assert x == 1, 'x ist nicht 1'`)
      expect(assertions[0].failLabel).toBe('x ist nicht 1')
    })

    it('handles raw and bytes string prefixes', () => {
      const r = parseAssertions(`assert ok, r"raw \\path message"`)
      expect(r.assertions[0].failLabel).toBe('raw \\path message')
      const b = parseAssertions(`assert ok, b"bytes label"`)
      expect(b.assertions[0].failLabel).toBe('bytes label')
    })

    it('falls back to raw source when no message is provided', () => {
      const { assertions } = parseAssertions(`assert fn(5) == 25`)
      expect(assertions[0].failLabel).toMatch(/Test 1: `assert fn\(5\) == 25`/)
      expect(assertions[0].passLabel).toBe(assertions[0].failLabel)
    })

    it('keeps the original body when stripping interpolations leaves nothing', () => {
      // f-string consisting of *only* an interpolation — `f"{x}"`. Stripping
      // would leave an empty label; fall back to showing the original body
      // so the student sees something instead of a blank row.
      const { assertions } = parseAssertions(`assert ok, f"{detail}"`)
      expect(assertions[0].failLabel).toBe('{detail}')
    })

    it('numbers fallback labels per assertion', () => {
      const { assertions } = parseAssertions(`assert a == 1\nassert b == 2`)
      expect(assertions[0].failLabel).toContain('Test 1')
      expect(assertions[1].failLabel).toContain('Test 2')
    })
  })

  describe('pass/fail message split', () => {
    it('splits "fail|pass" on the first pipe', () => {
      const { assertions } = parseAssertions(`assert ok, "Regenschirm fehlt!|Top, passt!"`)
      expect(assertions[0].failLabel).toBe('Regenschirm fehlt!')
      expect(assertions[0].passLabel).toBe('Top, passt!')
    })

    it('only treats the first pipe as the separator (later pipes stay in pass)', () => {
      const { assertions } = parseAssertions(`assert ok, "fail|pass with | inside"`)
      expect(assertions[0].failLabel).toBe('fail')
      expect(assertions[0].passLabel).toBe('pass with | inside')
    })

    it('uses the same message for both states when no pipe is present (backward compat)', () => {
      const { assertions } = parseAssertions(`assert ok, "single message"`)
      expect(assertions[0].failLabel).toBe('single message')
      expect(assertions[0].passLabel).toBe('single message')
    })

    it('handles f-string body containing both pipe and interpolation', () => {
      const { assertions } = parseAssertions(
        `assert ok, f"Bei {input} ist falsch.|Top — {input} stimmt!"`,
      )
      expect(assertions[0].failLabel).toBe('Bei … ist falsch.')
      expect(assertions[0].passLabel).toBe('Top — … stimmt!')
    })

    it('handles empty pass after pipe by falling back to the empty body', () => {
      const { assertions } = parseAssertions(`assert ok, "fail message|"`)
      expect(assertions[0].failLabel).toBe('fail message')
      // Empty pass → cleanLabel falls back to the original (empty) string.
      // Not great UX but at least no crash; teachers shouldn't write this.
      expect(assertions[0].passLabel).toBe('')
    })
  })

  describe('setup vs assertions', () => {
    it('separates setup lines from assertions', () => {
      const code = `
import math

x = compute()

assert math.isclose(x, 3.14), "x sollte ~ pi sein"
`
      const { setupLines, assertions } = parseAssertions(code)
      expect(setupLines.some((l) => l.trim() === 'import math')).toBe(true)
      expect(setupLines.some((l) => l.trim() === 'x = compute()')).toBe(true)
      expect(assertions).toHaveLength(1)
      expect(assertions[0].failLabel).toBe('x sollte ~ pi sein')
    })
  })
})
