/**
 * Signed pending-upload token shared by create_asset_upload_url and
 * confirm_asset_upload (the presigned-upload MCP tool pair). Same
 * HMAC-over-JSON scheme as the dashboard's /api/upload/presigned +
 * /api/upload/confirm routes: the metadata travels with the client instead of
 * living in server state, but is signed so it can't be tampered with between
 * the two calls (e.g. swapping in a different skriptId or overwrite=true).
 */

import { createHash } from 'crypto'

export interface PendingAssetUpload {
  token: string
  filename: string
  size: number
  contentType: string
  skriptId: string
  userId: string
  parentId: string | null
  overwrite: boolean
  tempKey: string
  expiresAt: string
}

function sign(dataString: string): string {
  return createHash('sha256')
    .update(dataString + process.env.NEXTAUTH_SECRET)
    .digest('hex')
    .slice(0, 16)
}

export function signPendingUpload(payload: PendingAssetUpload): { uploadData: string; signature: string } {
  const dataString = JSON.stringify(payload)
  return { uploadData: Buffer.from(dataString).toString('base64'), signature: sign(dataString) }
}

export function verifyPendingUpload(uploadData: string, signature: string): PendingAssetUpload {
  const dataString = Buffer.from(uploadData, 'base64').toString('utf-8')
  if (sign(dataString) !== signature) {
    throw new Error('Invalid or tampered upload token')
  }
  return JSON.parse(dataString) as PendingAssetUpload
}
