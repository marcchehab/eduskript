/**
 * MCP tool: create_asset_upload_url — step 1 of the presigned-upload pair.
 *
 * upload_asset requires the file's bytes inline as base64 in the tool call,
 * which means the calling model has to read the file and paste its content
 * into the request — fine for a small pasted screenshot, wasteful and
 * error-prone for local files (large base64 blobs eat context, and hand-built
 * payloads are easy to truncate). This tool instead returns a presigned S3
 * PUT URL: the caller uploads the raw file straight from disk (e.g.
 * `curl -T <path> -H "Content-Type: <contentType>" "<uploadUrl>"`), so bytes
 * never pass through the model's context or the MCP JSON-RPC payload. Finish
 * with confirm_asset_upload once the PUT succeeds.
 */

import { z } from 'zod'
import { randomBytes } from 'crypto'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { sanitizeFilename, validateFile, getFileExtension, getMimeType } from '@/lib/file-storage'
import { generatePresignedUploadUrl, isTeacherS3Configured, getTeacherBucketName } from '@/lib/s3'
import { PermissionDeniedError, NotFoundError, ValidationError } from '@/lib/services/pages'
import { signPendingUpload } from '@/lib/mcp/tools/asset-upload-token'

// Matches the dashboard's own presigned-upload TTL (src/app/api/upload/presigned/route.ts).
const UPLOAD_URL_TTL_SECONDS = 1800

export const createAssetUploadUrlConfig = {
  title: 'Create asset upload URL',
  description:
    'Step 1 of a two-step upload for local files — use this instead of upload_asset when the content is not already inline (a file on disk), since it avoids reading the file into base64 yourself. Returns a presigned S3 PUT URL: upload the raw file to it directly (e.g. `curl -T <path> -H "Content-Type: <contentType>" "<uploadUrl>"`), then call confirm_asset_upload with the returned token, uploadData and signature to finish. The URL expires in 30 minutes. The caller must be a direct author on the skript.',
  inputSchema: {
    skriptId: z.string().min(1).describe('Skript ID to upload the file into.'),
    filename: z.string().min(1).describe('Filename including extension, e.g. "diagram.png".'),
    size: z.number().int().positive().describe('File size in bytes.'),
    contentType: z
      .string()
      .optional()
      .describe('MIME type to sign the URL with, and to send as the Content-Type header on the PUT. Defaults to a type inferred from the filename extension.'),
    parentId: z
      .string()
      .optional()
      .describe('Directory (File with isDirectory=true) to upload into. Omit for skript root.'),
    overwrite: z
      .boolean()
      .optional()
      .describe('Replace an existing file with the same name (default false).'),
  },
}

export async function createAssetUploadUrl(args: {
  skriptId: string
  filename: string
  size: number
  contentType?: string
  parentId?: string
  overwrite?: boolean
}) {
  requireScope('content:write')
  const ctx = getMcpContext()
  console.log(
    `[mcp:create_asset_upload_url] userId=${ctx.userId} skriptId=${args.skriptId} client=${ctx.clientName}`
  )

  if (!isTeacherS3Configured()) {
    throw new ValidationError('File storage not configured on this deployment.')
  }

  const skript = await prisma.skript.findFirst({
    where: { id: args.skriptId, authors: { some: { userId: ctx.userId } } },
  })
  if (!skript) {
    throw new PermissionDeniedError('Skript not found or you are not an author')
  }

  if (args.parentId) {
    const parent = await prisma.file.findFirst({
      where: { id: args.parentId, skriptId: args.skriptId, isDirectory: true },
    })
    if (!parent) throw new NotFoundError('Target directory not found in this skript')
  }

  const filename = sanitizeFilename(args.filename)
  const validation = validateFile(filename, args.size)
  if (!validation.valid) {
    throw new ValidationError(validation.error!)
  }

  const extension = getFileExtension(filename)!
  const contentType = args.contentType || getMimeType(extension)
  const token = randomBytes(32).toString('hex')
  const tempKey = `uploads/pending/mcp-${token}.${extension}`
  const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000)

  const { url } = await generatePresignedUploadUrl(
    tempKey,
    contentType,
    UPLOAD_URL_TTL_SECONDS,
    getTeacherBucketName()
  )

  const { uploadData, signature } = signPendingUpload({
    token,
    filename,
    size: args.size,
    contentType,
    skriptId: args.skriptId,
    userId: ctx.userId,
    parentId: args.parentId || null,
    overwrite: args.overwrite ?? false,
    tempKey,
    expiresAt: expiresAt.toISOString(),
  })

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            uploadUrl: url,
            contentType,
            uploadData,
            signature,
            expiresAt: expiresAt.toISOString(),
          },
          null,
          2
        ),
      },
    ],
  }
}
