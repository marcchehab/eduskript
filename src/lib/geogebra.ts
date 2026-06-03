/**
 * GeoGebra share-link parsing.
 *
 * Teachers create constructions on geogebra.org and share them as links like
 * `https://www.geogebra.org/m/<ID>`. This extracts the material id from the
 * various forms a teacher might paste (share link, app link, embed iframe
 * snippet, or a bare id) so it can be turned into a `<geogebra material-id=...>`
 * tag. Pure + DOM-free so it's usable in both the paste pipeline and the
 * toolbar dialog, and unit-testable.
 */

// Material ids are short alphanumeric tokens (e.g. "dNPHaqgb", "RHYH3UQ8").
const ID_RE = /^[A-Za-z0-9]{6,12}$/

// Path segments that precede a material id in an app/share URL, e.g.
// /m/<id>, /classic/<id>, /graphing/<id>. Used to locate the id and to reject
// bare app landing pages (/graphing with no id).
const APP_SEGMENTS = new Set([
  'm', 'classic', 'graphing', 'geometry', 'calculator', 'cas', '3d',
  'scientific', 'suite', 'notes', 'graphing3d',
])

/**
 * Returns the GeoGebra material id from a pasted share URL, embed-iframe
 * snippet, or a bare id — or `null` if the input isn't a recognizable
 * GeoGebra material reference.
 */
export function parseGeogebraUrl(input: string): string | null {
  if (!input) return null
  const text = input.trim()

  // 1. Bare material id pasted directly (toolbar dialog convenience).
  if (ID_RE.test(text)) return text

  // 2. Full <iframe ... src="..."> embed snippet — pull the src and recurse.
  if (/<iframe/i.test(text)) {
    const m = text.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
    return m ? parseGeogebraUrl(m[1]) : null
  }

  // 3. A URL on geogebra.org.
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.hostname.replace(/^www\./, '') !== 'geogebra.org') return null

  const segs = url.pathname.split('/').filter(Boolean)

  // `.../id/<ID>/...` marker (material/show/id/X, material/iframe/id/X/width/..)
  const idIdx = segs.indexOf('id')
  let candidate: string | undefined
  if (idIdx >= 0 && segs[idIdx + 1]) {
    candidate = segs[idIdx + 1]
  } else if (segs.length >= 1 && APP_SEGMENTS.has(segs[0]) && segs[1]) {
    // /m/<ID>, /classic/<ID>, etc. A lone app segment (/graphing) has no id.
    candidate = segs[1]
  }

  return candidate && ID_RE.test(candidate) ? candidate : null
}
