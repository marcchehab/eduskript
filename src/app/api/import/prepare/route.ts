import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generatePresignedUploadUrl, isS3Configured } from '@/lib/s3'
import { nanoid } from 'nanoid'

/**
 * POST /api/import/prepare
 *
 * Prepares for a large file import by:
 * 1. Checking if user has an active import job (only one allowed at a time)
 * 2. Creating a new ImportJob record
 * 3. Generating a presigned S3 upload URL
 *
 * Returns:
 * - jobId: ID of the created ImportJob
 * - uploadUrl: Presigned URL for direct S3 upload
 * - s3Key: The S3 key where the file will be stored
 * - expiresAt: When the presigned URL expires
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if S3 is configured
    if (!isS3Configured()) {
      return NextResponse.json(
        { error: 'S3 not configured. Large file imports require S3 storage.' },
        { status: 503 }
      )
    }

    const userId = session.user.id

    // Get request body for filename
    let fileName = 'import.zip'
    let fileSize: bigint | undefined
    try {
      const body = await request.json()
      if (body.fileName) fileName = body.fileName
      if (body.fileSize) fileSize = BigInt(body.fileSize)
    } catch {
      // Body is optional
    }

    // Check for existing active import job
    const activeJob = await prisma.importJob.findFirst({
      where: {
        userId,
        status: {
          in: ['pending', 'uploading', 'processing']
        }
      }
    })

    if (activeJob) {
      return NextResponse.json(
        {
          error: 'You already have an active import in progress',
          activeJobId: activeJob.id,
          activeJobStatus: activeJob.status
        },
        { status: 409 }
      )
    }

    // Generate unique S3 key
    const s3Key = `imports/${userId}/${nanoid()}.zip`

    // Generate presigned upload URL (15 minutes expiry)
    const { url: uploadUrl, expiresAt } = await generatePresignedUploadUrl(
      s3Key,
      'application/zip',
      900 // 15 minutes
    )

    // Create ImportJob record
    const job = await prisma.importJob.create({
      data: {
        userId,
        type: 'import',
        status: 'pending',
        s3Key,
        fileName,
        fileSize,
        message: 'Waiting for file upload...'
      }
    })

    return NextResponse.json({
      jobId: job.id,
      uploadUrl,
      s3Key,
      expiresAt: expiresAt.toISOString()
    })
  } catch (error) {
    console.error('[import/prepare] Error:', error)
    return NextResponse.json(
      { error: 'Failed to prepare import' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/import/prepare
 *
 * Check if user has an active import job
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Find active import job
    const activeJob = await prisma.importJob.findFirst({
      where: {
        userId,
        status: {
          in: ['pending', 'uploading', 'processing']
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Also get recent completed/failed jobs for history
    const recentJobs = await prisma.importJob.findMany({
      where: {
        userId,
        status: {
          in: ['completed', 'failed', 'cancelled']
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    })

    return NextResponse.json({
      activeJob: activeJob ? {
        id: activeJob.id,
        status: activeJob.status,
        progress: activeJob.progress,
        message: activeJob.message,
        fileName: activeJob.fileName,
        createdAt: activeJob.createdAt.toISOString()
      } : null,
      recentJobs: recentJobs.map(job => ({
        id: job.id,
        status: job.status,
        fileName: job.fileName,
        result: job.result,
        error: job.error,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt?.toISOString()
      })),
      s3Configured: isS3Configured()
    })
  } catch (error) {
    console.error('[import/prepare] GET Error:', error)
    return NextResponse.json(
      { error: 'Failed to check import status' },
      { status: 500 }
    )
  }
}
