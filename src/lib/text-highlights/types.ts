export type TextHighlightColor = 'yellow' | 'red' | 'green' | 'blue' | 'purple'

export interface TextHighlight {
  id: string
  text: string        // The highlighted text
  prefix: string      // ~30 chars before for disambiguation
  suffix: string      // ~30 chars after
  sectionId: string   // data-section-id of nearest heading ('' if none)
  color: TextHighlightColor
  createdAt: number
}

export interface TextHighlightsData {
  highlights: TextHighlight[]
}
