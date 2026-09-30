/**
 * Marks the line of the current Kara replay step in CodeMirror and shows the
 * step's sensor results / error message inline at the end of that line.
 * Driven by KaraPanel via `setKaraLine`; any document edit clears it (the
 * trace no longer matches the code).
 */
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

export interface KaraLineTarget {
  line: number
  /** Sensor calls made while this line ran: [name, result]. */
  sensors?: [string, boolean][]
  /** Set on the error step (last position of a run that raised). */
  error?: string
}

export const setKaraLine = StateEffect.define<KaraLineTarget | null>()

const stepLine = Decoration.line({ class: 'cm-kara-line' })
const errorLine = Decoration.line({ class: 'cm-kara-error-line' })

class KaraNotesWidget extends WidgetType {
  constructor(readonly sensors: [string, boolean][], readonly error: string | undefined) { super() }

  eq(other: KaraNotesWidget) {
    return other.error === this.error && JSON.stringify(other.sensors) === JSON.stringify(this.sensors)
  }

  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-kara-notes'
    for (const [name, result] of this.sensors) {
      const chip = document.createElement('span')
      chip.className = result ? 'cm-kara-note cm-kara-note-true' : 'cm-kara-note cm-kara-note-false'
      chip.textContent = `${name}() → ${result ? 'True' : 'False'}`
      wrap.appendChild(chip)
    }
    if (this.error) {
      const err = document.createElement('span')
      err.className = 'cm-kara-note cm-kara-note-error'
      err.textContent = this.error
      wrap.appendChild(err)
    }
    return wrap
  }

  ignoreEvent() { return true }
}

const karaLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setKaraLine)) continue
      const t = e.value
      if (!t || t.line < 1 || t.line > tr.state.doc.lines) return Decoration.none
      const line = tr.state.doc.line(t.line)
      const ranges = [(t.error ? errorLine : stepLine).range(line.from)]
      if (t.sensors?.length || t.error) {
        ranges.push(Decoration.widget({ widget: new KaraNotesWidget(t.sensors ?? [], t.error), side: 1 }).range(line.to))
      }
      return Decoration.set(ranges)
    }
    return tr.docChanged ? Decoration.none : deco
  },
  provide: f => EditorView.decorations.from(f),
})

const karaLineTheme = EditorView.baseTheme({
  '&light .cm-line.cm-kara-line': { backgroundColor: 'rgba(250, 204, 21, 0.35)' },
  '&dark .cm-line.cm-kara-line': { backgroundColor: 'rgba(250, 204, 21, 0.2)' },
  '&light .cm-line.cm-kara-error-line': { backgroundColor: 'rgba(239, 68, 68, 0.25)' },
  '&dark .cm-line.cm-kara-error-line': { backgroundColor: 'rgba(239, 68, 68, 0.25)' },
  '.cm-kara-notes': { marginLeft: '1.5em', fontSize: '0.85em' },
  '.cm-kara-note': { borderRadius: '4px', padding: '0 0.4em', marginRight: '0.3em' },
  '&light .cm-kara-note-true': { backgroundColor: '#dcfce7', color: '#166534' },
  '&dark .cm-kara-note-true': { backgroundColor: 'rgba(20, 83, 45, 0.6)', color: '#86efac' },
  '&light .cm-kara-note-false': { backgroundColor: '#e2e8f0', color: '#334155' },
  '&dark .cm-kara-note-false': { backgroundColor: '#1e293b', color: '#cbd5e1' },
  '&light .cm-kara-note-error': { color: '#b91c1c', fontFamily: 'sans-serif' },
  '&dark .cm-kara-note-error': { color: '#f87171', fontFamily: 'sans-serif' },
})

export function karaLineHighlighting() {
  return [karaLineField, karaLineTheme]
}

/** Highlight `target.line` (or clear with null) and scroll it into view. */
export function showKaraLine(view: EditorView, target: KaraLineTarget | null) {
  const effects: StateEffect<unknown>[] = [setKaraLine.of(target)]
  if (target && target.line >= 1 && target.line <= view.state.doc.lines) {
    effects.push(EditorView.scrollIntoView(view.state.doc.line(target.line).from, { y: 'nearest' }))
  }
  view.dispatch({ effects })
}
