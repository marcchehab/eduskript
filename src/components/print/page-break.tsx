/**
 * `<pagebreak />`: the next content starts on a new printed page. Invisible
 * online; a dashed line in the editor preview; in the print view the
 * paginator (print-view.tsx) gives it the height that fills the page and
 * print CSS turns it into a forced break (globals.css, .print-pagebreak).
 *
 * A <span> (display:block via CSS), not a <div>: consecutive tags or a tag
 * next to text end up inside a <p>, where a <div> is invalid HTML.
 */
export function PageBreak({ editor, line }: { editor?: boolean; line?: string }) {
  if (editor) {
    return (
      <span className="my-4 flex items-center gap-2 text-xs text-muted-foreground" aria-label="Page break">
        <span className="flex-1 border-t-2 border-dashed border-border" />
        Page break
        <span className="flex-1 border-t-2 border-dashed border-border" />
      </span>
    )
  }
  // data-source-line-start: the print preview's "Page break ×" (print-edit-overlay.tsx).
  return <span className="print-pagebreak" data-pagebreak="" data-source-line-start={line} aria-hidden="true" />
}
