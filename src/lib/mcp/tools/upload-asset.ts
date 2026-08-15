/**
 * MCP tool: upload_asset — upload a file to a skript's file storage.
 *
 * Requires content:write scope. Content arrives base64-encoded in the JSON
 * tool call, decoded and passed to the same `saveFile()` used by the
 * dashboard's multipart upload route (src/app/api/upload/route.ts) — same
 * dedup/hash/S3 path. Base64 inflates payload size ~33%, and MCP tool calls
 * aren't suited to raw byte streams, so this caps well below the 500MB
 * presigned-upload limit; anything bigger should go through the dashboard.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { saveFile, sanitizeFilename, validateFile } from '@/lib/file-storage'
import { PermissionDeniedError, NotFoundError, ValidationError, ConflictError } from '@/lib/services/pages'

// Base64 payload cap. Raw bytes are ~3/4 of this after decoding.
const MAX_BASE64_SIZE = 8 * 1024 * 1024 // 8MB base64 (~6MB decoded)

export const uploadAssetConfig = {
  title: 'Upload asset',
  description:
    "Upload a file (image, CSV, etc.) to a skript's file storage, so it can be referenced from page markdown (e.g. `![](name.png)`) or a code editor's `assets=\"name.csv\"` attribute. Content must be base64-encoded; capped at 8MB base64 (~6MB decoded) — for larger files, direct the teacher to the dashboard's upload UI instead. The caller must be a direct author on the skript.",
  inputSchema: {
    skriptId: z.string().min(1).describe('Skript ID to upload the file into.'),
    filename: z.string().min(1).describe('Filename including extension, e.g. "diagram.png".'),
    contentBase64: z.string().min(1).describe('File content, base64-encoded.'),
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

export async function uploadAsset(args: {
  skriptId: string
  filename: string
  contentBase64: string
  parentId?: string
  overwrite?: boolean
}) {
  requireScope('content:write')
  const ctx = getMcpContext()
  console.log(`[mcp:upload_asset] userId=${ctx.userId} skriptId=${args.skriptId} client=${ctx.clientName}`)

  if (args.contentBase64.length > MAX_BASE64_SIZE) {
    throw new ValidationError(
      `File too large for MCP upload. Maximum base64 payload is ${MAX_BASE64_SIZE / 1048576}MB. Use the dashboard upload UI for larger files.`
    )
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

  const sanitizedFilename = sanitizeFilename(args.filename)
  let buffer: Buffer
  try {
    buffer = Buffer.from(args.contentBase64, 'base64')
  } catch {
    throw new ValidationError('contentBase64 is not valid base64')
  }

  const validation = validateFile(sanitizedFilename, buffer.length)
  if (!validation.valid) {
    throw new ValidationError(validation.error!)
  }

  let savedFile
  try {
    savedFile = await saveFile({
      buffer,
      filename: sanitizedFilename,
      skriptId: args.skriptId,
      userId: ctx.userId,
      parentId: args.parentId || null,
      overwrite: args.overwrite ?? false,
    })
  } catch (err) {
    if (err instanceof Error && err.message.includes('File already exists')) {
      throw new ConflictError(
        `A file named "${sanitizedFilename}" already exists in this location. Pass overwrite=true to replace it.`
      )
    }
    throw err
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: savedFile.id,
            name: sanitizedFilename,
            size: savedFile.size,
            url: savedFile.url,
            skriptId: args.skriptId,
            parentId: args.parentId || null,
          },
          null,
          2
        ),
      },
    ],
  }
}
