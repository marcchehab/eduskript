/**
 * Python language server for client-side code intelligence
 * Provides autocomplete, hover info, and basic type inference
 */

import { CompletionContext, CompletionResult } from '@codemirror/autocomplete'

// Python keywords
export const PYTHON_KEYWORDS = [
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
  'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
  'try', 'while', 'with', 'yield'
]

// Python built-in functions with type hints
export const PYTHON_BUILTINS = [
  { label: 'print', type: 'function', info: 'print(*objects, sep=\' \', end=\'\\n\', file=sys.stdout, flush=False)' },
  { label: 'input', type: 'function', info: 'input(prompt=\'\') -> str' },
  { label: 'len', type: 'function', info: 'len(obj) -> int' },
  { label: 'range', type: 'function', info: 'range(stop) or range(start, stop[, step])' },
  { label: 'str', type: 'function', info: 'str(object) -> string' },
  { label: 'int', type: 'function', info: 'int(x, base=10) -> integer' },
  { label: 'float', type: 'function', info: 'float(x) -> float' },
  { label: 'bool', type: 'function', info: 'bool(x) -> bool' },
  { label: 'list', type: 'function', info: 'list() -> new empty list' },
  { label: 'dict', type: 'function', info: 'dict() -> new empty dictionary' },
  { label: 'set', type: 'function', info: 'set() -> new empty set object' },
  { label: 'tuple', type: 'function', info: 'tuple() -> empty tuple' },
  { label: 'abs', type: 'function', info: 'abs(x) -> absolute value' },
  { label: 'max', type: 'function', info: 'max(iterable, *[, default, key])' },
  { label: 'min', type: 'function', info: 'min(iterable, *[, default, key])' },
  { label: 'sum', type: 'function', info: 'sum(iterable, start=0)' },
  { label: 'sorted', type: 'function', info: 'sorted(iterable, *, key=None, reverse=False)' },
  { label: 'reversed', type: 'function', info: 'reversed(sequence)' },
  { label: 'enumerate', type: 'function', info: 'enumerate(iterable, start=0)' },
  { label: 'zip', type: 'function', info: 'zip(*iterables)' },
  { label: 'map', type: 'function', info: 'map(function, iterable, ...)' },
  { label: 'filter', type: 'function', info: 'filter(function, iterable)' },
  { label: 'all', type: 'function', info: 'all(iterable) -> bool' },
  { label: 'any', type: 'function', info: 'any(iterable) -> bool' },
  { label: 'isinstance', type: 'function', info: 'isinstance(obj, class_or_tuple) -> bool' },
  { label: 'type', type: 'function', info: 'type(object) -> type object' },
  { label: 'open', type: 'function', info: 'open(file, mode=\'r\', buffering=-1, encoding=None, ...)' },
  { label: 'round', type: 'function', info: 'round(number, ndigits=None)' },
  { label: 'ord', type: 'function', info: 'ord(c) -> integer' },
  { label: 'chr', type: 'function', info: 'chr(i) -> Unicode character' },
  { label: 'dir', type: 'function', info: 'dir([object]) -> list of strings' },
  { label: 'help', type: 'function', info: 'help([object])' },
  { label: 'getattr', type: 'function', info: 'getattr(object, name[, default])' },
  { label: 'setattr', type: 'function', info: 'setattr(object, name, value)' },
  { label: 'hasattr', type: 'function', info: 'hasattr(object, name) -> bool' },
]

