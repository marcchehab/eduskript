/** Legacy fixed colours (pre-highlighter-pen). New highlights store an
 *  arbitrary CSS colour string; these names still render via globals.css vars. */
export type TextHighlightColor = 'yellow' | 'red' | 'green' | 'blue' | 'purple'

export interface TextHighlight {
  id: string
  text: string        // The highlighted text
  prefix: string      // ~30 chars before for disambiguation
  suffix: string      // ~30 chars after
  sectionId: string   // data-section-id of nearest heading ('' if none)
  /** A CSS colour (e.g. `hsl(48 85% 55%)`) or a legacy name (yellow/red/…). */
  color: string
  createdAt: number
}

export interface TextHighlightsData {
  highlights: TextHighlight[]
}
