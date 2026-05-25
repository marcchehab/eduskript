/**
 * Splits an exam/page markdown document into sequential stages at `<next-stage>`
 * markers, for the staged hand-in flow (see StageFlow). Each marker must sit on
 * its own line at the top level; markers inside fenced code blocks are ignored
 * so a `<next-stage>` shown as example code doesn't split the document.
 *
 *   stage 0 text
 *   <next-stage label="Continue">
 *   stage 1 text
 *
 * → { stages: ['stage 0 text', 'stage 1 text'], markers: [{ label: 'Continue' }] }
 *
 * `markers[i]` describes the boundary between `stages[i]` and `stages[i+1]`, so
 * `markers.length === stages.length - 1`. With no marker, returns the whole
 * document as a single stage and no markers.
 */
export interface StageMarker {
  /** Advance button text (and the modal's confirm button). */
  label?: string
  /** Modal title. */
  title?: string
  /** Modal body / warning. */
  confirm?: string
  /** Modal cancel button text. */
  cancel?: string
}

export interface SplitStagesResult {
  stages: string[]
  markers: StageMarker[]
}

const MARKER_LINE = /^\s*<next-stage\b([^>]*)\/?>\s*$/i
const FENCE_LINE = /^\s*(```|~~~)/

function attr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'))
  return m ? m[1] : undefined
}

export function splitStages(content: string): SplitStagesResult {
  const lines = content.split('\n')
  const stages: string[] = []
  const markers: StageMarker[] = []
  let current: string[] = []
  let inFence = false

  for (const line of lines) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence
      current.push(line)
      continue
    }
    const m = !inFence ? line.match(MARKER_LINE) : null
    if (m) {
      stages.push(current.join('\n'))
      markers.push({
        label: attr(m[1], 'label'),
        title: attr(m[1], 'title'),
        confirm: attr(m[1], 'confirm'),
        cancel: attr(m[1], 'cancel'),
      })
      current = []
    } else {
      current.push(line)
    }
  }
  stages.push(current.join('\n'))

  return { stages, markers }
}

/** Cheap check used to decide whether to mount the staged renderer at all. */
export function hasStages(content: string): boolean {
  return /<next-stage\b/i.test(content)
}