// Turtle graphics methods
export const TURTLE_METHODS = [
  { label: 'forward', type: 'method', info: 'forward(distance) - Move forward by distance' },
  { label: 'backward', type: 'method', info: 'backward(distance) - Move backward by distance' },
  { label: 'right', type: 'method', info: 'right(angle) - Turn right by angle degrees' },
  { label: 'left', type: 'method', info: 'left(angle) - Turn left by angle degrees' },
  { label: 'penup', type: 'method', info: 'penup() - Pull the pen up' },
  { label: 'pendown', type: 'method', info: 'pendown() - Pull the pen down' },
  { label: 'pensize', type: 'method', info: 'pensize(width) - Set pen width' },
  { label: 'pencolor', type: 'method', info: 'pencolor(color) - Set pen color' },
  { label: 'fillcolor', type: 'method', info: 'fillcolor(color) - Set fill color' },
  { label: 'color', type: 'method', info: 'color(pencolor, fillcolor) - Set colors' },
  { label: 'begin_fill', type: 'method', info: 'begin_fill() - Begin filling' },
  { label: 'end_fill', type: 'method', info: 'end_fill() - End filling' },
  { label: 'circle', type: 'method', info: 'circle(radius, extent=None, steps=None)' },
  { label: 'goto', type: 'method', info: 'goto(x, y) - Move to position' },
  { label: 'setx', type: 'method', info: 'setx(x) - Set x coordinate' },
  { label: 'sety', type: 'method', info: 'sety(y) - Set y coordinate' },
  { label: 'setheading', type: 'method', info: 'setheading(angle) - Set heading angle' },
  { label: 'home', type: 'method', info: 'home() - Move to origin (0, 0)' },
  { label: 'clear', type: 'method', info: 'clear() - Clear drawings' },
  { label: 'reset', type: 'method', info: 'reset() - Reset turtle state' },
  { label: 'speed', type: 'method', info: 'speed(speed) - Set animation speed (0-10)' },
  { label: 'position', type: 'method', info: 'position() -> (x, y) tuple' },
  { label: 'heading', type: 'method', info: 'heading() -> current heading angle' },
  { label: 'dot', type: 'method', info: 'dot(size=None, color=None)' },
  { label: 'stamp', type: 'method', info: 'stamp() -> stamp_id' },
  { label: 'write', type: 'method', info: 'write(arg, move=False, align=\'left\', font=(...))' },
]

// Common Python modules and their members
export const PYTHON_MODULES: Record<string, Array<{ label: string, type: string, info: string }>> = {
  'turtle': TURTLE_METHODS,
  'math': [
    { label: 'pi', type: 'constant', info: 'π = 3.141592...' },
    { label: 'e', type: 'constant', info: 'e = 2.718281...' },
    { label: 'sqrt', type: 'function', info: 'sqrt(x) - Square root' },
    { label: 'sin', type: 'function', info: 'sin(x) - Sine of x (in radians)' },
    { label: 'cos', type: 'function', info: 'cos(x) - Cosine of x (in radians)' },
    { label: 'tan', type: 'function', info: 'tan(x) - Tangent of x (in radians)' },
    { label: 'radians', type: 'function', info: 'radians(degrees) - Convert degrees to radians' },
    { label: 'degrees', type: 'function', info: 'degrees(radians) - Convert radians to degrees' },
    { label: 'pow', type: 'function', info: 'pow(x, y) - x raised to power y' },
    { label: 'floor', type: 'function', info: 'floor(x) - Floor of x' },
    { label: 'ceil', type: 'function', info: 'ceil(x) - Ceiling of x' },
  ],
  'random': [
    { label: 'random', type: 'function', info: 'random() -> random float in [0.0, 1.0)' },
    { label: 'randint', type: 'function', info: 'randint(a, b) -> random integer in [a, b]' },
    { label: 'choice', type: 'function', info: 'choice(seq) -> random element from sequence' },
    { label: 'shuffle', type: 'function', info: 'shuffle(x) -> shuffle list x in place' },
    { label: 'uniform', type: 'function', info: 'uniform(a, b) -> random float in [a, b]' },
  ]
}

// --- Types for import-aware completions ---

export interface NamedSource {
  name: string
  content: string
}

interface ParsedImport {
  module: string
  alias: string | null
  names: string[] | '*' | null
}

/**
 * Parse import statements from Python code.
 * Handles: import mod, import mod as alias, from mod import a,b, from mod import *
 */
