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
 * `turtle_path` list. Assertions can then check the list directly or via the
 * `turtle_matches(expected, …)` helper which tolerates rotation + translation.
 * This is what makes "many code paths produce the same figure" gradeable.
 */

import type { PythonCheckResult, PythonFile } from './types'

/** Same regex used at src/components/public/code-editor/index.tsx:886. */
const TURTLE_USE_RE = /import\s+turtle|from\s+turtle/

/**
 * Python shim that installs a minimal in-memory turtle stub into sys.modules
 * BEFORE student code runs, so `import turtle` works inside Pyodide's check
 * harness (Pyodide's stdlib doesn't ship the real turtle module — it
 * depends on tkinter). Every move records its end position into
 * `turtle_path` (list of (x, y, pen_down) tuples). Also exposes
 * `turtle_matches(expected, tolerance, tolerate_rotation)` for
 * rotation/translation-tolerant comparison.
 *
 * Runs only inside the Pyodide check harness. Skulpt (the runtime that
 * actually renders the canvas the student sees on Run) is untouched.
 */
const TURTLE_PRELUDE = `
# Auto-injected by python-check-runner when student code imports turtle.
turtle_path = []

import sys as _sys
import math as _math
import types as _types

class _EduskriptTurtle:
    def __init__(self, *a, **kw):
        self._x = 0.0
        self._y = 0.0
        self._h = 0.0  # heading in degrees, 0 = east
        self._down = True
        turtle_path.append((0.0, 0.0, True))

    def _rec(self):
        turtle_path.append((round(self._x, 6), round(self._y, 6), self._down))

    def forward(self, d):
        rad = _math.radians(self._h)
        self._x += d * _math.cos(rad)
        self._y += d * _math.sin(rad)
        self._rec()
    fd = forward

    def backward(self, d): self.forward(-d)
    back = backward
    bk = backward

    def right(self, a): self._h = (self._h - a) % 360
    rt = right

    def left(self, a): self._h = (self._h + a) % 360
    lt = left

    def goto(self, x, y=None):
        if y is None:
            x, y = x[0], x[1]
        self._x = float(x); self._y = float(y); self._rec()
    setpos = goto
    setposition = goto

    def setx(self, x): self._x = float(x); self._rec()
    def sety(self, y): self._y = float(y); self._rec()
    def home(self): self._x = self._y = self._h = 0.0; self._rec()

    def penup(self): self._down = False
    pu = penup
    up = penup

    def pendown(self): self._down = True
    pd = pendown
    down = pendown

    def isdown(self): return self._down
    def pos(self): return (self._x, self._y)
    position = pos
    def xcor(self): return self._x
    def ycor(self): return self._y
    def heading(self): return self._h
    def setheading(self, a): self._h = a % 360
    seth = setheading
    def towards(self, x, y=None):
        if y is None: x, y = x[0], x[1]
        return _math.degrees(_math.atan2(y - self._y, x - self._x)) % 360

    def circle(self, radius, extent=None, steps=None):
        if extent is None: extent = 360
        if steps is None: steps = max(int(abs(extent) / 3), 12)
        step_a = extent / steps
        step_d = 2 * radius * _math.sin(_math.radians(abs(step_a)) / 2)
        self.left(step_a / 2)
        for _ in range(steps):
            self.forward(step_d if step_a > 0 else -step_d)
            self.left(step_a)
        self.right(step_a / 2)

    # Style/visual methods are no-ops — they don't affect the path.
    def color(self, *a, **kw): pass
    def pencolor(self, *a, **kw): pass
    def fillcolor(self, *a, **kw): pass
    def begin_fill(self): pass
    def end_fill(self): pass
    def fill(self, *a): pass
    def width(self, *a): pass
    def pensize(self, *a): pass
    def dot(self, *a, **kw): pass
    def stamp(self): return None
    def clearstamp(self, *a): pass
    def write(self, *a, **kw): pass
    def hideturtle(self): pass
    ht = hideturtle
    def showturtle(self): pass
    st = showturtle
    def isvisible(self): return True
    def speed(self, *a): pass
    def shape(self, *a): pass
    def shapesize(self, *a, **kw): pass
    def tracer(self, *a, **kw): pass
    def update(self): pass
    def reset(self): self._x = self._y = self._h = 0.0; self._down = True
    def clear(self): pass

class _EduskriptScreen:
    def setup(self, *a, **kw): pass
    def title(self, *a, **kw): pass
    def bgcolor(self, *a, **kw): pass
    def bgpic(self, *a, **kw): pass
    def screensize(self, *a, **kw): pass
    def colormode(self, *a, **kw): pass
    def listen(self): pass
    def onkey(self, *a, **kw): pass
    def onkeypress(self, *a, **kw): pass
    def onkeyrelease(self, *a, **kw): pass
    def onclick(self, *a, **kw): pass
    def ontimer(self, *a, **kw): pass
    def update(self): pass
    def tracer(self, *a, **kw): pass
    def mainloop(self): pass
    def done(self): pass
    def exitonclick(self): pass
    def reset(self): pass

# Build a fake turtle module and install it before student code runs.
__fake = _types.ModuleType('turtle')
__fake.Turtle = _EduskriptTurtle
__fake.RawTurtle = _EduskriptTurtle
__fake.Pen = _EduskriptTurtle
__fake.Screen = lambda: _EduskriptScreen()
__fake.TurtleScreen = _EduskriptScreen

# Module-level shortcuts that operate on a single shared default turtle.
__fake._default = None
def __get_default():
    if __fake._default is None:
        __fake._default = _EduskriptTurtle()
    return __fake._default

for __m in ('forward', 'fd', 'backward', 'back', 'bk', 'right', 'rt', 'left', 'lt',
            'goto', 'setpos', 'setposition', 'setx', 'sety', 'home', 'circle',
            'penup', 'pu', 'up', 'pendown', 'pd', 'down', 'isdown',
            'pos', 'position', 'xcor', 'ycor', 'heading', 'setheading', 'seth',
            'color', 'pencolor', 'fillcolor', 'begin_fill', 'end_fill',
            'width', 'pensize', 'dot', 'stamp', 'write',
            'hideturtle', 'ht', 'showturtle', 'st', 'speed', 'shape', 'tracer',
            'update', 'reset', 'clear'):
    def __mk(_name):
        def __fn(*a, **kw):
            return getattr(__get_default(), _name)(*a, **kw)
        return __fn
    setattr(__fake, __m, __mk(__m))

__fake.mainloop = lambda: None
__fake.done = lambda: None
__fake.exitonclick = lambda: None
__fake.bye = lambda: None

_sys.modules['turtle'] = __fake


def _drawn_segments(path):
    """Extract the set of drawn line segments (where the pen was down during
    the move). Each segment is canonicalised so direction doesn't matter:
    the lexicographically smaller endpoint always comes first.
    """
    segs = []
    for i in range(1, len(path)):
        x0, y0, _ = path[i - 1]
        x1, y1, down = path[i]
        if not down or (x0 == x1 and y0 == y1):
            continue
        p1 = (round(x0, 3), round(y0, 3))
        p2 = (round(x1, 3), round(y1, 3))
        segs.append(tuple(sorted([p1, p2])))
    return segs


def _normalize_segs(segs):
    """Translate segments so the bounding-box min corner is at (0, 0)."""
    if not segs:
        return frozenset()
    all_pts = [p for s in segs for p in s]
    dx = min(p[0] for p in all_pts)
    dy = min(p[1] for p in all_pts)
    return frozenset(
        frozenset((round(p[0] - dx, 3), round(p[1] - dy, 3)) for p in seg)
        for seg in segs
    )


def turtle_matches(expected, tolerate_rotation=True):
    """
    Compare the SET of drawn line segments to expected.
    expected: list of ((x1, y1), (x2, y2)) segments forming the target figure.
    Both sets are normalised so the bounding-box origin is at (0, 0).
    Direction of each segment doesn't matter; order of strokes doesn't matter;
    retracing over an existing segment doesn't count again. With
    tolerate_rotation=True, the four cardinal rotations of expected are tried.
    Returns True iff the figure matches.
    """
    actual = _drawn_segments(turtle_path)
    if not actual:
        return False
    target = []
    for seg in expected:
        p1 = (round(seg[0][0], 3), round(seg[0][1], 3))
        p2 = (round(seg[1][0], 3), round(seg[1][1], 3))
        target.append(tuple(sorted([p1, p2])))
    a = _normalize_segs(actual)
    if a == _normalize_segs(target):
        return True
    if tolerate_rotation:
        for theta in (90, 180, 270):
            rad = _math.radians(theta)
            c, s = _math.cos(rad), _math.sin(rad)
            rotated = []
            for seg in target:
                rp1 = (seg[0][0] * c - seg[0][1] * s, seg[0][0] * s + seg[0][1] * c)
                rp2 = (seg[1][0] * c - seg[1][1] * s, seg[1][0] * s + seg[1][1] * c)
                rotated.append(tuple(sorted([rp1, rp2])))
            if a == _normalize_segs(rotated):
                return True
    return False


def turtle_path_matches(expected, tolerance=1.0, tolerate_rotation=True):
    """
    Strict path comparison — vertex order matters. Use this when the order
    of moves is part of the exercise (e.g. "draw side A first, then side B").
    For "did the student draw the right figure" use turtle_matches instead.
    """
    if not turtle_path or not expected:
        return False
    actual = [(p[0], p[1]) for p in turtle_path]
    target = [(p[0], p[1]) for p in expected]
    if len(actual) != len(target):
        return False
    ax0, ay0 = actual[0]
    tx0, ty0 = target[0]
    a = [(x - ax0, y - ay0) for x, y in actual]
    t = [(x - tx0, y - ty0) for x, y in target]
    def _close(p, q):
        return all(abs(px - qx) <= tolerance and abs(py - qy) <= tolerance
                   for (px, py), (qx, qy) in zip(p, q))
    if _close(a, t):
        return True
    if tolerate_rotation:
        for theta in (90, 180, 270):
            rad = _math.radians(theta)
            c, s = _math.cos(rad), _math.sin(rad)
            rotated = [(x * c - y * s, x * s + y * c) for x, y in t]
            if _close(a, rotated):
                return True
    return False
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
  // Collapse explicit line continuations (a backslash at end of line) so a
  // multi-line `assert <cond>, \\\n    "long message"` becomes one logical
  // line before we split. Without this, each fragment lands in its own file
  // and Python errors with "unexpected EOF while parsing".
  const collapsed = checkCode.replace(/\\\n[ \t]*/g, ' ')
  const lines = collapsed.split('\n')
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
# turtle_matches and turtle_path are visible to setup + assertions.
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
