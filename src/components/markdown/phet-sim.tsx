import { isValidPhetLocale, isValidPhetSim, phetSimPageUrl, phetSimUrl, PHET_ATTRIBUTION } from '@/lib/phet'

interface PhetSimProps {
  sim?: string
  locale?: string
  /** Optional fixed height in px; default keeps PhET's 1024×618 layout ratio. */
  height?: string
  title?: string
}

/**
 * `<phet sim="projectile-motion" locale="de" />` — embeds an unmodified PhET
 * sim in an iframe plus the CC BY 4.0 attribution PhET requires
 * (src/lib/phet.ts). The sim is a ~4–5 MB single HTML file, hence
 * `loading="lazy"`. No sandbox: it's a fixed https://phet.colorado.edu URL
 * built from a validated slug, never author-supplied HTML, and PhET's own
 * fullscreen button needs `allow="fullscreen"`.
 *
 * Markup is `<span class="block">`, not figure/div: when the tag shares a
 * paragraph with text, rehypeUnwrapBlockTags can't lift it out, and a div
 * inside the <p> would break hydration. Spans and iframes are valid there.
 */
export function PhetSim({ sim, locale, height, title }: PhetSimProps) {
  if (!isValidPhetSim(sim)) {
    return (
      <span className="block my-4 rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        PhET: missing or invalid <code>sim</code> attribute (e.g. <code>sim=&quot;projectile-motion&quot;</code>).
      </span>
    )
  }

  const heightPx = height && /^\d+$/.test(height) ? `${height}px` : undefined

  return (
    <span className="block my-4">
      <iframe
        src={phetSimUrl(sim, locale)}
        title={title || `PhET: ${sim}`}
        loading="lazy"
        allow="fullscreen"
        allowFullScreen
        className="w-full rounded-lg border border-gray-200 bg-white dark:border-gray-700"
        style={heightPx ? { height: heightPx } : { aspectRatio: '1024 / 618' }}
      />
      <span className="mt-1 block text-right text-xs text-gray-500 dark:text-gray-400">
        <a href={phetSimPageUrl(sim, isValidPhetLocale(locale) ? locale : 'en')} target="_blank" rel="noopener noreferrer" className="hover:underline">
          {PHET_ATTRIBUTION}
        </a>
        {' · '}
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="hover:underline">
          CC BY 4.0
        </a>
      </span>
    </span>
  )
}
