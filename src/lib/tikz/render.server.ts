/**
 * Server-side TikZ rendering: TeX document → light and dark SVG data URLs.
 *
 * TeX runs as WebAssembly (node-tikzjax, no TeX installation) in a worker
 * thread. The worker is not optional: TeX is a programming language, and
 * `\loop\iftrue\repeat` in a fence would otherwise block the whole Node process.
 * The worker is killed after TIMEOUT_MS and a fresh one starts on the next call.
 * node-tikzjax must not run two jobs at once, so jobs queue up.
 *
 * Results (errors included) are kept in a per-process LRU. Public pages are
 * rendered into the ISR cache, so TeX normally runs once per change.
 *
 * Node-only. Import it from server code only (the page renderer, /api/tikz).
 */
import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseFont } from 'opentype.js'
import { svgToDataUrl } from '@/lib/plot/svg'
import { buildTikzDocument } from './document'
import { compactSvg, darkSvg, sizeSvg, svgSize, textToPaths, TIKZ_SCALE, type GlyphFont } from './svg'

export interface TikzImage {
  /** data:image/svg+xml URLs. */
  light: string
  dark: string
  /** Display size in px. */
  width: number
  height: number
  alt: string
  caption?: string
}

export type TikzResult = { image: TikzImage } | { error: string }

const TIMEOUT_MS = 8_000
const CACHE_ENTRIES = 500

/** Directory of the installed node-tikzjax package (TeX files and fonts live there). */
function packageDir(): string {
  // Resolved at run time from the working directory: the package is an external
  // dependency (never bundled), in dev as in the production image.
  const bases = [process.cwd(), path.join(process.cwd(), '..', '..')]
  for (const base of bases) {
    try {
      const entry = createRequire(path.join(base, 'noop.js')).resolve('node-tikzjax/package.json')
      return path.dirname(entry)
    } catch {
      // try the next base
    }
  }
  throw new Error('node-tikzjax is not installed')
}

