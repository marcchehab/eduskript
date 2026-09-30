/**
 * POST { speaker, text } → { url } of a pre-rendered voice line, or 404.
 *
 * Lookup only: lines are rendered offline and uploaded to the teacher bucket
 * (see src/lib/kara/voice-lines.ts). A line without a file simply stays silent.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getTeacherFileUrl, teacherFileExists } from '@/lib/s3'
import { voiceLineHash } from '@/lib/kara/voice-lines'

export async function POST(request: NextRequest) {
  const { text, speaker } = (await request.json().catch(() => ({}))) as { text?: string; speaker?: string }
  if (!text || !speaker) return NextResponse.json({ error: 'text, speaker required' }, { status: 400 })
  const hash = voiceLineHash(speaker, text)
  if (!hash || !(await teacherFileExists(hash, 'mp3'))) return NextResponse.json({ error: 'no voice line' }, { status: 404 })
  return NextResponse.json({ url: getTeacherFileUrl(`files/${hash}.mp3`) })
}
