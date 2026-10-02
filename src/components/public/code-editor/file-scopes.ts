/**
 * Pure helpers for moving Python files between an editor's local files and the
 * shared import stores (skript / global scope, record type 'python-imports'),
 * plus the `toolbox="befehle.py"` editor attribute.
 *
 * Why they exist: while the student types, code-editor/index.tsx updates only
 * `filesRef` / `skriptImportsRef` (not React state, to keep CodeMirror focus).
 * Any operation that copies a file therefore has to read the LIVE buffer, not
 * the `files` state; reading state copied the starter text (bug: "Move to
 * Skript scope" right after typing produced a file containing '# New file').
 *
 * Related: index.tsx (makeImport, debouncedSaveContent, the toolbox tab),
 * src/lib/remark-plugins/code-editor.ts (parses `toolbox=`),
 * src/lib/markdown-components.tsx (validates it).
 */

import type { PythonFile } from './types'

/** Content of a toolbox file the first time the student edits it. German: course text for MOP-7. */
export const TOOLBOX_DEFAULT_CONTENT = '# Ihre Werkzeugkiste\n'

/**
 * Normalise the markdown `toolbox` attribute to a file name, or undefined when
 * it is not an importable Python module name ("befehle" -> "befehle.py").
 */
export function parseToolboxName(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const name = raw.trim().endsWith('.py') ? raw.trim() : `${raw.trim()}.py`
  return /^[A-Za-z_][A-Za-z0-9_]*\.py$/.test(name) ? name : undefined
}

/** Module name Python imports for a toolbox file ("befehle.py" -> "befehle"). */
export function toolboxModule(toolbox: string): string {
  return toolbox.replace(/\.py$/, '')
}

/**
 * True when a run failed because the toolbox module does not exist yet.
 * `name` is ModuleNotFoundError.name when the Kara runner reports it; otherwise
 * the message is parsed (plain Pyodide / Skulpt runs).
 */
export function isToolboxModuleError(
  error: { sub?: string | null; name?: string; message?: string } | null | undefined,
  toolbox: string | undefined,
): boolean {
  if (!error || !toolbox) return false
  const mod = toolboxModule(toolbox)
  if (error.name) return error.sub === 'module' && error.name === mod
  // Pyodide: "No module named 'befehle'"; Skulpt: "No module named befehle".
  return new RegExp(`No module named '?${mod}'?(?![A-Za-z0-9_])`).test(error.message ?? '')
}

/** Replace the content of `name` in an import store, appending the file when it does not exist yet. */
export function upsertImportFile(files: PythonFile[], name: string, content: string): PythonFile[] {
  return files.some(f => f.name === name)
    ? files.map(f => (f.name === name ? { ...f, content } : f))
    : [...files, { name, content }]
}

export type MoveToImportsResult =
  | { ok: true; localFiles: PythonFile[]; importFiles: PythonFile[]; moved: PythonFile }
  | { ok: false; reason: 'missing' | 'duplicate' }

/**
 * Move local file `index` into an import store.
 * `liveContent` is the CodeMirror buffer when that file is the open tab
 * (it wins over the stored content), else null.
 */
export function moveLocalToImports(
  localFiles: PythonFile[],
  index: number,
  liveContent: string | null,
  importFiles: PythonFile[],
): MoveToImportsResult {
  const file = localFiles[index]
  if (!file) return { ok: false, reason: 'missing' }
  if (importFiles.some(f => f.name === file.name)) return { ok: false, reason: 'duplicate' }
  const moved = { name: file.name, content: liveContent ?? file.content }
  return {
    ok: true,
    localFiles: localFiles.filter((_, i) => i !== index),
    importFiles: [...importFiles, moved],
    moved,
  }
}
