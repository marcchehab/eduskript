/**
 * Persistent store for rendered TikZ pictures: the public teacher bucket.
 *
 * A picture is two SVG files (light, dark), content-addressed like every
 * teacher file (files/<sha256>.svg, immutable, cached for a year), so a page
 * carries two short URLs per diagram instead of the SVG itself. A small JSON
 * record, addressed by the hash of the TeX document, says which files belong to
 * a document: after a deploy or restart the pictures are found again without
 * running TeX.
 *
 * Objects are never deleted (see docs/internals/03-file-storage.md: orphans in
 * the bucket are not cleaned up). Without a configured bucket (tests, a bare
 * dev setup) nothing is stored and the renderer falls back to data URLs.
 *
 * Node-only.
 */
import { createHash } from 'node:crypto'
import { downloadTeacherFile, getTeacherFileUrl, isTeacherS3Configured, uploadTeacherFile } from '@/lib/s3'

/** Bump when the SVG post-processing changes, so stored pictures are rendered again. */
const RENDER_VERSION = 1

export interface StoredPicture {
  /** Public URLs of the two SVG files. */
  light: string
  dark: string
  /** Display size in px. */
  width: number
  height: number
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

const recordHash = (documentKey: string) => sha256(`tikz-record\u0000${RENDER_VERSION}\u0000${documentKey}`)

const SVG_URL = /\/files\/[0-9a-f]{64}\.svg$/

export function tikzStoreEnabled(): boolean {
  return isTeacherS3Configured()
}

/** The stored picture of a document, or undefined if it was never rendered (or the store is unreachable). */
export async function loadStoredPicture(documentKey: string): Promise<StoredPicture | undefined> {
  if (!tikzStoreEnabled()) return undefined
  try {
    // The S3 client, not fetch(): a no-store fetch during a static render turns
    // the page dynamic (Next.js then fails it), and a cached one would keep the
    // "not found" answer of a picture that exists by now.
    const body = await downloadTeacherFile(`files/${recordHash(documentKey)}.json`)
    const record = JSON.parse(body.toString('utf8')) as Partial<StoredPicture>
    if (
      typeof record.light === 'string' && SVG_URL.test(record.light) &&
      typeof record.dark === 'string' && SVG_URL.test(record.dark) &&
      typeof record.width === 'number' && typeof record.height === 'number'
    ) {
      return { light: record.light, dark: record.dark, width: record.width, height: record.height }
    }
  } catch {
    // no record yet, or the store is unreachable: render
  }
  return undefined
}

async function storeSvg(svg: string): Promise<string> {
  const key = await uploadTeacherFile(sha256(svg), 'svg', Buffer.from(svg, 'utf8'), 'image/svg+xml')
  return getTeacherFileUrl(key)
}

/** Upload both variants and the record. Throws if the bucket cannot be written. */
export async function storePicture(
  documentKey: string,
  svgs: { light: string; dark: string },
  size: { width: number; height: number },
): Promise<StoredPicture> {
  const [light, dark] = await Promise.all([storeSvg(svgs.light), storeSvg(svgs.dark)])
  const picture: StoredPicture = { light, dark, ...size }
  await uploadTeacherFile(recordHash(documentKey), 'json', Buffer.from(JSON.stringify(picture), 'utf8'), 'application/json')
  return picture
}
