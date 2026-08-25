// One-off uploader for onboarding-quest tutorial clips (onboarding-videos/stepN.mp4).
// Usage: node scripts/upload-onboarding-video.mjs <path-to-mp4> <logical-filename>
// e.g.:  node scripts/upload-onboarding-video.mjs onboarding-videos/step1.mp4 onboarding-step1.mp4
//
// Creates a Mux direct upload, PUTs the local file to it, polls until the
// asset is ready, then upserts a skript-less Video row (same shape as
// POST /api/admin/videos) keyed by `filename` so re-running with the same
// filename swaps the clip without any code change.
import 'dotenv/config'
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import Mux from '@mux/mux-node'

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

const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
})

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const fileBuffer = readFileSync(filePath)
  console.log(`Uploading ${filePath} (${(fileBuffer.length / 1024).toFixed(0)} KB)...`)

  const upload = await mux.video.uploads.create({
    new_asset_settings: { playback_policy: ['public'] },
    cors_origin: '*',
  })

  const putRes = await fetch(upload.url, { method: 'PUT', body: fileBuffer })
  if (!putRes.ok) {
    throw new Error(`Upload PUT failed: ${putRes.status} ${await putRes.text()}`)
  }

  console.log('Uploaded, waiting for Mux to attach an asset...')
  let assetId
  for (let i = 0; i < 30; i++) {
    const status = await mux.video.uploads.retrieve(upload.id)
    if (status.asset_id) {
      assetId = status.asset_id
      break
    }
    if (status.status === 'errored') throw new Error(`Mux upload errored: ${JSON.stringify(status.error)}`)
    await sleep(2000)
  }
  if (!assetId) throw new Error('Timed out waiting for asset_id')

  console.log(`Asset ${assetId} created, waiting for it to be ready...`)
  let asset
  for (let i = 0; i < 60; i++) {
    asset = await mux.video.assets.retrieve(assetId)
    if (asset.status === 'ready') break
    if (asset.status === 'errored') throw new Error(`Mux asset errored: ${JSON.stringify(asset.errors)}`)
    await sleep(3000)
  }
  if (asset.status !== 'ready') throw new Error(`Timed out waiting for asset to be ready (status: ${asset.status})`)

  const playbackId = asset.playback_ids?.[0]?.id
  if (!playbackId) throw new Error('Ready asset has no playback_ids')

  // Mux's asset.tracks video entry reports max_width/max_height, not width/height.
  const track = asset.tracks?.find((t) => t.type === 'video')
  const aspectRatio = track?.max_width && track?.max_height ? track.max_width / track.max_height : undefined

  const metadata = {
    playbackId,
    status: 'ready',
    poster: `https://image.mux.com/${playbackId}/thumbnail.webp?time=0`,
    ...(aspectRatio ? { aspectRatio } : {}),
  }

  const admin = await prisma.user.findFirst({ where: { isAdmin: true } })
  if (!admin) throw new Error('No admin user found to attribute the upload to')

  const existing = await prisma.video.findFirst({
    where: { filename: logicalFilename, provider: 'mux' },
  })

  let video
  if (existing) {
    video = await prisma.video.update({
      where: { id: existing.id },
      data: { metadata, muxAssetId: assetId, muxUploadId: upload.id },
    })
    console.log(`Updated existing Video row ${video.id} (${logicalFilename})`)
  } else {
    video = await prisma.video.create({
      data: {
        filename: logicalFilename,
        provider: 'mux',
        metadata,
        uploadedById: admin.id,
        muxAssetId: assetId,
        muxUploadId: upload.id,
      },
    })
    console.log(`Created Video row ${video.id} (${logicalFilename})`)
  }

  console.log(`playbackId: ${playbackId}`)
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
