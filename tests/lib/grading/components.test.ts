import { describe, it, expect } from 'vitest'
import { parseGradableComponents } from '@/lib/grading/components'

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
      { componentId: 'python-check-a8', kind: 'python', maxPoints: 3, label: 'Aufgabe 8 — Fläche (3 Punkte)', checkCode: 'assert f() == 1' },
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
})
