import { visit } from 'unist-util-visit'
import type { Root, Text } from 'mdast'

/**
 * Remark plugin that lowercases `<Survey>` / `</Survey>` to `<survey>` /
 * `</survey>` so the renderer maps them to the Survey React component.
 *
 * The wrapper is a region marker only — `<Question>` children inside are
 * left untouched for `remarkQuiz` to process as normal quiz blocks (this
 * plugin runs BEFORE `remarkQuiz` in the chain).
 *
 * Authors write the tag in two ways:
 *  - Self-closing: `<Survey />`  (rare, only when there are no children;
 *    `expandSelfClosingTags` in markdown-compiler.ts has already expanded
 *    this to `<Survey></Survey>` before parsing).
 *  - Block-wrapping: `<Survey>` ... `<Question>` ... `</Question>` ... `</Survey>`
 *
 * Multiple `<Survey>` regions on one page are valid and all share the same
 * survey identity (= pageId). This plugin doesn't enforce that — the React
 * provider does.
 */
export function remarkSurvey() {
  return function transformer(tree: Root) {
    visit(tree, (node: any) => {
      if (node.type === 'html') {
        const value: string = node.value || ''
        if (value.includes('Survey')) {
          node.value = value
            .replace(/<Survey(\s*)>/g, '<survey$1>')
            .replace(/<\/Survey>/g, '</survey>')
        }
      } else if (node.type === 'paragraph' && Array.isArray(node.children)) {
        for (const child of node.children) {
          if (child.type === 'text') {
            const text = (child as Text).value
            if (text.includes('Survey')) {
              ;(child as Text).value = text
                .replace(/<Survey(\s*)>/g, '<survey$1>')
                .replace(/<\/Survey>/g, '</survey>')
            }
          }
        }
      }
    })
  }
}
