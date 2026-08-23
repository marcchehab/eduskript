/**
 * MCP tool: confirm_asset_upload — step 2 of the presigned-upload pair.
 *
 * Call this after PUTing the file to the URL from create_asset_upload_url.
 * Downloads the just-uploaded bytes from the temp S3 key and hands them to
 * the same saveFile() used by upload_asset — same hash/dedup/DB path either
 * way, the only difference is how the bytes got to the server.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { saveFile } from '@/lib/file-storage'
import { downloadFromS3, deleteFromS3, getTeacherBucketName } from '@/lib/s3'
import { PermissionDeniedError, ValidationError, ConflictError } from '@/lib/services/pages'
import { verifyPendingUpload } from '@/lib/mcp/tools/asset-upload-token'

export const confirmAssetUploadConfig = {
  title: 'Confirm asset upload',
  description:
    "Step 2 of the create_asset_upload_url flow — call once the PUT to the presigned URL has succeeded. Pass back the uploadData and signature exactly as returned by create_asset_upload_url. Downloads the uploaded bytes server-side, dedups/stores them the same way upload_asset does, and returns the file's id/url so it can be referenced from page markdown.",
  inputSchema: {
    uploadData: z.string().min(1).describe('The uploadData string returned by create_asset_upload_url.'),
    signature: z.string().min(1).describe('The signature string returned by create_asset_upload_url.'),
  },
}

export async function confirmAssetUpload(args: { uploadData: string; signature: string }) {
  requireScope('content:write')
  const ctx = getMcpContext()

  let pending
  try {
    pending = verifyPendingUpload(args.uploadData, args.signature)
  } catch {
    throw new ValidationError('Invalid or tampered upload token')
  }

  console.log(
    `[mcp:confirm_asset_upload] userId=${ctx.userId} skriptId=${pending.skriptId} client=${ctx.clientName}`
  )

  if (pending.userId !== ctx.userId) {
    throw new PermissionDeniedError('This upload token was issued to a different user')
  }
  if (new Date(pending.expiresAt) < new Date()) {
    throw new ValidationError('Upload URL expired — call create_asset_upload_url again')
  }

  const skript = await prisma.skript.findFirst({
    where: { id: pending.skriptId, authors: { some: { userId: ctx.userId } } },
  })
  if (!skript) {
    throw new PermissionDeniedError('Skript not found or you are not an author')
  }

  const bucket = getTeacherBucketName()
  let buffer: Buffer
  try {
    buffer = await downloadFromS3(pending.tempKey, bucket)
  } catch {
    throw new ValidationError(
      'Upload not found at the presigned URL. Did the PUT succeed? Check the response status and Content-Type header.'
    )
  }

  if (buffer.length !== pending.size) {
    await deleteFromS3(pending.tempKey, bucket).catch(() => {})
    throw new ValidationError(
      `File size mismatch. Expected ${pending.size} bytes, got ${buffer.length} bytes — re-run create_asset_upload_url and re-upload.`
    )
  }

  let savedFile
  try {
    savedFile = await saveFile({
      buffer,
      filename: pending.filename,
      skriptId: pending.skriptId,
      userId: ctx.userId,
      parentId: pending.parentId,
      contentType: pending.contentType,
      overwrite: pending.overwrite,
    })
  } catch (err) {
    if (err instanceof Error && err.message.includes('File already exists')) {
      throw new ConflictError(
        `A file named "${pending.filename}" already exists in this location. Pass overwrite=true to create_asset_upload_url to replace it.`
      )
    }
    throw err
  } finally {
    await deleteFromS3(pending.tempKey, bucket).catch(() => {})
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: savedFile.id,
            name: pending.filename,
            size: savedFile.size,
            url: savedFile.url,
            skriptId: pending.skriptId,
            parentId: pending.parentId,
          },
          null,
          2
        ),
      },
    ],
  }
}