function parseImports(code: string): ParsedImport[] {
  const imports: ParsedImport[] = []
  let match

  // from module import name1, name2 / from module import *
  const fromImportRegex = /^from\s+(\w+)\s+import\s+(.+)$/gm
  while ((match = fromImportRegex.exec(code)) !== null) {
    const mod = match[1]
    const namesStr = match[2].split('#')[0].trim()
    if (namesStr === '*') {
      imports.push({ module: mod, alias: null, names: '*' })
    } else {
      const names = namesStr.split(',').map(n => n.trim()).filter(Boolean)
      imports.push({ module: mod, alias: null, names })
    }
  }

  // import module / import module as alias (^ + m flag = line start)
  const importRegex = /^import\s+(\w+)(?:\s+as\s+(\w+))?/gm
  while ((match = importRegex.exec(code)) !== null) {
    imports.push({
      module: match[1],
      alias: match[2] || null,
      names: null
    })
  }

  return imports
}

/**
 * Extract user-defined variables, functions, and classes from code
 */
function extractUserDefinitions(code: string): Array<{ label: string, type: string, info: string }> {
  const definitions: Array<{ label: string, type: string, info: string }> = []

  // Match function definitions: def func_name(args):
  const funcRegex = /def\s+(\w+)\s*\((.*?)\)/g
  let match
  while ((match = funcRegex.exec(code)) !== null) {
    definitions.push({
      label: match[1],
      type: 'function',
      info: `def ${match[1]}(${match[2]})`
    })
  }

  // Match class definitions: class ClassName:
  const classRegex = /class\s+(\w+)(?:\s*\(.*?\))?\s*:/g
  while ((match = classRegex.exec(code)) !== null) {
    definitions.push({
      label: match[1],
      type: 'class',
      info: `class ${match[1]}`
    })
  }

  // Match variable assignments (simple heuristic)
  const varRegex = /^(\w+)\s*=/gm
  while ((match = varRegex.exec(code)) !== null) {
    const name = match[1]
    // Skip if it's a keyword or already defined as function/class
    if (!PYTHON_KEYWORDS.includes(name) && !definitions.some(d => d.label === name)) {
      definitions.push({
        label: name,
        type: 'variable',
        info: `variable: ${name}`
      })
    }
  }

  return definitions
}

/**
 * Create a completion function that also indexes symbols from extra code sources
 * (other files in the editor, global/skript import files).
 */
/**
 * `getGlobals`: extra names that exist without an import (e.g. the Kara
 * commands the Kara runner injects); also offered after `kara.` and in
 * `from kara import`.
 */
export function createPythonCompletions(
  getExtraSources: () => NamedSource[],
  getGlobals: () => Array<{ label: string, type: string, info: string }> = () => [],
) {
  return (context: CompletionContext) => pythonCompletions(context, getExtraSources(), getGlobals())
}

/**
 * Main completion function for Python
 */
