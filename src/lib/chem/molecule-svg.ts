/**
 * SMILES → structural formula (SVG).
 *
 * Server-side only: openchemlib is ~1.1 MB (343 kB gzipped), so it must never
 * reach a browser bundle. The markdown component points an `<img>` at
 * /api/render/molecule.svg instead of inlining a data URL — that keeps the
 * library on the server, keeps the page HTML small, and lets the browser cache
 * each molecule (H2O appears on a lot of pages).
 */
import 'server-only'
import { Molecule } from 'openchemlib'

/** Long enough for anything a class will draw, short enough to bound the work. */
export const MAX_SMILES_LENGTH = 250

const MIN_SIZE = 80
const MAX_SIZE = 1200

export type MoleculeTheme = 'light' | 'dark'

export interface MoleculeRequest {
  smiles: string
  width: number
  height: number
  theme: MoleculeTheme
}

export type MoleculeResult = { svg: string } | { error: string }

/**
 * Rendered molecules are pure functions of their request, so a bounded memo
 * saves the parse+layout on repeats within a process. The HTTP cache does the
 * heavy lifting; this only catches cold-cache bursts (a class of 25 opening the
 * same page at once).
 */
const CACHE_LIMIT = 200
const cache = new Map<string, MoleculeResult>()

export function renderMolecule(request: MoleculeRequest): MoleculeResult {
  const key = `${request.theme}|${request.width}x${request.height}|${request.smiles}`
  const hit = cache.get(key)
  if (hit) return hit

  const result = compute(request)

  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, result)
  return result
}

function compute({ smiles, width, height, theme }: MoleculeRequest): MoleculeResult {
  const trimmed = smiles.trim()
  if (!trimmed) return { error: 'No SMILES given' }
  if (trimmed.length > MAX_SMILES_LENGTH) {
    return { error: `SMILES too long (max ${MAX_SMILES_LENGTH} characters)` }
  }

  let svg: string
  try {
    const molecule = Molecule.fromSmiles(trimmed)
    svg = molecule.toSVG(clampSize(width), clampSize(height), undefined, {
      autoCrop: true,
      autoCropMargin: 6,
      suppressChiralText: true,
      // Without this, a stereocentre whose configuration the SMILES leaves open
      // is drawn with a literal "?" next to it (openchemlib's CIP annotation).
      // On a teaching page that reads as a typo, and in a "find the stereocentre"
      // task it would give the answer away. Authors who want the configuration
      // shown write it into the SMILES: [C@@H] draws a proper wedge.
      suppressCIPParity: true,
    })
  } catch (err) {
    // openchemlib's parser messages name the offending position, which is the
    // useful half; the class prefix ("Class$S19: SmilesParser: …") is not.
    const raw = err instanceof Error ? err.message : String(err)
    return { error: raw.replace(/^.*?SmilesParser:\s*/, '').slice(0, 160) || 'Could not read this SMILES' }
  }

  return { svg: theme === 'dark' ? toDarkTheme(svg) : svg }
}

function clampSize(value: number): number {
  if (!Number.isFinite(value)) return 400
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(value)))
}

/**
 * openchemlib draws bonds and carbon labels in pure black on a transparent
 * background and keeps CPK colours for the hetero atoms (O red, N blue). Only
 * the black needs flipping for dark mode — the element colours stay readable
 * and, more importantly, stay recognisable.
 */
function toDarkTheme(svg: string): string {
  return svg.replace(/rgb\(0,\s*0,\s*0\)/g, 'rgb(230,230,230)')
}

/** Everything a SMILES string may contain — everything else is rejected early. */
const SMILES_ALLOWED = /^[A-Za-z0-9@+\-[\]()\\/=#$%.*:~{}]+$/

export function isPlausibleSmiles(value: string): boolean {
  return value.length > 0 && value.length <= MAX_SMILES_LENGTH && SMILES_ALLOWED.test(value)
}
