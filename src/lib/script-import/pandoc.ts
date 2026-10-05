/**
 * Native pandoc (≥ 3.x) as a child process, for the script import.
 *
 * Replaced pandoc-wasm (2026-10-05, after the move to the VPS): the WASM
 * build ran on Node's main thread (blocking every other request for the
 * conversion's duration) and stayed resident (~100–200 MB) after first use.
 * A child process blocks nothing and frees its memory on exit. The binary
 * comes from the pandoc .deb in the Dockerfile; locally any pandoc ≥ 3 on
 * PATH works (PANDOC_PATH overrides).
 *
 * Each call gets its own temp dir (input file, extracted media), removed
 * afterwards. Media paths in the output are relative to that dir, i.e.
 * `media/media/image1.png` for docx — the same shape pandoc-wasm produced.
 */
import { spawn } from 'child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

const TIMEOUT_MS = 120_000

export interface PandocResult {
  stdout: string
  /** Extracted media, keyed by the path pandoc wrote into the output (e.g. media/media/image1.png). */
  media: Map<string, Buffer>
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const out: string[] = []
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listFiles(p, base)))
    else out.push(path.relative(base, p))
  }
  return out
}

/** Run a child process with a timeout; resolves with stdout or rejects with stderr. */
export function run(cmd: string, args: string[], opts: { cwd: string; stdin?: string; timeoutMs?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? TIMEOUT_MS)
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => err.push(d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'))
      else reject(new Error(`${cmd} exited ${code ?? signal}: ${Buffer.concat(err).toString('utf8').slice(0, 500)}`))
    })
    child.stdin.end(opts.stdin ?? '')
  })
}

/**
 * Convert `input` (a file's bytes, or text via stdin) with pandoc.
 * `inputName` gives the temp file its extension (pandoc needs it for binary
 * formats like docx); omit it to pipe text through stdin.
 */
export async function runPandoc(opts: {
  from: string
  to: string
  input: Buffer | string
  inputName?: string
  extractMedia?: boolean
}): Promise<PandocResult> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eduskript-pandoc-'))
  try {
    const args = ['-f', opts.from, '-t', opts.to, '--wrap=none']
    if (opts.extractMedia) args.push('--extract-media=media')
    let stdin: string | undefined
    if (opts.inputName) {
      await writeFile(path.join(dir, opts.inputName), opts.input)
      args.push(opts.inputName)
    } else {
      stdin = typeof opts.input === 'string' ? opts.input : opts.input.toString('utf8')
    }
    const stdout = await run(process.env.PANDOC_PATH || 'pandoc', args, { cwd: dir, stdin })
    const media = new Map<string, Buffer>()
    if (opts.extractMedia) {
      for (const rel of await listFiles(path.join(dir, 'media'))) {
        media.set(path.posix.join('media', rel.split(path.sep).join('/')), await readFile(path.join(dir, 'media', rel)))
      }
    }
    return { stdout, media }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
