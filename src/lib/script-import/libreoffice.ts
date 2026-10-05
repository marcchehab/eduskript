/**
 * Old/open office formats (.doc, .odt, .rtf) → .docx with LibreOffice
 * headless, so they take the normal Word path (convert-docx.ts).
 *
 * LibreOffice also turns legacy Equation Editor 3.0 objects into Word
 * formulas (OMML) on the way (checked 2026-10-05: a 1999 .doc gave 54 OMML
 * formulas). Known glitch: Symbol-font glyphs in those formulas can come out
 * wrong (∞ → ¥, ² → ´); cleanup.ts asks the model to fix the obvious ones.
 *
 * Runs as a child process (memory freed on exit, ~0.5–1 s per file with a warm
 * profile). One conversion at a time: LibreOffice locks its user profile, so
 * calls are serialised through `queue` and share one profile dir under the
 * OS temp dir (created on first use, ~2 s extra once). SOFFICE_PATH overrides
 * the binary (default `soffice`, from libreoffice-*-nogui in the Dockerfile).
 */
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { run } from './pandoc'

export const OFFICE_EXTENSIONS = ['doc', 'odt', 'rtf'] as const
export type OfficeExtension = (typeof OFFICE_EXTENSIONS)[number]

const PROFILE_DIR = path.join(tmpdir(), 'eduskript-libreoffice-profile')
let queue: Promise<unknown> = Promise.resolve()

export async function officeToDocx(input: Buffer, ext: OfficeExtension): Promise<Buffer> {
  const job = queue.then(() => convert(input, ext))
  queue = job.catch(() => {})
  return job
}

async function convert(input: Buffer, ext: OfficeExtension): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eduskript-office-'))
  try {
    await writeFile(path.join(dir, `in.${ext}`), input)
    await run(
      process.env.SOFFICE_PATH || 'soffice',
      [`-env:UserInstallation=${pathToFileURL(PROFILE_DIR).href}`, '--headless', '--norestore', '--convert-to', 'docx', '--outdir', 'out', `in.${ext}`],
      { cwd: dir, timeoutMs: 90_000 }
    )
    return await readFile(path.join(dir, 'out', 'in.docx'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