export function pythonCompletions(
  context: CompletionContext,
  extraSources: NamedSource[] = [],
  globals: Array<{ label: string, type: string, info: string }> = [],
): CompletionResult | null {
  const word = context.matchBefore(/\w*/)
  const code = context.state.doc.toString()
  const beforeCursor = code.slice(0, context.pos)

  const afterDot = beforeCursor.match(/(\w+)\.$/)

  if (!word && !afterDot) {
    return null
  }

  if (word && word.from === word.to && !context.explicit && !afterDot) {
    return null
  }

  // Parse imports from the current file
  const imports = parseImports(code)

  // Build module name → definitions map for user sources
  const sourceMap = new Map<string, Array<{ label: string, type: string, info: string }>>()
  for (const source of extraSources) {
    sourceMap.set(source.name, extractUserDefinitions(source.content))
  }
  if (globals.length && !sourceMap.has('kara')) sourceMap.set('kara', globals)

  // --- Dot-access completions (object.attr) ---
  const dotMatch = beforeCursor.match(/(\w+)\.(\w*)$/)
  if (dotMatch) {
    const objectName = dotMatch[1]
    const from = word && word.from !== word.to ? word.from : context.pos

    // Check imported user modules first (local modules shadow built-ins)
    for (const imp of imports) {
      if (imp.names !== null) continue
      const accessName = imp.alias || imp.module
      if (accessName === objectName && sourceMap.has(imp.module)) {
        return {
          from,
          options: sourceMap.get(imp.module)!.map(item => ({
            label: item.label,
            type: item.type,
            detail: item.info
          }))
        }
      }
    }

    // Check built-in modules
    if (PYTHON_MODULES[objectName]) {
      return {
        from,
        options: PYTHON_MODULES[objectName].map(item => ({
          label: item.label,
          type: item.type,
          detail: item.info
        }))
      }
    }

    // Turtle variable heuristic (e.g. t = turtle.Turtle(); t.forward)
    if (code.includes('import turtle') && (objectName.toLowerCase().includes('turtle') || objectName === 't')) {
      return {
        from,
        options: TURTLE_METHODS.map(item => ({
          label: item.label,
          type: item.type,
          detail: item.info
        }))
      }
    }

    return null
  }

  // --- "from <module> import <name>" — suggest module members ---
  const fromImportMatch = beforeCursor.match(/from\s+(\w+)\s+import\s+\w*$/)
  if (fromImportMatch) {
    const moduleName = fromImportMatch[1]
    const options: Array<{ label: string, type: string, detail?: string }> = []

    if (PYTHON_MODULES[moduleName]) {
      options.push(...PYTHON_MODULES[moduleName].map(item => ({
        label: item.label, type: item.type, detail: item.info
      })))
    }
    if (sourceMap.has(moduleName)) {
      options.push(...sourceMap.get(moduleName)!.map(item => ({
        label: item.label, type: item.type, detail: item.info
      })))
    }
    if (options.length > 0) {
      options.push({ label: '*', type: 'keyword', detail: 'Import all names' })
    }

    return options.length > 0 ? { from: word?.from ?? context.pos, options } : null
  }

  // --- "import <module>" or "from <module>" — suggest module names ---
  if (beforeCursor.match(/import\s+\w*$/) || beforeCursor.match(/from\s+\w*$/)) {
    const moduleNames = new Set([
      ...Object.keys(PYTHON_MODULES),
      ...sourceMap.keys()
    ])
    return {
      from: word?.from ?? context.pos,
      options: Array.from(moduleNames).map(mod => ({
        label: mod,
        type: 'module',
        detail: `module: ${mod}`
      }))
    }
  }

  // --- General completions ---

  // Current file's own definitions (always available)
  const currentFileDefs = extractUserDefinitions(code)

  // Imported definitions from other sources
  const importedDefs: Array<{ label: string, type: string, info: string }> = []

  for (const imp of imports) {
    // Resolve from user sources first, then built-in modules
    const defs = sourceMap.get(imp.module) ?? PYTHON_MODULES[imp.module] ?? null

    if (imp.names === null) {
      // `import mod` or `import mod as alias` → add module name as completion
      const accessName = imp.alias || imp.module
      if (defs) {
        importedDefs.push({ label: accessName, type: 'module', info: `module: ${imp.module}` })
      }
    } else if (imp.names === '*') {
      // `from mod import *` → add all exports directly
      if (defs) importedDefs.push(...defs)
    } else {
      // `from mod import a, b` → add only the named exports
      if (defs) {
        for (const name of imp.names) {
          const def = defs.find(d => d.label === name)
          if (def) {
            importedDefs.push(def)
          } else {
            importedDefs.push({ label: name, type: 'variable', info: `from ${imp.module}` })
          }
        }
      }
    }
  }

  const allCompletions = [
    ...PYTHON_KEYWORDS.map(kw => ({ label: kw, type: 'keyword' })),
    ...PYTHON_BUILTINS.map(b => ({ label: b.label, type: b.type, detail: b.info })),
    ...globals.map(g => ({ label: g.label, type: g.type, detail: g.info })),
    ...currentFileDefs.map(d => ({ label: d.label, type: d.type, detail: d.info })),
    ...importedDefs.map(d => ({ label: d.label, type: d.type, detail: d.info }))
  ]

  return {
    from: word?.from ?? context.pos,
    options: allCompletions
  }
}
