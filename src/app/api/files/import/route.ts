import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/files/import
 * Body: { sourceFileId: string, targetSkriptId: string }
 *
 * Cross-skript file import: clones a File row from source to target skript
 * without re-uploading the underlying bytes. The new row reuses the source's
 * `hash`, so both rows point at the same S3 object — content-addressed
 * dedup at zero storage cost.
 *
 * Permission rules:
 *   - User must have author rights on the SOURCE skript (you can only reuse
 *     files from skripts you actually own).
 *   - User must have author rights on the TARGET skript (you can only add
 *     files to skripts you can edit).
 *
 * Conflict handling:
 *   - If a file with the same name already exists in the target skript at
 *     parentId=null, returns 409 with `{ error, existingFileId }`. The
 *     client decides what to do (rename and retry, or surface the conflict
 *     to the user).
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { sourceFileId?: unknown; targetSkriptId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { sourceFileId, targetSkriptId } = body
  if (typeof sourceFileId !== 'string' || typeof targetSkriptId !== 'string') {
    return NextResponse.json(
      { error: 'sourceFileId and targetSkriptId are required strings' },
      { status: 400 }
    )
  }

  const userId = session.user.id

  // Load source file with its skript's authors so we can check permission
  const sourceFile = await prisma.file.findUnique({
    where: { id: sourceFileId },
    include: {
      skript: {
        select: {
          id: true,
          authors: {
            where: { userId },
            select: { permission: true },
          },
        },
      },
    },
  })

  if (!sourceFile) {
    return NextResponse.json({ error: 'Source file not found' }, { status: 404 })
  }

  if (sourceFile.isDirectory) {
    return NextResponse.json({ error: 'Cannot import directories' }, { status: 400 })
  }

  if (!sourceFile.hash) {
    return NextResponse.json(
      { error: 'Source file has no content hash (upload may be incomplete)' },
      { status: 400 }
    )
  }

  const sourceIsAuthor = sourceFile.skript.authors.some(a => a.permission === 'author')
  if (!sourceIsAuthor) {
    return NextResponse.json(
      { error: 'You need author rights on the source skript' },
      { status: 403 }
    )
  }

  // Verify target skript exists and user is author
  const targetSkript = await prisma.skript.findFirst({
    where: {
      id: targetSkriptId,
      authors: { some: { userId, permission: 'author' } },
    },
    select: { id: true },
  })
  if (!targetSkript) {
    return NextResponse.json(
      { error: 'You need author rights on the target skript' },
      { status: 403 }
    )
  }

  // Same skript? No-op — refuse rather than silently duplicate.
  if (sourceFile.skriptId === targetSkriptId) {
    return NextResponse.json(
      { error: 'Source and target skript are the same' },
      { status: 400 }
    )
  }

  // Conflict check (file with same name at parentId=null in target)
  const conflicting = await prisma.file.findFirst({
    where: {
      skriptId: targetSkriptId,
      parentId: null,
      name: sourceFile.name,
    },
    select: { id: true },
  })
  if (conflicting) {
    return NextResponse.json(
      {
        error: `A file named "${sourceFile.name}" already exists in the target skript`,
        existingFileId: conflicting.id,
      },
      { status: 409 }
    )
  }

  // Create the imported File row — same hash, new skriptId, new id
  const imported = await prisma.file.create({
    data: {
      name: sourceFile.name,
      isDirectory: false,
      skriptId: targetSkriptId,
      parentId: null,
      hash: sourceFile.hash,
      contentType: sourceFile.contentType,
      size: sourceFile.size,
      width: sourceFile.width,
      height: sourceFile.height,
      createdBy: userId,
    },
    select: {
      id: true,
      name: true,
      hash: true,
      contentType: true,
      size: true,
      skriptId: true,
    },
  })

  return NextResponse.json({
    file: {
      id: imported.id,
      name: imported.name,
      hash: imported.hash,
      contentType: imported.contentType,
      size: imported.size != null ? Number(imported.size) : null,
      skriptId: imported.skriptId,
    },
  })
}