// The worker source is a string so that no bundler has to find a worker file.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const tikzjax = require(workerData.entry)
let log = []
const keep = (...args) => { log.push(args.map(String).join(' ')) }
console.log = keep; console.info = keep; console.warn = keep; console.error = keep
parentPort.on('message', async (job) => {
  log = []
  try {
    await tikzjax.load()
    const dvi = await tikzjax.tex(job.input, { showConsole: true, texPackages: job.packages, tikzLibraries: job.libraries, addToPreamble: job.preamble })
    const svg = await tikzjax.dvi2svg(dvi, { disableOptimize: true })
    parentPort.postMessage({ id: job.id, svg })
  } catch (error) {
    parentPort.postMessage({ id: job.id, error: String(error && error.message || error), log: log.join('\\n') })
  }
})
`

interface Job {
  id: number
  input: string
  packages: Record<string, string>
  libraries: string
  preamble: string
}

type WorkerReply = { id: number; svg: string } | { id: number; error: string; log: string }

let worker: Worker | undefined
let nextId = 1
let queue: Promise<unknown> = Promise.resolve()

function getWorker(): Worker {
  if (!worker) {
    const entry = path.join(packageDir(), 'dist', 'index.js')
    worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { entry } })
    worker.unref()
    worker.on('error', () => { worker = undefined })
    worker.on('exit', () => { worker = undefined })
  }
  return worker
}

function runJob(job: Omit<Job, 'id'>): Promise<WorkerReply> {
  const run = () =>
    new Promise<WorkerReply>((resolve) => {
      const id = nextId++
      let current: Worker
      try {
        current = getWorker()
      } catch (error) {
        resolve({ id, error: String((error as Error).message), log: '' })
        return
      }
      const finish = (reply: WorkerReply) => {
        clearTimeout(timer)
        current.off('message', onMessage)
        current.off('error', onError)
        current.off('exit', onExit)
        resolve(reply)
      }
      const onMessage = (reply: WorkerReply) => { if (reply.id === id) finish(reply) }
      const onError = (error: Error) => finish({ id, error: `TeX worker failed: ${error.message}`, log: '' })
      const onExit = () => finish({ id, error: 'TeX worker stopped unexpectedly.', log: '' })
      const timer = setTimeout(() => {
        worker = undefined
        void current.terminate()
        finish({ id, error: `TeX did not finish within ${TIMEOUT_MS / 1000} seconds (endless loop?).`, log: '' })
      }, TIMEOUT_MS)
      current.on('message', onMessage)
      current.on('error', onError)
      current.on('exit', onExit)
      current.postMessage({ ...job, id })
    })
  const result = queue.then(run, run)
  queue = result
  return result
}

const fonts = new Map<string, GlyphFont | undefined>()

function loadFont(family: string): GlyphFont | undefined {
  if (!/^[a-z0-9]+$/i.test(family)) return undefined
  if (!fonts.has(family)) {
    const file = path.join(packageDir(), 'css', 'bakoma', 'ttf', `${family}.ttf`)
    let font: GlyphFont | undefined
    if (existsSync(file)) {
      const data = readFileSync(file)
      font = parseFont(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
    }
    fonts.set(family, font)
  }
  return fonts.get(family)
}

/**
 * The lines of a TeX log that say what went wrong: `! Undefined control
 * sequence.` and the `l.12 \foo` context line that follows it.
 */
export function texErrorFromLog(log: string): string | undefined {
  const lines = log.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length && out.length < 6; i++) {
    if (!lines[i].startsWith('!')) continue
    out.push(lines[i].slice(1).trim())
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      if (/^l\.\d+/.test(lines[j])) {
        out.push(lines[j].replace(/^l\.\d+\s*/, 'at: ').trim())
        i = j
        break
      }
      if (lines[j].startsWith('!')) break
    }
  }
  // "Emergency stop" only repeats the context of the error before it.
  const unique = out.filter((line, index) => out.indexOf(line) === index && line !== 'Emergency stop.')
  return unique.length > 0 ? unique.join('\n') : undefined
}

const cache = new Map<string, TikzResult>()

function remember(key: string, result: TikzResult): TikzResult {
  cache.delete(key)
  cache.set(key, result)
  if (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value as string)
  return result
}

/** Render a ```tikz fence body. `skriptPreamble` is the content of the skript's tikz-preamble.tex, if any. */
export async function renderTikz(source: string, skriptPreamble = ''): Promise<TikzResult> {
  const built = buildTikzDocument(source, skriptPreamble)
  if ('error' in built) return { error: built.error }
  const { document } = built

  const cached = cache.get(document.key)
  if (cached) return remember(document.key, cached)

  const reply = await runJob({
    input: `\\begin{document}\n${document.body}\n\\end{document}`,
    packages: document.packages,
    libraries: document.libraries,
    preamble: document.preamble,
  })

  if ('error' in reply) {
    return remember(document.key, { error: texErrorFromLog(reply.log) ?? reply.error })
  }

  const size = svgSize(reply.svg)
  if (!size) return remember(document.key, { error: 'TeX produced no picture.' })

  const { svg: outlined, missingFonts } = textToPaths(reply.svg, loadFont)
  if (missingFonts.length > 0) {
    return remember(document.key, { error: `Font not available: ${missingFonts.join(', ')}.` })
  }
  const width = Math.round(size.width * TIKZ_SCALE)
  const height = Math.round(size.height * TIKZ_SCALE)
  const light = compactSvg(sizeSvg(outlined, width, height))

  return remember(document.key, {
    image: {
      light: svgToDataUrl(light),
      dark: svgToDataUrl(darkSvg(light)),
      width,
      height,
      alt: document.alt ?? document.caption ?? 'TikZ diagram',
      caption: document.caption,
    },
  })
}

/** For tests: stop the worker so the process can exit. */
export async function stopTikzWorker(): Promise<void> {
  const current = worker
  worker = undefined
  if (current) await current.terminate()
}
