// Lightweight, non-interactive stand-in shown by DeferredMount until a code
// editor scrolls near the viewport and the real (heavy) CodeEditor mounts.
// Renders the source as a static <pre> inside editor-like chrome so the page
// reads correctly, stays SEO/print-friendly, and the swap is visually quiet.
// No CodeMirror, no effects, no runtime — that's the whole point.

const LANGUAGE_LABELS: Record<string, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  sql: 'SQL',
  html: 'HTML',
}

export function CodeEditorPlaceholder({
  code,
  language,
}: {
  code: string
  language: string
}) {
  return (
    <div
      className="code-editor-placeholder rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 overflow-hidden"
      aria-busy="true"
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
        <span>{LANGUAGE_LABELS[language] ?? language}</span>
        <span className="opacity-60">Loading editor…</span>
      </div>
      <pre className="m-0 p-3 overflow-x-auto text-sm leading-5 font-mono text-gray-700 dark:text-gray-300 whitespace-pre">
        <code>{code}</code>
      </pre>
    </div>
  )
}
