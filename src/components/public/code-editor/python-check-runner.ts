/**
 * Python Check Runner
 *
 * Executes teacher-defined assert statements against student code using Pyodide.
 * Each assertion runs independently so partial results are reported.
 *
 * Approach: Write student code and check code to Pyodide's virtual filesystem,
 * then run a harness script that exec()'s them. This avoids fragile string escaping.
 *
 * Turtle auto-grading: when student code uses turtle, a small shim is exec'd
 * BEFORE the student code so every move records its end position into a
 * `__turtle_path` list. Assertions can then check the list directly or via the
 * `turtle_matches(expected, …)` helper which tolerates rotation + translation.
 * This is what makes "many code paths produce the same figure" gradeable.
 */

import type { PythonCheckResult, PythonFile } from './types'

/** Same regex used at src/components/public/code-editor/index.tsx:886. */
const TURTLE_USE_RE = /import\s+turtle|from\s+turtle/

/**
 * Python shim that monkey-patches turtle.Turtle to record vertices into
 * `__turtle_path` (a list of (x, y, pen_down) tuples). Also exposes
 * `turtle_matches(expected, tolerance=1.0, tolerate_rotation=True)` for
 * rotation/translation-tolerant comparison.
 *
 * Runs only inside the Pyodide check harness — Skulpt (which renders the
 * canvas the student sees) is untouched.
 */
const TURTLE_PRELUDE = `
# Auto-injected by python-check-runner when student code imports turtle.
# Records every move into __turtle_path so assertions can compare paths
# without caring about which corner the student started from.
__turtle_path = []

try:
    import turtle as __t
    import math as __math

    def __record(self):
        pos = self.pos()
        __turtle_path.append((round(pos[0], 6), round(pos[1], 6), bool(self.isdown())))

    _orig_init = __t.Turtle.__init__
    def __wrap_init(self, *a, **kw):
        _orig_init(self, *a, **kw)
        __record(self)
    __t.Turtle.__init__ = __wrap_init

    def __wrap_move(orig):
        def wrapped(self, *a, **kw):
            if not __turtle_path:
                __record(self)
            r = orig(self, *a, **kw)
            __record(self)
            return r
        return wrapped

    for __name in ('forward', 'backward', 'goto', 'setpos', 'setposition',
                   'setx', 'sety', 'home', 'circle', 'fd', 'back', 'bk'):
        __orig = getattr(__t.Turtle, __name, None)
        if callable(__orig):
            setattr(__t.Turtle, __name, __wrap_move(__orig))

    def turtle_matches(expected, tolerance=1.0, tolerate_rotation=True):
        """
        Compare __turtle_path against an expected list of (x, y) (or (x, y, pen_down))
        tuples. Both paths are translated so their first vertex is at the origin.
        With tolerate_rotation=True, the four cardinal rotations are tried.
        Returns True iff the actual path matches expected within tolerance.
        """
        if not __turtle_path or not expected:
            return False
        actual = [(p[0], p[1]) for p in __turtle_path]
        target = [(p[0], p[1]) for p in expected]
        if len(actual) != len(target):
            return False
        ax0, ay0 = actual[0]
        tx0, ty0 = target[0]
        a = [(x - ax0, y - ay0) for x, y in actual]
        t = [(x - tx0, y - ty0) for x, y in target]
        def close(p, q):
            return all(abs(px - qx) <= tolerance and abs(py - qy) <= tolerance
                       for (px, py), (qx, qy) in zip(p, q))
        if close(a, t):
            return True
        if tolerate_rotation:
            for theta in (90, 180, 270):
                rad = __math.radians(theta)
                c, s = __math.cos(rad), __math.sin(rad)
                rotated = [(x * c - y * s, x * s + y * c) for x, y in t]
                if close(a, rotated):
                    return True
        return False
except Exception as __turtle_shim_err:
    # If the turtle module isn't usable in this Pyodide build, expose stubs
    # so assertions referencing them don't crash with NameError.
    def turtle_matches(*a, **kw): return False
`

export interface ParsedAssertion {
  line: string
  /** Label shown to the student when the assertion FAILS. */
  failLabel: string
  /** Label shown when the assertion PASSES. Defaults to the fail label. */
  passLabel: string
}

/**
 * Strip `{interpolation}` parts from a label string (so f-string interpolations
 * don't render literally as `{var}` in the displayed test name). Falls back to
 * the original string if stripping leaves nothing meaningful — better to show
 * the raw `{detail}` body than an `…`-only label.
 */
