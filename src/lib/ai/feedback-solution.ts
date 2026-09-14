/**
 * Loads the teacher's reference solution for an <ai-feedback solution="...">
 * tag and returns it as a PNG data URL for the vision model.
 *
 * The filename comes from the stored page content (feedback-context.ts), is
 * looked up in the skript's files and downloaded from S3 here, server-side.
 * The client component never receives the attribute, so the solution is not
 * rendered or linked on the page.
 * Limitation: the file is still a public S3 object, and pages that pass the
 * skript's full SkriptFilesData to a client component (e.g. any excalidraw
 * image) list every file URL of the skript in the RSC payload — so a
 * determined student can find it. Fine for practice exercises, not a secret.
 *
 * Name resolution: solutionFilename() in feedback-context.ts.
 *
 * Every image goes through sharp: SVGs are rasterized (the vision model takes
 * no SVG), everything is flattened onto white (Excalidraw exports are
 * transparent) and capped at MAX_EDGE px.
 * Limitation: librsvg ignores the @font-face fonts Excalidraw embeds, so text
 * in the drawing renders in whatever system font fontconfig finds. If the host
 * has no fonts at all, text in the drawing is dropped.
 *
 * @see src/lib/ai/feedback-context.ts - parses the attribute
 * @see src/app/api/ai/feedback/route.ts - consumer
 * @see src/lib/skript-files.ts resolveExcalidraw - same naming convention
 */

import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { getS3Key } from '@/lib/file-storage'
import { downloadTeacherFile } from '@/lib/s3'
import { solutionFilename } from '@/lib/ai/feedback-context'

const MAX_EDGE = 1600

/**
 * @returns PNG data URL, or null if the file doesn't exist in the skript or
 *   can't be read/decoded (logged; the feedback request proceeds without it).
 */
export async function loadSolutionImage(skriptId: string, name: string): Promise<string | null> {
  const filename = solutionFilename(name)
  try {
    const file = await prisma.file.findFirst({
      where: { skriptId, name: filename, isDirectory: false },
      select: { hash: true },
    })
    // Files without a hash predate S3 storage; not supported here.
    if (!file?.hash) {
      console.warn(`[ai-feedback] solution file not found in skript ${skriptId}: ${filename}`)
      return null
    }
    const ext = filename.split('.').pop()!.toLowerCase()
    const buffer = await downloadTeacherFile(getS3Key(file.hash, ext))
    // density 144 = 2x the SVG's CSS px, so thin strokes survive the downscale.
    const png = await sharp(buffer, ext === 'svg' ? { density: 144 } : undefined)
      .flatten({ background: '#ffffff' })
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch (error) {
    console.error(`[ai-feedback] could not load solution ${filename}:`, error)
    return null
  }
}
