import { gzipSync } from 'zlib'

/**
 * Encode SEB settings XML as a .seb file (server only — uses zlib).
 *
 * Layout per https://safeexambrowser.org/developer/seb-file-format.html:
 *   gzip( "plnd" + gzip(xml) )
 * The outer gzip was missing until 2026-10; SEB on Windows tolerated that
 * (it falls back to the raw bytes when gunzip fails), other clients reported
 * an illegal configuration.
 */
export function encodeSEBFile(xml: string): Uint8Array<ArrayBuffer> {
  const inner = Buffer.concat([Buffer.from('plnd', 'utf-8'), gzipSync(Buffer.from(xml, 'utf-8'))])
  return new Uint8Array(gzipSync(inner))
}
