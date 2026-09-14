/**
 * PhET Interactive Simulations (University of Colorado Boulder).
 *
 * Sims are CC BY 4.0: embedding is allowed as long as the attribution
 * "PhET Interactive Simulations, University of Colorado Boulder,
 * https://phet.colorado.edu" is shown and the in-sim PhET logo stays visible
 * (it does — we iframe the unmodified sim). See
 * https://phet.colorado.edu/en/licensing/html
 *
 * The catalogue comes from PhET's public metadata service. The raw response
 * is ~6.6 MB (every locale's description + learning goals), so
 * /api/phet/sims fetches it server-side and hands the picker a compact list
 * via `compactPhetCatalogue`. Rendering: src/components/markdown/phet-sim.tsx.
 */

export const PHET_ORIGIN = 'https://phet.colorado.edu'
export const PHET_METADATA_URL = `${PHET_ORIGIN}/services/metadata/1.3/simulations?format=json&type=html`
export const PHET_ATTRIBUTION = 'PhET Interactive Simulations, University of Colorado Boulder'

/** Sim slugs are lowercase kebab-case ("projectile-motion"). Anything else is rejected. */
const SIM_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** PhET locales: "de", "pt_BR", "zh_CN", "ar_SA". */
const LOCALE_RE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/

export function isValidPhetSim(sim: string | undefined): sim is string {
  return !!sim && SIM_RE.test(sim)
}

export function isValidPhetLocale(locale: string | undefined): locale is string {
  return !!locale && LOCALE_RE.test(locale)
}

/**
 * URL of the all-locales build. `?locale=` picks the language at runtime;
 * an unknown/untranslated locale falls back to English inside the sim.
 */
export function phetSimUrl(sim: string, locale?: string): string {
  const base = `${PHET_ORIGIN}/sims/html/${sim}/latest/${sim}_all.html`
  return isValidPhetLocale(locale) ? `${base}?locale=${locale}` : base
}

/** PhET publishes 128×84, 420×276 and 600×394 PNG screenshots per sim. */
export function phetThumbnailUrl(sim: string, size: 128 | 420 | 600 = 420): string {
  return `${PHET_ORIGIN}/sims/html/${sim}/latest/${sim}-${size}.png`
}

export function phetSimPageUrl(sim: string, locale = 'en'): string {
  return `${PHET_ORIGIN}/${locale}/simulations/${sim}`
}

export type PhetSubject = 'physics' | 'chemistry' | 'math' | 'biology' | 'earth-and-space'

export interface PhetSimSummary {
  sim: string
  /** Title per locale; always has `en`, other locales only where translated. */
  titles: Record<string, string>
  /** Short description per locale (same keys as `titles`). */
  descriptions: Record<string, string>
  subjects: PhetSubject[]
  /** PhET grade levels: 1 elementary, 2 middle school, 3 high school, 4 university. */
  lowGradeLevel: number
  highGradeLevel: number
  locales: string[]
}

// Top-level PhET category ids → our subject keys. Sims list both top-level
// and child category ids in `subjects` (e.g. chemistry 13 + general 19);
// children are resolved to their parent via the `categories` table.
const TOP_LEVEL_SUBJECTS: Record<number, PhetSubject> = {
  4: 'physics',
  12: 'biology',
  13: 'chemistry',
  14: 'earth-and-space',
  15: 'math',
}

interface RawLocalized { title?: string; description?: string }
interface RawSim {
  name?: string
  subjects?: number[]
  lowGradeLevel?: number
  highGradeLevel?: number
  localizedSimulations?: Record<string, RawLocalized>
}
interface RawMetadata {
  categories?: Record<string, { id: number; parent: number | string }>
  projects?: { simulations?: RawSim[] }[]
}

/** Locales we keep titles/descriptions for — keeps the payload at ~190 KB for 120 sims (vs 6.6 MB raw). */
const KEPT_LOCALES = ['en', 'de', 'fr', 'it']

/**
 * Reduces PhET's raw metadata to what the picker needs. Pure; O(sims × locales).
 * Sims without a valid slug or English title are dropped.
 */
export function compactPhetCatalogue(raw: unknown): PhetSimSummary[] {
  const data = (raw ?? {}) as RawMetadata
  const categories = data.categories ?? {}
  const subjectOf = (id: number): PhetSubject | undefined => {
    let current: number | undefined = id
    // Walk up at most a few levels; the tree is shallow (root → subject → topic).
    for (let depth = 0; current !== undefined && depth < 4; depth++) {
      if (TOP_LEVEL_SUBJECTS[current]) return TOP_LEVEL_SUBJECTS[current]
      const parent: number | string | undefined = categories[String(current)]?.parent
      current = typeof parent === 'number' ? parent : parent ? Number(parent) : undefined
    }
    return undefined
  }

  const out: PhetSimSummary[] = []
  const seen = new Set<string>()
  for (const project of data.projects ?? []) {
    for (const sim of project.simulations ?? []) {
      const slug = sim.name
      const localized = sim.localizedSimulations ?? {}
      if (!isValidPhetSim(slug) || seen.has(slug) || !localized.en?.title) continue
      seen.add(slug)

      const titles: Record<string, string> = {}
      const descriptions: Record<string, string> = {}
      for (const locale of KEPT_LOCALES) {
        const entry = localized[locale]
        if (!entry?.title) continue
        titles[locale] = entry.title
        if (entry.description) descriptions[locale] = entry.description
      }

      const subjects = [...new Set((sim.subjects ?? []).map(subjectOf).filter((s): s is PhetSubject => !!s))]
      out.push({
        sim: slug,
        titles,
        descriptions,
        subjects,
        lowGradeLevel: sim.lowGradeLevel ?? 0,
        highGradeLevel: sim.highGradeLevel ?? 0,
        locales: Object.keys(localized).sort(),
      })
    }
  }
  return out.sort((a, b) => a.titles.en.localeCompare(b.titles.en))
}

/** Localized title with English fallback. */
export function phetTitle(sim: PhetSimSummary, locale: string): string {
  return sim.titles[locale] ?? sim.titles.en
}

/**
 * Case-insensitive search over slug and all kept titles/descriptions, so a
 * German teacher finds "Wurf" and "projectile" alike. Title hits rank above
 * description-only hits. O(n).
 */
export function searchPhetSims(sims: PhetSimSummary[], query: string, subject?: PhetSubject | null): PhetSimSummary[] {
  const q = query.trim().toLowerCase()
  const bySubject = subject ? sims.filter((s) => s.subjects.includes(subject)) : sims
  if (!q) return bySubject
  const titleHits: PhetSimSummary[] = []
  const otherHits: PhetSimSummary[] = []
  for (const s of bySubject) {
    if (s.sim.includes(q) || Object.values(s.titles).some((t) => t.toLowerCase().includes(q))) titleHits.push(s)
    else if (Object.values(s.descriptions).some((d) => d.toLowerCase().includes(q))) otherHits.push(s)
  }
  return [...titleHits, ...otherHits]
}
