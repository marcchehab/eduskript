import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { invalidateSkriptFiles } from '@/lib/skript-files.server'

// Mux webhook signature verification
function verifyWebhookSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false

  // Mux sends: t=<timestamp>,v1=<signature>
  const parts = signature.split(',')
  const timestamp = parts.find(p => p.startsWith('t='))?.slice(2)
  const sig = parts.find(p => p.startsWith('v1='))?.slice(3)

  if (!timestamp || !sig) return false

  // Reject timestamps older than 5 minutes
  const age = Math.abs(Date.now() / 1000 - parseInt(timestamp))
  if (age > 300) return false

  const payload = `${timestamp}.${body}`
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')

  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const signature = request.headers.get('mux-signature')
    const secret = process.env.MUX_WEBHOOK_SECRET

    if (secret) {
      if (!verifyWebhookSignature(body, signature, secret)) {
        console.error('Mux webhook: invalid signature')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    const event = JSON.parse(body)
    const eventType = event.type as string
    const data = event.data as Record<string, unknown>

    if (eventType === 'video.upload.asset_created') {
      // Upload complete, asset is being processed
      const uploadId = data.id as string
      const assetId = data.asset_id as string

      if (uploadId && assetId) {
        await prisma.video.updateMany({
          where: { muxUploadId: uploadId },
          data: {
            muxAssetId: assetId,
            metadata: { status: 'processing' },
          },
        })
      }
    } else if (eventType === 'video.asset.ready') {
      const assetId = data.id as string
      const playbackIds = data.playback_ids as Array<{ id: string; policy: string }> | undefined
      const playbackId = playbackIds?.[0]?.id
      const aspectRatio = data.aspect_ratio as string | undefined

      if (assetId && playbackId) {
        // Parse aspect ratio string (e.g. "16:9") to number
        let aspectRatioNum: number | undefined
        if (aspectRatio) {
          const [w, h] = aspectRatio.split(':').map(Number)
          if (w && h) aspectRatioNum = w / h
        }

        const poster = `https://image.mux.com/${playbackId}/thumbnail.webp?time=0`

        await prisma.video.updateMany({
          where: { muxAssetId: assetId },
          data: {
            metadata: {
              playbackId,
              poster,
              aspectRatio: aspectRatioNum,
              status: 'ready',
            },
          },
        })
      }
    } else if (eventType === 'video.asset.errored') {
      const assetId = data.id as string

      if (assetId) {
        const errors = data.errors as Record<string, unknown> | undefined
        await prisma.video.updateMany({
          where: { muxAssetId: assetId },
          data: {
            metadata: {
              status: 'errored',
              error: errors?.type || 'Unknown error',
            },
          },
        })
      }
    }

    // Playback ids and status live in Video.metadata, which markdown renders
    // read through getSkriptFiles. The webhook only knows an upload/asset id,
    // and a video is M2M with skripts, so drop the whole file cache.
    invalidateSkriptFiles()

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Mux webhook error:', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}
