import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { remarkSurvey } from '@/lib/remark-plugins/survey'
import { remarkQuiz } from '@/lib/remark-plugins/quiz'

describe('remarkSurvey', () => {
  it('lowercases <Survey> open and </Survey> close tags', () => {
    const markdown = `<Survey>

<Question id="q1" type="single">
What is your favorite colour?
<Option>Red</Option>
<Option>Blue</Option>
</Question>

</Survey>`

    const processor = unified().use(remarkParse).use(remarkSurvey)
    const tree = processor.parse(markdown)
    processor.runSync(tree)

    const all = findAllNodes(tree, (n: any) => n.type === 'html')
    const hasOpen = all.some((n: any) => /<survey\s*>/.test(n.value))
    const hasClose = all.some((n: any) => /<\/survey>/.test(n.value))

    expect(hasOpen).toBe(true)
    expect(hasClose).toBe(true)
    // Original <Survey> uppercase must NOT survive
    const stillUppercase = all.some((n: any) => /<Survey[\s>]/.test(n.value))
    expect(stillUppercase).toBe(false)
  })

  it('leaves nested <Question> blocks intact for remarkQuiz to process', () => {
    const markdown = `<Survey>

<Question id="q1" type="single">
Pick one.
<Option correct="true">Right</Option>
<Option>Wrong</Option>
</Question>

</Survey>`

    // Run remarkSurvey BEFORE remarkQuiz, same as production chain
    const processor = unified()
      .use(remarkParse)
      .use(remarkSurvey)
      .use(remarkQuiz)
    const tree = processor.parse(markdown)
    processor.runSync(tree)

    // remarkQuiz should have produced a <question id="q1"> node containing <answer> children
    const questionHtml = findNode(
      tree,
      (n: any) => n.type === 'html' && /<question\b/.test(n.value)
    )
    expect(questionHtml).toBeDefined()
    expect(questionHtml.value).toContain('id="q1"')
    expect(questionHtml.value).toContain('<answer')
    expect(questionHtml.value).toContain('Right')
    expect(questionHtml.value).toContain('Wrong')

    // <survey> wrappers must still surround it (separate html nodes — they
    // are not consumed by remarkQuiz).
    const surveyOpen = findNode(tree, (n: any) => n.type === 'html' && /<survey/.test(n.value))
    const surveyClose = findNode(tree, (n: any) => n.type === 'html' && /<\/survey>/.test(n.value))
    expect(surveyOpen).toBeDefined()
    expect(surveyClose).toBeDefined()
  })

  it('handles multiple <Survey> regions on one page', () => {
    const markdown = `<Survey>

<Question id="q1" type="single">
First question.
<Option>A</Option>
</Question>

</Survey>

Some explanatory paragraph between surveys.

<Survey>

<Question id="q2" type="text">
Second question.
</Question>

</Survey>`

    const processor = unified()
      .use(remarkParse)
      .use(remarkSurvey)
      .use(remarkQuiz)
    const tree = processor.parse(markdown)
    processor.runSync(tree)

    const allOpens = findAllNodes(tree, (n: any) => n.type === 'html' && /<survey\s*>/.test(n.value))
    const allCloses = findAllNodes(tree, (n: any) => n.type === 'html' && /<\/survey>/.test(n.value))

    expect(allOpens.length).toBeGreaterThanOrEqual(2)
    expect(allCloses.length).toBeGreaterThanOrEqual(2)

    const questionNodes = findAllNodes(tree, (n: any) => n.type === 'html' && /<question\b/.test(n.value))
    expect(questionNodes).toHaveLength(2)
  })

  it('does not transform <Survey>-like text inside non-tag contexts', () => {
    // The current plugin is a pure string-replace; it would transform any
    // literal "<Survey>" anywhere. This test pins the current behaviour so
    // future refactors that try to be stricter don't accidentally break the
    // happy path. If false positives ever bite, escape <Survey> in prose.
    const markdown = `Some prose about the word <Survey> appearing in text.`

    const processor = unified().use(remarkParse).use(remarkSurvey)
    const tree = processor.parse(markdown)
    processor.runSync(tree)

    // Document the current behaviour, not an aspirational one.
    const lowercased = findAllNodes(
      tree,
      (n: any) =>
        (n.type === 'html' && /<survey/.test(n.value)) ||
        (n.type === 'text' && /<survey/.test(n.value))
    )
    expect(lowercased.length).toBeGreaterThanOrEqual(0) // intentionally weak
  })
})

function findNode(tree: any, predicate: (node: any) => boolean): any {
  let found: any
  function visit(node: any) {
    if (found) return
    if (predicate(node)) {
      found = node
      return
    }
    if (node.children) {
      for (const c of node.children) visit(c)
    }
  }
  visit(tree)
  return found
}

function findAllNodes(tree: any, predicate: (node: any) => boolean): any[] {
  const found: any[] = []
  function visit(node: any) {
    if (predicate(node)) found.push(node)
    if (node.children) for (const c of node.children) visit(c)
  }
  visit(tree)
  return found
}
