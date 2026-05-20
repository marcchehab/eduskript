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

    it('extracts f-string messages and keeps {interpolations} verbatim for runtime eval', () => {
      // The Python harness evaluates each label as an f-string against the
      // student's namespace, so `{var}` placeholders must reach Python intact.
      // (The harness falls back to `…` on NameError, so a missing var still
      // never renders raw braces to the student.)
      const { assertions } = parseAssertions(
        `assert "regenschirm" in res.lower(), f"Bei (10, True) fehlt 'Regenschirm'. Antwort war: {res}"`,
      )
      expect(assertions).toHaveLength(1)
      expect(assertions[0].failLabel).toBe(
        "Bei (10, True) fehlt 'Regenschirm'. Antwort war: {res}",
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

    it('passes a pure-interpolation body through verbatim for runtime eval', () => {
      // f-string consisting of *only* an interpolation — `f"{x}"`. Reaches
      // Python intact; the harness evals it as an f-string and substitutes
      // the rendered value (or `…` if the var isn't in scope).
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
      expect(assertions[0].failLabel).toBe('Bei {input} ist falsch.')
      expect(assertions[0].passLabel).toBe('Top — {input} stimmt!')
    })

    it('falls back to the fail label when the pass slot is empty', () => {
      // `"fail|"` — teacher only cares about the fail message. On pass we
      // reuse the fail text rather than rendering a blank row.
      const { assertions } = parseAssertions(`assert ok, "fail message|"`)
      expect(assertions[0].failLabel).toBe('fail message')
      expect(assertions[0].passLabel).toBe('fail message')
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
