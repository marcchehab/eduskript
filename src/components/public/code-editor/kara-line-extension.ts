/**
 * Marks the line of the current Kara replay step in CodeMirror and shows the
 * step's helper frame (an action inside e.g. befehle.py: '↳ drei_vor() ·
 * befehle.py:3'), sensor results, a door-code answer ('door: zaehle_faesser() → 4')
 * and error message inline at the end of that line.
 * Static findings (lints) get a violet tint and a chip on their own lines.
 * Driven by KaraPanel via `setKaraLine`; any document edit clears it (the
 * trace no longer matches the code).
 */
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

export interface KaraLintNote {
  line: number
  /** Short English chip text, e.g. 'turn_right is not called: add ()'. */
  note: string
}

export interface KaraLineTarget {
  /** Current step's line; absent when only lint notes are shown (run without steps). */
  line?: number
  /** Sensor calls made while this line ran: [name, result]. */
  sensors?: [string, boolean][]
  /** Door code asked on this step: [function, repr(answer), accepted] (KaraStep.q). */
  door?: [string, string, boolean]
  /** Set on the error step (last position of a run that raised). */
  error?: string
  /** Helper frame the step's action ran in, e.g. 'drei_vor() · befehle.py:3'. */
  via?: string
  /** Static findings (end of a run that did not win): own line tint + chip. */
  lints?: KaraLintNote[]
}

export const setKaraLine = StateEffect.define<KaraLineTarget | null>()

const stepLine = Decoration.line({ class: 'cm-kara-line' })
const errorLine = Decoration.line({ class: 'cm-kara-error-line' })
const lintLine = Decoration.line({ class: 'cm-kara-lint-line' })

class KaraLintWidget extends WidgetType {
  constructor(readonly notes: string[]) { super() }

  eq(other: KaraLintWidget) {
    return other.notes.join('\n') === this.notes.join('\n')
  }

  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-kara-notes'
    for (const text of this.notes) {
      const chip = document.createElement('span')
      chip.className = 'cm-kara-note cm-kara-note-lint'
      chip.textContent = `⚠ ${text}`
      chip.title = 'AURORA found this before the run (static check)'
      wrap.appendChild(chip)
    }
    return wrap
  }

  ignoreEvent() { return true }
}

class KaraNotesWidget extends WidgetType {
  constructor(
    readonly sensors: [string, boolean][],
    readonly error: string | undefined,
    readonly via: string | undefined,
    readonly door: [string, string, boolean] | undefined,
  ) { super() }

  eq(other: KaraNotesWidget) {
    return other.error === this.error && other.via === this.via
      && JSON.stringify(other.sensors) === JSON.stringify(this.sensors) && JSON.stringify(other.door) === JSON.stringify(this.door)
  }

  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-kara-notes'
    if (this.via) {
      const via = document.createElement('span')
      via.className = 'cm-kara-note cm-kara-note-via'
      via.textContent = `↳ ${this.via}`
      via.title = 'Running inside this function (step over: the marker stays on the call)'
      wrap.appendChild(via)
    }
    for (const [name, result] of this.sensors) {
      const chip = document.createElement('span')
      chip.className = result ? 'cm-kara-note cm-kara-note-true' : 'cm-kara-note cm-kara-note-false'
      chip.textContent = `${name}() → ${result ? 'True' : 'False'}`
      wrap.appendChild(chip)
    }
    if (this.door) {
      const [name, answer, ok] = this.door
      const chip = document.createElement('span')
      chip.className = ok ? 'cm-kara-note cm-kara-note-true' : 'cm-kara-note cm-kara-note-door-wrong'
      chip.textContent = `door: ${name}() → ${answer} ${ok ? '✓' : '✗'}`
      chip.title = ok ? 'The door asked this function and accepted the answer' : 'The door asked this function and rejected the answer'
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
      if (!t) return Decoration.none
      const doc = tr.state.doc
      const ranges = []
      if (t.line && t.line >= 1 && t.line <= doc.lines) {
        const line = doc.line(t.line)
        ranges.push((t.error ? errorLine : stepLine).range(line.from))
        if (t.sensors?.length || t.error || t.via || t.door) {
          ranges.push(Decoration.widget({ widget: new KaraNotesWidget(t.sensors ?? [], t.error, t.via, t.door), side: 1 }).range(line.to))
        }
      }
      // Lint notes grouped per line; the lint tint only where no step/error tint is.
      const byLine = new Map<number, string[]>()
      for (const n of t.lints ?? []) {
        if (n.line >= 1 && n.line <= doc.lines) byLine.set(n.line, [...(byLine.get(n.line) ?? []), n.note])
      }
      for (const [n, notes] of byLine) {
        const line = doc.line(n)
        if (n !== t.line) ranges.push(lintLine.range(line.from))
        ranges.push(Decoration.widget({ widget: new KaraLintWidget(notes), side: 2 }).range(line.to))
      }
      return Decoration.set(ranges, true)
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
  '&light .cm-kara-note-door-wrong': { backgroundColor: '#fee2e2', color: '#991b1b' },
  '&dark .cm-kara-note-door-wrong': { backgroundColor: 'rgba(127, 29, 29, 0.5)', color: '#fca5a5' },
  '.cm-kara-note-via': { fontFamily: 'sans-serif', fontStyle: 'italic' },
  '&light .cm-kara-note-via': { color: '#92400e', backgroundColor: 'rgba(250, 204, 21, 0.25)' },
  '&dark .cm-kara-note-via': { color: '#fcd34d', backgroundColor: 'rgba(250, 204, 21, 0.12)' },
  '&light .cm-kara-note-error': { color: '#b91c1c', fontFamily: 'sans-serif' },
  '&dark .cm-kara-note-error': { color: '#f87171', fontFamily: 'sans-serif' },
  '&light .cm-line.cm-kara-lint-line': { backgroundColor: 'rgba(168, 85, 247, 0.14)' },
  '&dark .cm-line.cm-kara-lint-line': { backgroundColor: 'rgba(168, 85, 247, 0.18)' },
  '.cm-kara-note-lint': { fontFamily: 'sans-serif' },
  '&light .cm-kara-note-lint': { color: '#6b21a8', backgroundColor: 'rgba(168, 85, 247, 0.14)' },
  '&dark .cm-kara-note-lint': { color: '#d8b4fe', backgroundColor: 'rgba(168, 85, 247, 0.2)' },
})

export function karaLineHighlighting() {
  return [karaLineField, karaLineTheme]
}

/** Highlight `target.line` and lint lines (or clear with null) and scroll the step line (else the first lint) into view. */
export function showKaraLine(view: EditorView, target: KaraLineTarget | null) {
  const effects: StateEffect<unknown>[] = [setKaraLine.of(target)]
  const line = target?.line ?? target?.lints?.[0]?.line
  if (line && line >= 1 && line <= view.state.doc.lines) {
    effects.push(EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'nearest' }))
  }
  view.dispatch({ effects })
}
