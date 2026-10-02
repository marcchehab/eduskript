import { describe, it, expect } from 'vitest'
import {
  moveLocalToImports, upsertImportFile, parseToolboxName, isToolboxModuleError, toolboxModule,
} from '@/components/public/code-editor/file-scopes'

describe('moveLocalToImports', () => {
  const local = [{ name: 'main.py', content: 'from befehle import *\n' }, { name: 'befehle.py', content: '# New file\n' }]

  // Regression (MOP-7 playtest): '+', rename to befehle.py, type, right-click
  // "Move to Skript scope" produced '# New file' — the stored content, not the buffer.
  it('uses the live buffer of the open file, not the stored starter', () => {
    const r = moveLocalToImports(local, 1, 'def drei_vor():\n    move()\n', [])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.importFiles).toEqual([{ name: 'befehle.py', content: 'def drei_vor():\n    move()\n' }])
    expect(r.localFiles).toEqual([local[0]])
  })

  it('falls back to the stored content when the file is not open', () => {
    const r = moveLocalToImports(local, 1, null, [{ name: 'x.py', content: '' }])
    expect(r.ok && r.importFiles.map(f => f.content)).toEqual(['', '# New file\n'])
  })

  it('refuses duplicates and missing indices', () => {
    expect(moveLocalToImports(local, 1, null, [{ name: 'befehle.py', content: 'old' }])).toEqual({ ok: false, reason: 'duplicate' })
    expect(moveLocalToImports(local, 5, null, [])).toEqual({ ok: false, reason: 'missing' })
  })
})

describe('toolbox helpers', () => {
  it('upsertImportFile replaces or appends', () => {
    expect(upsertImportFile([], 'befehle.py', 'a')).toEqual([{ name: 'befehle.py', content: 'a' }])
    expect(upsertImportFile([{ name: 'befehle.py', content: 'a' }, { name: 'b.py', content: 'b' }], 'befehle.py', 'c'))
      .toEqual([{ name: 'befehle.py', content: 'c' }, { name: 'b.py', content: 'b' }])
  })

  it('parseToolboxName normalises and rejects non-module names', () => {
    expect(parseToolboxName('befehle.py')).toBe('befehle.py')
    expect(parseToolboxName('befehle')).toBe('befehle.py')
    expect(parseToolboxName('my-tools.py')).toBeUndefined()
    expect(parseToolboxName('../x.py')).toBeUndefined()
    expect(parseToolboxName(undefined)).toBeUndefined()
    expect(toolboxModule('befehle.py')).toBe('befehle')
  })

  it('isToolboxModuleError matches the toolbox module only', () => {
    expect(isToolboxModuleError({ sub: 'module', name: 'befehle', message: '' }, 'befehle.py')).toBe(true)
    expect(isToolboxModuleError({ sub: 'module', name: 'befehel', message: '' }, 'befehle.py')).toBe(false)
    expect(isToolboxModuleError({ message: "ModuleNotFoundError: No module named 'befehle'" }, 'befehle.py')).toBe(true)
    expect(isToolboxModuleError({ message: 'ImportError: No module named befehle on line 1' }, 'befehle.py')).toBe(true)
    expect(isToolboxModuleError({ message: "No module named 'befehle2'" }, 'befehle.py')).toBe(false)
    expect(isToolboxModuleError({ message: "No module named 'befehle'" }, undefined)).toBe(false)
    expect(isToolboxModuleError(null, 'befehle.py')).toBe(false)
  })
})
