import { linter, type Diagnostic } from '@codemirror/lint'
import type { EditorView } from '@codemirror/view'
import { findQuestionsWithoutId } from '@/lib/question-ids'
import { generateBlockId } from './markdown-completions'

const MESSAGE =
  'This question has no id. Questions without an id share one stored answer on this page, and exam grading skips them. '
  + 'Adding an id starts this question with no saved answers.'

/** Warnings for src/lib/question-ids.ts, with an action that inserts a new id. */
export function questionIdDiagnostics(doc: string): Diagnostic[] {
  return findQuestionsWithoutId(doc).map(({ from, to, idInsertAt }) => ({
    from,
    to,
    severity: 'warning',
    message: MESSAGE,
    actions: [{
      name: 'Add id',
      // `start` is the diagnostic's current position, which moves with edits made
      // since the lint run. The offset of the insertion within the tag does not.
      apply: (view: EditorView, start: number) => {
        const at = start + (idInsertAt - from)
        view.dispatch({ changes: { from: at, insert: ` id="${generateBlockId()}"` } })
      },
    }],
  }))
}

export const questionIdLinter = linter((view) => questionIdDiagnostics(view.state.doc.toString()))
