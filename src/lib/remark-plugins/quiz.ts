import { visit } from 'unist-util-visit'
import type { Root, RootContent, BlockContent, Paragraph, Text } from 'mdast'

/**
 * Remark plugin to transform Quiz Question/Option components
 *
 * Handles the same problem as Tabs - indented content inside HTML-like tags
 * gets treated as code blocks by the markdown parser.
 */
export function remarkQuiz() {
  return function transformer(tree: Root) {
    // Pass 0 — lowercase <question> free-text auto-check.
    // The PascalCase collection below serializes a Question block and pulls out
    // its ```expected fenced block (lib/markdown-components reads `expected`
    // ONLY from the data-expected attribute). But lowercase <question> — the
    // form the MCP/AI guidance and most authored content use — is NOT collected
    // there; it passes straight through to rehype. So a ```expected block inside
    // a lowercase <question> never gets hoisted: it renders as a visible code
    // block (the solution leaks) AND data-expected is never set (auto-grading
    // silently off). Hoist it here, surgically: encode a code(lang=expected)
    // node that sits between a lowercase `<question ...>` open tag and its
    // `</question>` close into data-expected on the open tag, then drop the
    // node. Case-sensitive so PascalCase keeps its own path; choice questions
    // (no expected block) are untouched.
    const expectedToHoist: { parent: any; codeIndex: number; openNode: any }[] = []
    visit(tree, (node: any, index, parent) => {
      if (node.type !== 'code' || node.lang !== 'expected') return
      if (!parent || index === undefined) return
      let openNode: any = null
      for (let i = index - 1; i >= 0; i--) {
        const sib = parent.children[i]
        const v = sib?.type === 'html' ? sib.value : ''
        if (typeof v !== 'string') continue
        if (/<\/question>/.test(v)) break // a prior question already closed
        if (/<question\b/.test(v) && !/<\/question>/.test(v)) { openNode = sib; break }
      }
      if (openNode) expectedToHoist.push({ parent, codeIndex: index, openNode })
    })
    // Splice in reverse so earlier indices stay valid.
    for (let i = expectedToHoist.length - 1; i >= 0; i--) {
      const { parent, codeIndex, openNode } = expectedToHoist[i]
      const codeNode = parent.children[codeIndex]
      if (!/data-expected=/.test(openNode.value)) {
        const encoded = encodeURIComponent(codeNode.value ?? '')
        openNode.value = openNode.value.replace(/(<question\b[^>]*?)>/, `$1 data-expected="${encoded}">`)
      }
      parent.children.splice(codeIndex, 1)
    }

    // Collect nodes that form Question blocks
    const nodesToProcess: { startIndex: number; endIndex: number; parent: any }[] = []

    // Find Question blocks
    visit(tree, (node: any, index, parent) => {
      if (node.type !== 'html' && node.type !== 'paragraph') return
      if (!parent || index === undefined) return

      let text = ''
      if (node.type === 'html') {
        text = node.value
      } else if (node.type === 'paragraph') {
        for (const child of node.children) {
          if (child.type === 'text') {
            text += (child as Text).value
          }
        }
      }

      // Look for the start of a Question block
      if (text.includes('<Question')) {
        let fullContent = serializeNode(node)
        let endIdx = index

        // Check if this node contains the complete Question block
        if (!fullContent.includes('</Question>')) {
          for (let i = index + 1; i < parent.children.length; i++) {
            const nextNode = parent.children[i]
            fullContent += '\n' + serializeNode(nextNode)
            endIdx = i
            if (fullContent.includes('</Question>')) break
          }
        }

        nodesToProcess.push({
          startIndex: index,
          endIndex: endIdx,
          parent
        })
      }
    })

    // Process collected Question blocks in reverse order
    for (let i = nodesToProcess.length - 1; i >= 0; i--) {
      const { startIndex, endIndex, parent } = nodesToProcess[i]

      // Collect full content. A ```expected fenced block (free-text auto-check)
      // is pulled out here as a `code` node so its whitespace/blank lines
      // survive verbatim, and excluded from the prompt text.
      let fullContent = ''
      let expectedRaw: string | undefined
      for (let j = startIndex; j <= endIndex; j++) {
        const node = parent.children[j]
        if (node.type === 'code' && node.lang === 'expected') {
          expectedRaw = node.value ?? ''
          continue
        }
        fullContent += (fullContent ? '\n' : '') + serializeNode(node)
      }

      // Parse the Question block
      const result = parseQuestionBlock(fullContent)
      if (result) {
        const { attrs, options, prompt } = result
        if (expectedRaw !== undefined) attrs.expected = expectedRaw

        // Create answer elements
        // Note: use "correct" instead of "is" because "is" is a reserved React attribute
        const optionElements: RootContent[] = options.map(opt => ({
          type: 'html',
          value: `<answer${opt.correct ? ` correct="${opt.correct}"` : ''}${opt.feedback ? ` feedback="${escapeAttr(opt.feedback)}"` : ''}>${opt.content}</answer>`
        } as RootContent))

        // Build attributes string with all Question props
        let attrStr = `id="${attrs.id}"`
        if (attrs.type) attrStr += ` type="${attrs.type}"`
        if (attrs.showFeedback) attrStr += ` showFeedback="${attrs.showFeedback}"`
        if (attrs.minValue) attrStr += ` minValue="${attrs.minValue}"`
        if (attrs.maxValue) attrStr += ` maxValue="${attrs.maxValue}"`
        if (attrs.step) attrStr += ` step="${attrs.step}"`
        if (attrs.minLabel) attrStr += ` minLabel="${escapeAttr(attrs.minLabel)}"`
        if (attrs.maxLabel) attrStr += ` maxLabel="${escapeAttr(attrs.maxLabel)}"`
        if (attrs.points) attrStr += ` points="${attrs.points}"`
        // encodeURIComponent → only attribute-safe chars (no quotes/newlines),
        // so multi-line expected output round-trips through HTML + sanitize.
        if (attrs.expected !== undefined) attrStr += ` data-expected="${encodeURIComponent(attrs.expected)}"`
        if (attrs.ignoreCase) attrStr += ` ignore-case="${attrs.ignoreCase}"`
        if (attrs.ignoreWhitespace) attrStr += ` ignore-whitespace="${attrs.ignoreWhitespace}"`

        // For choice questions: inner content = <answer> children.
        // For text/number/range questions: inner content = the prompt text
        // (which the Question component reads as `children` and renders below
        // the input). Required for surveys, which need free-text prompts.
        const isChoice = !attrs.type || attrs.type === 'single' || attrs.type === 'multiple'
        const innerContent = isChoice
          ? optionElements.map(o => (o as any).value).join('\n')
          : (prompt ?? '').trim()

        // Create the question wrapper
        const questionHtml: RootContent = {
          type: 'html',
          value: `<question ${attrStr}>\n${innerContent}\n</question>`
        }

        // Replace the nodes
        parent.children.splice(startIndex, endIndex - startIndex + 1, questionHtml)
      }
    }
  }
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;')
}

