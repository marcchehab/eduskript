// Uploader for onboarding-quest and help clips (skript-less Video rows, see
// src/app/api/onboarding-quest/step-videos/route.ts and src/lib/help-videos/store.ts).
// Usage: node scripts/upload-onboarding-video.mjs <path-to-mp4> <logical-filename>
// e.g.:  node scripts/upload-onboarding-video.mjs onboarding-videos/step1.mp4 onboarding-step1.mp4
//
// Same path as a dashboard upload (POST /api/videos/upload-url + /uploaded):
// PUTs the file into the teacher bucket under video-uploads/, creates an encode
// job ("s3:<key>") and points a provider "self" Video row at it (status
// "queued"). The encoder (scripts/video-worker.mjs) does the rest; the clip
// plays once the row is "ready". Keyed by `filename`, so re-running with the
// same filename swaps the clip without any code change.
//
// Limitation: on a re-run the previous job's outputs and original upload stay
// in S3 (no cleanup here; delete the old job's prefix by hand if it matters).
//
// Env: DATABASE_URL, SCW_TEACHER_BUCKET, S3_* / SCW_* (same as src/lib/s3.ts),
// VIDEO_S3_PREFIX (optional).
import 'dotenv/config'
import { randomBytes, randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const [, , filePath, logicalFilename] = process.argv
if (!filePath || !logicalFilename) {
  console.error('Usage: node scripts/upload-onboarding-video.mjs <path-to-mp4> <logical-filename>')
  process.exit(1)
}

const isLocal = process.env.DATABASE_URL?.includes('localhost')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
})
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

// Same S3 config resolution as scripts/video-worker.mjs.
function s3Client() {
  const region = process.env.S3_REGION || process.env.SCW_REGION || 'fr-par'
  return new S3Client({
    region,
    endpoint: process.env.S3_ENDPOINT || `https://s3.${region}.scw.cloud`,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || process.env.SCW_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY || process.env.SCW_SECRET_KEY,
    },
  })
}

async function main() {
  const bucket = process.env.SCW_TEACHER_BUCKET
  if (!bucket) throw new Error('SCW_TEACHER_BUCKET not set')
  const prefix = process.env.VIDEO_S3_PREFIX ?? ''
  const ext = (filePath.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
  // Mirrors newUploadKey / newOutputPrefix in src/lib/video-jobs.server.ts.
  const uploadKey = `${prefix}video-uploads/${randomBytes(16).toString('hex')}.${ext}`
  const outputPrefix = `${prefix}videos/${randomUUID()}/`

  const body = readFileSync(filePath)
  console.log(`Uploading ${filePath} (${(body.length / 1024).toFixed(0)} KB) → ${uploadKey}`)
  await s3Client().send(new PutObjectCommand({
    Bucket: bucket,
    Key: uploadKey,
    Body: body,
    ContentType: ext === 'mov' ? 'video/quicktime' : 'video/mp4',
  }))

  const admin = await prisma.user.findFirst({ where: { isAdmin: true } })
  if (!admin) throw new Error('No admin user found to attribute the upload to')

  const metadata = { status: 'queued', uploadKey }
  const video = await prisma.$transaction(async (tx) => {
    const job = await tx.videoEncodeJob.create({ data: { source: `s3:${uploadKey}`, outputPrefix } })
    const existing = await tx.video.findFirst({
      where: { filename: logicalFilename, provider: 'self' },
    })
    if (existing) {
      return tx.video.update({
        where: { id: existing.id },
        data: { metadata, encodeJobId: job.id },
      })
    }
    return tx.video.create({
      data: {
        filename: logicalFilename,
        provider: 'self',
        metadata,
        uploadedById: admin.id,
        encodeJobId: job.id,
      },
    })
  })

  console.log(`Video row ${video.id} (${logicalFilename}) queued as job ${video.encodeJobId}.`)
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
