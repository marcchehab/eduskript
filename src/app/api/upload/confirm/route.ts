import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  downloadFromS3,
  deleteFromS3,
  uploadTeacherFile,
  teacherFileExists,
  getTeacherBucketName,
  getTeacherFileUrl
} from '@/lib/s3'
import { createHash } from 'crypto'
import { invalidateSkriptFiles } from '@/lib/skript-files.server'

/**
 * Confirm a direct S3 upload and create the database record
 *
 * After client uploads directly to S3 using presigned URL, they call this
 * endpoint to:
 * 1. Verify the upload completed successfully
 * 2. Calculate content hash and move to content-addressed storage
 * 3. Create the database record
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { uploadToken, uploadData, signature } = body

    if (!uploadToken || !uploadData || !signature) {
      return NextResponse.json(
        { error: 'Missing required fields: uploadToken, uploadData, signature' },
        { status: 400 }
      )
    }

    // Verify signature
    const dataString = Buffer.from(uploadData, 'base64').toString('utf-8')
    const expectedSignature = createHash('sha256')
      .update(dataString + process.env.NEXTAUTH_SECRET)
      .digest('hex')
      .slice(0, 16)

    if (signature !== expectedSignature) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    // Parse upload data
    const data = JSON.parse(dataString)
    const { filename, size, contentType, skriptId, userId, tempKey, expiresAt } = data

    // Verify this is the same user who requested the upload
    if (userId !== session.user.id) {
      return NextResponse.json({ error: 'User mismatch' }, { status: 403 })
    }

    // Check if upload expired
    if (new Date(expiresAt) < new Date()) {
      return NextResponse.json({ error: 'Upload expired' }, { status: 400 })
    }

    // Verify user still has access to skript
    const skript = await prisma.skript.findFirst({
      where: {
        id: skriptId,
        authors: {
          some: {
            userId: session.user.id
          }
        }
      }
    })

    if (!skript) {
      return NextResponse.json({ error: 'Skript not found or access denied' }, { status: 403 })
    }

    // Download the uploaded file from temp location to calculate hash
    const bucket = getTeacherBucketName()
    let buffer: Buffer

    try {
      buffer = await downloadFromS3(tempKey, bucket)
    } catch (error) {
      console.error('Failed to download uploaded file:', error)
      return NextResponse.json(
        { error: 'Upload not found. The file may not have been uploaded yet or the upload failed.' },
        { status: 404 }
      )
    }

    // Verify size matches
    if (buffer.length !== size) {
      // Clean up the temp file
      await deleteFromS3(tempKey, bucket).catch(() => {})
      return NextResponse.json(
        { error: `File size mismatch. Expected ${size} bytes, got ${buffer.length} bytes.` },
        { status: 400 }
      )
    }

    // Calculate content hash
    const hash = createHash('sha256').update(buffer).digest('hex')
    const extension = filename.split('.').pop() || 'bin'

    // Check if this content already exists (deduplication)
    const existsInS3 = await teacherFileExists(hash, extension)

    if (!existsInS3) {
      // Upload to content-addressed location
      await uploadTeacherFile(hash, extension, buffer, contentType, filename)
    }

    // Delete the temp file
    await deleteFromS3(tempKey, bucket).catch((error) => {
      console.warn('Failed to delete temp file:', error)
    })

    // Check if file with same name already exists in this skript
    const existingFile = await prisma.file.findFirst({
      where: {
        name: filename,
        skriptId
      }
    })

    if (existingFile) {
      // Update existing file record
      await prisma.file.update({
        where: { id: existingFile.id },
        data: {
          hash,
          contentType,
          size: BigInt(size),
          updatedAt: new Date()
        }
      })

      invalidateSkriptFiles(skriptId)

      return NextResponse.json({
        id: existingFile.id,
        name: filename,
        size,
        type: contentType,
        hash,
        url: getTeacherFileUrl(`files/${hash}.${extension}`),
        uploadType: 'skript',
        skriptId,
        uploadedAt: new Date().toISOString(),
        updated: true
      })
    }

    // Create new file record
    const savedFile = await prisma.file.create({
      data: {
        name: filename,
        isDirectory: false,
        skriptId,
        hash,
        contentType,
        size: BigInt(size),
        createdBy: session.user.id
      }
    })

    invalidateSkriptFiles(skriptId)

    return NextResponse.json({
      id: savedFile.id,
      name: filename,
      size,
      type: contentType,
      hash,
      url: getTeacherFileUrl(`files/${hash}.${extension}`),
      uploadType: 'skript',
      skriptId,
      uploadedAt: new Date().toISOString()
    })
  } catch (error) {
    console.error('Upload confirm error:', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to confirm upload' },
      { status: 500 }
    )
  }
}
