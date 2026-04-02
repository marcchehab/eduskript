/**
 * Python Check Runner
 *
 * Executes teacher-defined assert statements against student code using Pyodide.
 * Each assertion runs independently so partial results are reported.
 *
 * Approach: Write student code and check code to Pyodide's virtual filesystem,
 * then run a harness script that exec()'s them. This avoids fragile string escaping.
 */

import type { PythonCheckResult, PythonFile } from './types'

/**
 * Parse assertion lines from check code and extract labels.
 * Lines starting with `assert ` are test cases.
 * Non-assert lines are setup code (runs before assertions).
 */
function parseAssertions(checkCode: string): { setupLines: string[]; assertions: { line: string; label: string }[] } {
  const lines = checkCode.split('\n')
  const assertions: { line: string; label: string }[] = []
  const setupLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      setupLines.push(line)
      continue
    }

    if (trimmed.startsWith('assert ')) {
      // Extract message: assert expr, "message"
      const msgMatch = trimmed.match(/,\s*["'](.+?)["']\s*$/)
      const label = msgMatch
        ? msgMatch[1]
        : `Test ${assertions.length + 1}: \`${trimmed}\``
      assertions.push({ line: trimmed, label })
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

  // Write each assertion as a separate file
  for (let i = 0; i < assertions.length; i++) {
    pyodide.FS.writeFile(`__eduskript_assert_${i}.py`, assertions[i].line)
  }

  // Write assertion labels as JSON
  pyodide.FS.writeFile('__eduskript_labels.json', JSON.stringify(assertions.map(a => a.label)))

  // The harness script reads files from FS and runs them
  const harness = `
import json

with open('__eduskript_labels.json') as f:
    __labels = json.load(f)

__count = ${assertions.length}
__results = []
__ns = {}

# Run student code in a fresh namespace
with open('__eduskript_student.py') as f:
    __student_code = f.read()

try:
    exec(compile(__student_code, '<student>', 'exec'), __ns)
except Exception as __e:
    # Student code failed — all tests fail with this error
    __err = str(__e)
    for __i in range(__count):
        __results.append({"index": __i, "passed": False, "label": __labels[__i], "error": "Code error: " + __err})

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
            __results.append({"index": __i, "passed": True, "label": __labels[__i]})
        except AssertionError as __e:
            __err_msg = str(__e) if str(__e) else None
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
            __results.append({"index": __i, "passed": False, "label": __labels[__i], "error": __err_msg})
        except Exception as __e:
            __results.append({"index": __i, "passed": False, "label": __labels[__i], "error": str(__e)})

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
      label: a.label,
      error: `Check runner error: ${error.message || String(error)}`
    }))
  } finally {
    // Clean up temp files
    const filesToRemove = [
      '__eduskript_student.py',
      '__eduskript_setup.py',
      '__eduskript_labels.json',
      ...assertions.map((_, i) => `__eduskript_assert_${i}.py`)
    ]
    for (const f of filesToRemove) {
      try { pyodide.FS.unlink(f) } catch { /* ignore */ }
    }
  }
}
