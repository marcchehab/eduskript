// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { runPandoc } from '@/lib/script-import/pandoc'
import { officeToDocx } from '@/lib/script-import/libreoffice'
import { convertDocx } from '@/lib/script-import/convert-docx'

const pandoc = process.env.PANDOC_PATH || 'pandoc'
const hasSoffice = (() => {
  try {
    execFileSync(process.env.SOFFICE_PATH || 'soffice', ['--version'], { stdio: 'ignore', timeout: 30_000 })
    return true
  } catch {
    return false
  }
})()

describe('runPandoc', () => {
  it('converts stdin text', async () => {
    const { stdout } = await runPandoc({ from: 'latex', to: 'markdown', input: '\\section{A} $x^2$' })
    expect(stdout).toContain('# A')
    expect(stdout).toContain('$x^2$')
  })

  it('rejects with pandoc stderr on bad input format', async () => {
    await expect(runPandoc({ from: 'no-such-format', to: 'markdown', input: 'x' })).rejects.toThrow(/pandoc/)
  })
})

describe.skipIf(!hasSoffice)('officeToDocx (LibreOffice)', () => {
  it('turns an .odt into a .docx the Word path can read', async () => {
    const odt = execFileSync(pandoc, ['-f', 'markdown', '-t', 'odt', '-o', '-'], { input: '# Kapitel\n\nHallo $E = mc^2$\n' })
    const docx = await officeToDocx(odt, 'odt')
    expect(docx.subarray(0, 2).toString('latin1')).toBe('PK')
    const { markdown } = await convertDocx(docx)
    expect(markdown).toContain('Kapitel')
    expect(markdown).toContain('Hallo')
  }, 120_000)

  it('serialises parallel conversions (shared profile)', async () => {
    const rtf = execFileSync(pandoc, ['-f', 'markdown', '-t', 'rtf', '-s'], { input: 'Eins zwei drei\n' })
    const results = await Promise.all([officeToDocx(rtf, 'rtf'), officeToDocx(rtf, 'rtf')])
    for (const r of results) expect((await convertDocx(r)).markdown).toContain('Eins zwei drei')
  }, 180_000)
})