function cleanLabel(s: string): string {
  const stripped = s.replace(/\{[^{}]*\}/g, '…').trim()
  // If stripping interpolations leaves only the `…` placeholder(s), the
  // original message had no static text. Show the raw body instead so the
  // student sees something concrete rather than an opaque ellipsis.
  const meaningful = stripped.replace(/…/g, '').trim()
  return meaningful.length > 0 ? stripped : s
}

/**
 * Parse assertion lines from check code and extract labels.
 * Lines starting with `assert ` are test cases.
 * Non-assert lines are setup code (runs before assertions).
 *
 * Message syntax:
 *   - `"single message"`        — used for both pass and fail
 *   - `"fail message|pass msg"` — pipe splits fail (left) and pass (right)
 *   - f/r/b string prefixes are accepted; `{interpolations}` are stripped
 *     from the displayed label (the rendered string still surfaces in
 *     `error` when an f-string assert actually fires)
 *
 * Exported for testing.
 */
export function parseAssertions(checkCode: string): { setupLines: string[]; assertions: ParsedAssertion[] } {
  const lines = checkCode.split('\n')
  const assertions: ParsedAssertion[] = []
  const setupLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      setupLines.push(line)
      continue
    }

    if (trimmed.startsWith('assert ')) {
      // Extract message: `assert expr, "message"` — also accepts Python string
      // prefixes (f-string is the common case for AI-generated checks).
      const msgMatch = trimmed.match(/,\s*[fFrRbB]{0,2}["'](.+?)["']\s*$/)
      if (msgMatch) {
        const raw = msgMatch[1]
        // Pipe split: "fail|pass". Only the FIRST pipe matters; later pipes
        // stay in the pass message. Without a pipe, both states share the
        // same label (backward compatible).
        const pipeIdx = raw.indexOf('|')
        const failRaw = pipeIdx === -1 ? raw : raw.slice(0, pipeIdx)
        const passRaw = pipeIdx === -1 ? raw : raw.slice(pipeIdx + 1)
        assertions.push({
          line: trimmed,
          failLabel: cleanLabel(failRaw),
          passLabel: cleanLabel(passRaw),
        })
      } else {
        const fallback = `Test ${assertions.length + 1}: \`${trimmed}\``
        assertions.push({ line: trimmed, failLabel: fallback, passLabel: fallback })
      }
    } else {
      setupLines.push(line)
    }
  }

  return { setupLines, assertions }
}

/**
 * Run python checks against student code.
 *
 * 1. Write auxiliary files to Pyodide FS
 * 2. Write student code and individual assertion files to Pyodide FS
 * 3. Run a harness that exec()'s student code, then each assertion
 * 4. Return per-assertion pass/fail results as JSON
 */
