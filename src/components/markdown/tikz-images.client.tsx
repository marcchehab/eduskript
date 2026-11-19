'use client'

import { usePrintMode } from '@/lib/print/print-mode'

/**
 * The two <img> of a ```tikz block (see TikzImageView).
 *
 * - loading="lazy" keeps the browser from fetching the hidden variant (a
 *   display:none <img> without it is fetched all the same); EagerImageLoader
 *   starts the visible ones well before they scroll into view. The print view
 *   shows the light variant everywhere and needs all of them at once.
 * - crossOrigin: <ai-feedback> draws the picture on a canvas and reloads it
 *   with CORS for that. The bucket only sends its CORS header when the request
 *   has an Origin and does not vary the cache on it, so a picture first loaded
 *   without CORS would be answered from the cache without the header and the
 *   reload would fail.
 */
export function TikzImages({ light, dark, width, height, alt }: { light: string; dark: string; width: number; height: number; alt: string }) {
  const printing = usePrintMode()
  const shared = { width, height, decoding: 'async', crossOrigin: 'anonymous', style: { maxWidth: `${width}px` } } as const
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG, nothing for the image optimizer to do */}
      <img {...shared} src={light} alt={alt} loading={printing ? 'eager' : 'lazy'} className="plot-light mx-auto h-auto w-full max-w-full" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img {...shared} src={dark} alt={alt} loading="lazy" className="plot-dark mx-auto h-auto w-full max-w-full" />
    </>
  )
}
