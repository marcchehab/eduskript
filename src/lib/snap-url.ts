/**
 * Snap images live in a private bucket; UserData still stores their full S3
 * URL (https://s3.fr-par.scw.cloud/<bucket>/snaps/..., or the S3_ENDPOINT form
 * on other providers). Rewrite those to
 * the access-checked proxy (src/app/api/snaps/image/[...key]/route.ts) before
 * rendering. data: URLs (unsynced local snaps) and anything else pass through.
 */
const S3_SNAP_RE = /^https:\/\/[^/]+\.(?:scw|infomaniak)\.cloud\/(?:object\/v1\/AUTH_[^/]+\/)?[^/]+\/(snaps\/.+)$/

export function snapImageSrc(url: string): string {
  const m = url.match(S3_SNAP_RE)
  return m ? `/api/snaps/image/${m[1]}` : url
}