function serializeNode(node: any): string {
  if (node.type === 'html') {
    return node.value || ''
  }
  if (node.type === 'text') {
    return node.value || ''
  }
  if (node.type === 'paragraph') {
    return node.children?.map(serializeNode).join('') || ''
  }
  if (node.type === 'code') {
    // Code blocks inside Question - return as text
    return node.value || ''
  }
  if ('children' in node && Array.isArray(node.children)) {
    return node.children.map(serializeNode).join('')
  }
  if ('value' in node) {
    return String(node.value)
  }
  return ''
}

interface ParsedOption {
  correct?: string
  feedback?: string
  content: string
}

interface QuestionAttributes {
  id: string
  type?: string
  showFeedback?: string
  minValue?: string
  maxValue?: string
  step?: string
  minLabel?: string
  maxLabel?: string
  // Free-text auto-check (predict-the-output): max points for partial credit,
  // and normalization flags. `expected` is the raw expected output, captured
  // from a ```expected fenced block (not an attribute) so whitespace survives.
  points?: string
  expected?: string
  ignoreCase?: string
  ignoreWhitespace?: string
}

function parseQuestionBlock(content: string): { attrs: QuestionAttributes; options: ParsedOption[]; prompt?: string } | null {
  // Extract Question attributes
  const questionMatch = content.match(/<Question\s+([^>]*)>/)
  if (!questionMatch) return null

  const attrString = questionMatch[1]
  const idMatch = attrString.match(/id=["']([^"']+)["']/)
  const typeMatch = attrString.match(/type=["']([^"']+)["']/)
  const showFeedbackMatch = attrString.match(/showFeedback=["']([^"']+)["']/)
  const minValueMatch = attrString.match(/minValue=["']([^"']+)["']/)
  const maxValueMatch = attrString.match(/maxValue=["']([^"']+)["']/)
  const stepMatch = attrString.match(/step=["']([^"']+)["']/)
  const minLabelMatch = attrString.match(/minLabel=["']([^"']+)["']/)
  const maxLabelMatch = attrString.match(/maxLabel=["']([^"']+)["']/)
  const pointsMatch = attrString.match(/points=["']([^"']+)["']/)
  const ignoreCaseMatch = attrString.match(/ignore-?case=["']([^"']+)["']/i)
  const ignoreWhitespaceMatch = attrString.match(/ignore-?whitespace=["']([^"']+)["']/i)

  // Auto-generate ID from content hash when no explicit id provided
  const fallbackId = (() => {
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return `q-${Math.abs(hash).toString(36)}`
  })()

  const attrs: QuestionAttributes = {
    id: idMatch ? idMatch[1] : fallbackId,
    type: typeMatch?.[1],
    showFeedback: showFeedbackMatch?.[1],
    minValue: minValueMatch?.[1],
    maxValue: maxValueMatch?.[1],
    step: stepMatch?.[1],
    minLabel: minLabelMatch?.[1],
    maxLabel: maxLabelMatch?.[1],
    points: pointsMatch?.[1],
    ignoreCase: ignoreCaseMatch?.[1],
    ignoreWhitespace: ignoreWhitespaceMatch?.[1],
  }

  // Extract options
  const options: ParsedOption[] = []
  const optionRegex = /<Option\s*([^>]*)>([\s\S]*?)<\/Option>/g
  let match

  while ((match = optionRegex.exec(content)) !== null) {
    const optAttrs = match[1]
    const optContent = match[2].trim()

    // TODO(2026-07): Remove legacy "is" fallback once all existing content uses correct="true"
    const correctMatch = optAttrs.match(/correct=["']([^"']+)["']/) || optAttrs.match(/is=["']([^"']+)["']/)
    const feedbackMatch = optAttrs.match(/feedback=["']([^"']+)["']/)

    // Normalize: is="correct" (legacy) and correct="true" both mean correct
    const correctRaw = correctMatch?.[1]
    const isCorrectOption = correctRaw === 'true' || correctRaw === 'correct'

    options.push({
      correct: isCorrectOption ? 'true' : correctRaw,
      feedback: feedbackMatch?.[1],
      content: optContent
    })
  }

  // For non-choice types (text/number/range), the inner content is the
  // prompt itself rather than option blocks. Extract everything between
  // <Question> and </Question>, stripped of any (unexpected) <Option> tags.
  const isChoice = !attrs.type || attrs.type === 'single' || attrs.type === 'multiple'
  let prompt: string | undefined
  if (!isChoice) {
    const innerMatch = content.match(/<Question\s+[^>]*>([\s\S]*?)<\/Question>/)
    if (innerMatch) {
      prompt = innerMatch[1].replace(/<Option[\s\S]*?<\/Option>/g, '').trim()
    }
  }

  // Choice questions require at least one option; non-choice types do not.
  if (isChoice && options.length === 0) return null

  return { attrs, options, prompt }
}
