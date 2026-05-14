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

      // Collect full content
      let fullContent = ''
      for (let j = startIndex; j <= endIndex; j++) {
        const node = parent.children[j]
        fullContent += (fullContent ? '\n' : '') + serializeNode(node)
      }

      // Parse the Question block
      const result = parseQuestionBlock(fullContent)
      if (result) {
        const { attrs, options, prompt } = result

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
        if (attrs.allowUpdate) attrStr += ` allowUpdate="${attrs.allowUpdate}"`
        if (attrs.minValue) attrStr += ` minValue="${attrs.minValue}"`
        if (attrs.maxValue) attrStr += ` maxValue="${attrs.maxValue}"`
        if (attrs.step) attrStr += ` step="${attrs.step}"`
        if (attrs.minLabel) attrStr += ` minLabel="${escapeAttr(attrs.minLabel)}"`
        if (attrs.maxLabel) attrStr += ` maxLabel="${escapeAttr(attrs.maxLabel)}"`

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
  allowUpdate?: string
  minValue?: string
  maxValue?: string
  step?: string
  minLabel?: string
  maxLabel?: string
}

function parseQuestionBlock(content: string): { attrs: QuestionAttributes; options: ParsedOption[]; prompt?: string } | null {
  // Extract Question attributes
  const questionMatch = content.match(/<Question\s+([^>]*)>/)
  if (!questionMatch) return null

  const attrString = questionMatch[1]
  const idMatch = attrString.match(/id=["']([^"']+)["']/)
  const typeMatch = attrString.match(/type=["']([^"']+)["']/)
  const showFeedbackMatch = attrString.match(/showFeedback=["']([^"']+)["']/)
  const allowUpdateMatch = attrString.match(/allowUpdate=["']([^"']+)["']/)
  const minValueMatch = attrString.match(/minValue=["']([^"']+)["']/)
  const maxValueMatch = attrString.match(/maxValue=["']([^"']+)["']/)
  const stepMatch = attrString.match(/step=["']([^"']+)["']/)
  const minLabelMatch = attrString.match(/minLabel=["']([^"']+)["']/)
  const maxLabelMatch = attrString.match(/maxLabel=["']([^"']+)["']/)

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
    allowUpdate: allowUpdateMatch?.[1],
    minValue: minValueMatch?.[1],
    maxValue: maxValueMatch?.[1],
    step: stepMatch?.[1],
    minLabel: minLabelMatch?.[1],
    maxLabel: maxLabelMatch?.[1],
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
