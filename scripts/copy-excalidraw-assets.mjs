#!/usr/bin/env node
/**
 * Copy Excalidraw's font files into a self-hosted path served at
 * /excalidraw/v<version>/fonts/... (the editor sets window.EXCALIDRAW_ASSET_PATH
 * to /excalidraw/v<version>/, see src/components/dashboard/excalidraw-editor.tsx).
 *
 *   node scripts/copy-excalidraw-assets.mjs [outDir] [--soft]
 *
 * outDir defaults to public/excalidraw (gitignored + dockerignored). The
 * production image copies it in its own Dockerfile stage (`excalidraw-assets`),
 * same pattern as scripts/fetch-pyodide.mjs.
 *
 * Why: without EXCALIDRAW_ASSET_PATH, @excalidraw/excalidraw 0.18 loads every
 * font (incl. ~200 Xiaolai CJK subsets, ~14 MB total) from esm.sh. Even with
 * the path set, Excalidraw still appends esm.sh as the LAST fallback URL of
 * each FontFace / export fetch — it is only contacted if our copy 404s, so
 * this copy must exist wherever the editor is served.
 *
 * Idempotent: files with matching size are skipped.
 * --soft: on error print a warning and exit 0 (used by `pnpm dev`).
 */
import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const soft = args.includes('--soft')
const outDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(root, 'public/excalidraw'))

async function exists(file) {
  try { return await stat(file) } catch { return null }
}

async function copyTree(src, dest) {
  let copied = 0
  let total = 0
  await mkdir(dest, { recursive: true })
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      const r = await copyTree(s, d)
      copied += r.copied
      total += r.total
    } else if (entry.isFile()) {
      const [a, b] = await Promise.all([stat(s), exists(d)])
      if (!b || a.size !== b.size) {
        await copyFile(s, d)
        copied++
      }
      total += a.size
    }
  }
  return { copied, total }
}

async function main() {
  const require = createRequire(path.join(root, 'package.json'))
  // package.json isn't in the package's "exports" map → resolve it by path.
  const pkgDir = path.join(path.dirname(require.resolve('@excalidraw/excalidraw')), '..', '..')
  const { version } = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8'))
  const dest = path.join(outDir, `v${version}`, 'fonts')
  const { copied, total } = await copyTree(path.join(pkgDir, 'dist/prod/fonts'), dest)
  console.log(
    `excalidraw v${version}: fonts ${(total / 1e6).toFixed(1)} MB (${copied} files copied) in ${path.relative(root, dest) || dest}`,
  )
}

main().catch((err) => {
  if (soft) {
    console.warn(`[copy-excalidraw-assets] skipped: ${err.message} — Excalidraw fonts will fall back to esm.sh.`)
    process.exit(0)
  }
  console.error(err)
  process.exit(1)
})