export async function runPythonChecks(
  pyodide: any,
  studentCode: string,
  checkCode: string,
  auxiliaryFiles: PythonFile[]
): Promise<PythonCheckResult[]> {
  const { setupLines, assertions } = parseAssertions(checkCode)

  if (assertions.length === 0) {
    return []
  }

  // Write auxiliary files to Pyodide FS and invalidate module cache
  for (const file of auxiliaryFiles) {
    pyodide.FS.writeFile(file.name, file.content)
    const moduleName = file.name.replace(/\.py$/i, '')
    await pyodide.runPythonAsync(
      `import sys\nif '${moduleName}' in sys.modules: del sys.modules['${moduleName}']`
    )
  }

  // Write student code and setup+assertions to virtual files
  // This avoids all string escaping issues
  pyodide.FS.writeFile('__eduskript_student.py', studentCode)
  pyodide.FS.writeFile('__eduskript_setup.py', setupLines.join('\n'))

  // Inject turtle path-recording shim only when the student is using turtle —
  // skip the import + monkey-patching cost otherwise. The prelude runs in
  // __ns BEFORE the student code, so all moves are captured.
  const usesTurtle = TURTLE_USE_RE.test(studentCode)
  pyodide.FS.writeFile('__eduskript_prelude.py', usesTurtle ? TURTLE_PRELUDE : '')

  // Write each assertion as a separate file
  for (let i = 0; i < assertions.length; i++) {
    pyodide.FS.writeFile(`__eduskript_assert_${i}.py`, assertions[i].line)
  }

  // Write assertion labels as JSON. Each entry carries both fail and pass
  // labels; the harness picks the right one based on the result.
  pyodide.FS.writeFile(
    '__eduskript_labels.json',
    JSON.stringify(assertions.map((a) => ({ fail: a.failLabel, pass: a.passLabel }))),
  )

  // The harness script reads files from FS and runs them
  const harness = `
import json

with open('__eduskript_labels.json') as f:
    __labels = json.load(f)

# Label design:
#   label  = always the failLabel (describes what the test checks)
#   detail = passLabel on success (iff teacher wrote one distinct from fail),
#            "Expected X, got Y" on failed ==, else None
# This way the student always sees what was tested; the detail line carries
# the reaction or the value mismatch, and collapses when there's nothing new.

def __detail_pass(__i):
    __entry = __labels[__i]
    __f = __entry.get("fail")
    __p = __entry.get("pass")
    return __p if (__p and __p != __f) else None

__count = ${assertions.length}
__results = []
__ns = {}

# Run student code in a fresh namespace.
# Capture stdout into a buffer so assertions can check what the student
# printed (exposed below as 'output'). Lets teachers test print-loop
# exercises without forcing students to wrap their code in a function or
# accumulate into a list.
import io as __io, contextlib as __cl
__stdout_buf = __io.StringIO()

with open('__eduskript_student.py') as f:
    __student_code = f.read()

# Turtle prelude (empty unless student code uses turtle). Runs in __ns so
# turtle_matches and __turtle_path are visible to setup + assertions.
with open('__eduskript_prelude.py') as f:
    __prelude_code = f.read()
if __prelude_code.strip():
    try:
        exec(compile(__prelude_code, '<turtle-prelude>', 'exec'), __ns)
    except Exception:
        pass

try:
    with __cl.redirect_stdout(__stdout_buf):
        exec(compile(__student_code, '<student>', 'exec'), __ns)
except Exception as __e:
    # Student code failed — all tests fail with this error
    __err = str(__e)
    for __i in range(__count):
        __results.append({"index": __i, "passed": False, "label": __labels[__i]["fail"], "error": "Code error: " + __err})

# Expose captured stdout to setup + asserts as 'output'.
# Set even on student-error so assertions referencing 'output' get a
# defined value (empty string) rather than NameError.
__ns['output'] = __stdout_buf.getvalue()

if not __results:
    # Run setup code in the student namespace
    with open('__eduskript_setup.py') as f:
        __setup_code = f.read()
    if __setup_code.strip():
        try:
            exec(compile(__setup_code, '<setup>', 'exec'), __ns)
        except Exception:
            pass

    # Run each assertion independently
    import re as __re
    for __i in range(__count):
        with open(f'__eduskript_assert_{__i}.py') as f:
            __assert_code = f.read()
        try:
            exec(compile(__assert_code, '<check>', 'exec'), __ns)
            __results.append({"index": __i, "passed": True, "label": __labels[__i]["fail"], "error": __detail_pass(__i)})
        except AssertionError:
            # Default to no error detail — str(AssertionError) is just the
            # assert's custom message, which we already show as the label.
            # Only the == branch below produces genuinely new info.
            __err_msg = None
            # Try to extract actual value from failed == comparison
            # Pattern: assert expr == expected  or  assert expr == expected, "msg"
            __m = __re.match(r'assert\\s+(.+?)\\s*==\\s*(.+?)(?:\\s*,\\s*["\\']|$)', __assert_code.strip())
            if __m:
                try:
                    __actual = eval(__m.group(1), __ns)
                    __expected = eval(__m.group(2), __ns)
                    __err_msg = f"Expected {__expected!r}, got {__actual!r}"
                except Exception:
                    pass
            __results.append({"index": __i, "passed": False, "label": __labels[__i]["fail"], "error": __err_msg})
        except Exception as __e:
            __results.append({"index": __i, "passed": False, "label": __labels[__i]["fail"], "error": str(__e)})

json.dumps(__results)
`

  // Suppress stdout/stderr during check execution
  pyodide.setStdout({ batched: () => {} })
  pyodide.setStderr({ batched: () => {} })

  try {
    const resultJson = await pyodide.runPythonAsync(harness)
    const results: PythonCheckResult[] = JSON.parse(resultJson)
    return results
  } catch (error: any) {
    // If the harness itself fails, all assertions fail
    return assertions.map((a, i) => ({
      index: i,
      passed: false,
      label: a.failLabel,
      error: `Check runner error: ${error.message || String(error)}`
    }))
  } finally {
    // Clean up temp files
    const filesToRemove = [
      '__eduskript_student.py',
      '__eduskript_setup.py',
      '__eduskript_prelude.py',
      '__eduskript_labels.json',
      ...assertions.map((_, i) => `__eduskript_assert_${i}.py`)
    ]
    for (const f of filesToRemove) {
      try { pyodide.FS.unlink(f) } catch { /* ignore */ }
    }
  }
}
