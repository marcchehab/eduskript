#!/usr/bin/env node
/**
 * Assemble the self-hosted Pyodide distribution served at /pyodide/v<version>/.
 *
 *   node scripts/fetch-pyodide.mjs [outDir] [--soft]
 *
 * outDir defaults to public/pyodide (gitignored + dockerignored). The
 * production image builds it in its own Dockerfile stage (see Dockerfile,
 * stage `pyodide`), so it is a separate image layer that only changes when
 * the version / package list changes.
 *
 * Sources:
 *  - Core runtime (pyodide.js, pyodide.asm.js/.wasm, python_stdlib.zip,
 *    pyodide-lock.json) is copied from the `pyodide` npm devDependency —
 *    integrity-checked by pnpm via pnpm-lock.yaml.
 *  - Package wheels are NOT in the npm package. They are downloaded from the
 *    official Pyodide CDN build (cdn.jsdelivr.net/pyodide/v<version>/full/)
 *    and verified against the sha256 in pyodide-lock.json. This runs at build
 *    time on the developer's machine; browsers never contact jsdelivr.
 *
 * Which wheels: the transitive closure (lock-file `depends`) of the packages
 * listed in src/lib/pyodide-dist.json. That list must cover every value of
 * `packageMap` in src/components/public/code-editor/index.tsx — a package
 * requested at runtime but missing here fails to load (404) with a warning in
 * the editor's stderr.
 *
 * Idempotent: files already present with the right hash/size are skipped.
 * --soft: on any error print a warning and exit 0 (used by `pnpm dev`, so
 * offline development still starts; Python editors just won't load).
 */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const soft = args.includes('--soft')
const outDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(root, 'public/pyodide'))

const CORE_FILES = ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
const CONCURRENCY = 6

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function exists(file) {
  try { return await stat(file) } catch { return null }
}

async function main() {
  const config = JSON.parse(await readFile(path.join(root, 'src/lib/pyodide-dist.json'), 'utf8'))
  const require = createRequire(path.join(root, 'package.json'))
  const npmDir = path.dirname(require.resolve('pyodide/package.json'))
  const npmVersion = JSON.parse(await readFile(path.join(npmDir, 'package.json'), 'utf8')).version
  if (npmVersion !== config.version) {
    throw new Error(`pyodide npm package is ${npmVersion}, src/lib/pyodide-dist.json wants ${config.version} — keep them in sync`)
  }

  const dest = path.join(outDir, `v${config.version}`)
  await mkdir(dest, { recursive: true })

  // 1. Core files from npm.
  for (const f of CORE_FILES) {
    const src = path.join(npmDir, f)
    const [a, b] = await Promise.all([stat(src), exists(path.join(dest, f))])
    if (!b || a.size !== b.size) await copyFile(src, path.join(dest, f))
  }

  // 2. Wheel closure from the lock file.
  const lock = JSON.parse(await readFile(path.join(dest, 'pyodide-lock.json'), 'utf8'))
  const byLower = new Map(Object.entries(lock.packages).map(([k, v]) => [k.toLowerCase(), v]))
  const needed = new Map()
  const stack = config.packages.map((p) => p.toLowerCase())
  while (stack.length) {
    const name = stack.pop()
    if (needed.has(name)) continue
    const pkg = byLower.get(name)
    if (!pkg) throw new Error(`package "${name}" not in pyodide-lock.json`)
    needed.set(name, pkg)
    stack.push(...pkg.depends.map((d) => d.toLowerCase()))
  }

  const base = `https://cdn.jsdelivr.net/pyodide/v${config.version}/full/`
  const queue = [...needed.values()]
  let downloaded = 0
  async function worker() {
    while (queue.length) {
      const pkg = queue.shift()
      const file = path.join(dest, pkg.file_name)
      if (await exists(file)) {
        if (sha256(await readFile(file)) === pkg.sha256) continue
      }
      const res = await fetch(base + pkg.file_name, { signal: AbortSignal.timeout(120_000) })
      if (!res.ok) throw new Error(`${pkg.file_name}: HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const got = sha256(buf)
      if (got !== pkg.sha256) throw new Error(`${pkg.file_name}: sha256 ${got} != lock ${pkg.sha256}`)
      await writeFile(file + '.part', buf)
      await rename(file + '.part', file)
      downloaded++
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  let total = 0
  for (const f of [...CORE_FILES, ...[...needed.values()].map((p) => p.file_name)]) {
    total += (await stat(path.join(dest, f))).size
  }
  console.log(
    `pyodide v${config.version}: ${needed.size} packages (${downloaded} downloaded), ` +
      `${(total / 1e6).toFixed(1)} MB in ${path.relative(root, dest) || dest}`,
  )
}

main().catch((err) => {
  if (soft) {
    console.warn(`[fetch-pyodide] skipped: ${err.message} — Python editors will not load until this succeeds.`)
    process.exit(0)
  }
  console.error(err)
  process.exit(1)
})
