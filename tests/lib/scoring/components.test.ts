import { describe, it, expect } from 'vitest'
import { parseGradableComponents, extractComponentContext } from '@/lib/scoring/components'

const fence = '```'

const md = `# Prüfung

## Teil 1

### Aufgabe 1 — Modulo (1 Punkt)

${fence}python
print(7 % 3)
${fence}

<question id="p1" type="text" points="1" showFeedback="false">
Was gibt dieses Programm aus?

${fence}expected
1
${fence}
</question>

### Aufgabe 3 — Wahl (2 Punkte)

<question id="q3" type="single" points="2">
<answer correct="true">A</answer>
<answer>B</answer>
</question>

## Teil 2

### Aufgabe 8 — Fläche (3 Punkte)

${fence}python editor exam id="a8"
def f():
    pass
${fence}

${fence}python-check for="a8" points="3"
assert f() == 1
${fence}
`

describe('parseGradableComponents', () => {
  it('enumerates questions + python-checks in document order with ids, types, points', () => {
    const comps = parseGradableComponents(md)
    expect(comps).toEqual([
      { componentId: 'quiz-user-content-p1', kind: 'quiz', questionType: 'text', maxPoints: 1, label: 'Aufgabe 1 — Modulo (1 Punkt)' },
      { componentId: 'quiz-user-content-q3', kind: 'quiz', questionType: 'single', maxPoints: 2, label: 'Aufgabe 3 — Wahl (2 Punkte)' },
      { componentId: 'python-check-a8', kind: 'python', maxPoints: 3, label: 'Aufgabe 8 — Fläche (3 Punkte)', checkCode: 'assert f() == 1', starterCode: 'def f():\n    pass' },
    ])
  })

  it('ignores plain code fences and <question> examples inside fences', () => {
    const sneaky = `${fence}markdown\n<question id="not-real" type="text" points="9">\n${fence}\n`
    expect(parseGradableComponents(sneaky)).toEqual([])
  })

  it('skips components without an explicit id', () => {
    const noId = `<question type="text" points="2">\nPrompt\n</question>`
    expect(parseGradableComponents(noId)).toEqual([])
  })

  it('defaults question type to multiple when unset', () => {
    const comps = parseGradableComponents(`<question id="x" points="1">\n<answer correct="true">A</answer>\n</question>`)
    expect(comps[0]).toMatchObject({ componentId: 'quiz-user-content-x', questionType: 'multiple' })
  })

  it('captures the python editor stub as the matching component starterCode', () => {
    const withStub = `### Aufgabe — doppelt
${fence}python editor id="e1code" points="4"
def doppelt(x):
    pass
${fence}
${fence}python-check for="e1code" points="4"
assert doppelt(2) == 4
${fence}`
    const py = parseGradableComponents(withStub).find((c) => c.componentId === 'python-check-e1code')
    expect(py?.starterCode).toContain('def doppelt(x):')
    expect(py?.starterCode).toContain('pass')
    expect(py?.checkCode).toContain('assert doppelt(2) == 4')
  })
})

describe('extractComponentContext', () => {
  it('returns the h1/h2 section containing the component, excluding other parts', () => {
    const ctx = extractComponentContext(md, 'python-check-a8')
    expect(ctx).toContain('## Teil 2')
    expect(ctx).toContain('python-check for="a8"')
    // Part 1 (a different h2 section) must be excluded.
    expect(ctx).not.toContain('Teil 1')
    expect(ctx).not.toContain('Aufgabe 1 — Modulo')
  })

  it('keeps multiple h3 sub-parts under one h1/h2 together (shared exercise context)', () => {
    const f = '```'
    const multi = `## Aufgabe Roboter

Gemeinsamer Kontext für beide Teile.

### Teil a

${f}python editor id="ra" points="2"
def a():
    pass
${f}
${f}python-check for="ra" points="2"
assert a()
${f}

### Teil b

${f}python editor id="rb" points="2"
def b():
    pass
${f}
${f}python-check for="rb" points="2"
assert b()
${f}
`
    const ctx = extractComponentContext(multi, 'python-check-rb')
    // The shared intro and the sibling h3 sub-part both stay in context.
    expect(ctx).toContain('Gemeinsamer Kontext')
    expect(ctx).toContain('### Teil a')
    expect(ctx).toContain('### Teil b')
  })

  it('scopes to a quiz component by its clobbered id', () => {
    const ctx = extractComponentContext(md, 'quiz-user-content-p1')
    expect(ctx).toContain('## Teil 1')
    expect(ctx).not.toContain('Teil 2')
  })

  it('returns null when the component is absent', () => {
    expect(extractComponentContext(md, 'python-check-nope')).toBeNull()
  })

  it('does not treat a # comment inside a code fence as a section boundary', () => {
    const f = '```'
    const withComment = `## Aufgabe

${f}python editor id="x" points="3"
def f():
    pass
# Zum Ausprobieren:
print(f())
${f}
${f}python-check for="x" points="3"
assert f()
${f}
`
    const ctx = extractComponentContext(withComment, 'python-check-x')
    // The fence comment must NOT split the section — the check stays in context.
    expect(ctx).toContain('# Zum Ausprobieren:')
    expect(ctx).toContain('python-check for="x"')
    expect(ctx).toContain('assert f()')
  })
})
