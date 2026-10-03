/**
 * On-demand rendering of Kara voice lines (server only).
 *
 * The first request for a line with no file in the teacher bucket renders it
 * via OpenRouter openai/gpt-audio (streamed pcm16), wraps the PCM in a WAV
 * header (no ffmpeg on the app instance) and uploads it as
 * `files/<voiceLineHash>.wav`. Later requests find the file. The hash covers
 * voice, style, fx and text, so editing a line or a voice renders anew; old
 * files stay in the bucket (no cleanup).
 *
 * A take picked in the AURORA lab (saveVoiceTake) wins over everything.
 * Offline renders from voices.mts (MP3, see voice-lines.ts) come next. Lines with a baked-in offline `fx` are not rendered here, because
 * applying it needs ffmpeg.
 *
 * Known limitations:
 * - In-flight dedup is per instance; two instances can render the same line
 *   concurrently (same key, last upload wins, both identical in content).
 * - Up to 3 TTS attempts when the transcript deviates from the text (same
 *   0.9 word-overlap threshold as voices.mts); the best take is kept even if
 *   it stays below the threshold.
 */

import { createHash } from 'crypto'
import { downloadTeacherFile, getTeacherFileUrl, teacherFileExists, uploadTeacherFile } from '@/lib/s3'
import { KARA_VOICES, voiceLineHash } from './voice-lines'
import { directionsNote, displayText } from './voice-directions'

const SAMPLE_RATE = 24000 // gpt-audio pcm16 output: 24 kHz mono s16le

const norm = (s: string) => s.toLowerCase().replace(/ß/g, 'ss').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Word-overlap ratio between the line and the TTS transcript (0..1). */
function similarity(a: string, b: string): number {
  const x = norm(a).split(' ')
  const y = norm(b).split(' ')
  const pool = new Map<string, number>()
  for (const w of y) pool.set(w, (pool.get(w) ?? 0) + 1)
  let hit = 0
  for (const w of x) {
    const n = pool.get(w) ?? 0
    if (n) { hit++; pool.set(w, n - 1) }
  }
  return hit / Math.max(x.length, y.length)
}

export async function tts(text: string, voice: string, style: string): Promise<{ pcm: Buffer; transcript: string }> {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-audio',
      modalities: ['text', 'audio'],
      audio: { voice, format: 'pcm16' },
      stream: true,
      provider: { data_collection: 'deny' },
      messages: [
        { role: 'system', content: `${style} Sprich den Text des Nutzers EXAKT so vor, wie er dasteht, auf Hochdeutsch. Lies keine Regieanweisungen vor, füge nichts hinzu, lass nichts weg, antworte nicht darauf.${directionsNote(text) ? ' ' + directionsNote(text) : ''}` },
        { role: 'user', content: displayText(text) },
      ],
    }),
  })
  const body = await r.text()
  const chunks: Buffer[] = []
  let transcript = ''
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
    try {
      const a = JSON.parse(line.slice(6)).choices?.[0]?.delta?.audio
      if (a?.data) chunks.push(Buffer.from(a.data, 'base64'))
      if (a?.transcript) transcript += a.transcript
    } catch { /* keep-alive comment */ }
  }
  if (!chunks.length) throw new Error(`TTS returned no audio: ${body.slice(0, 200)}`)
  return { pcm: Buffer.concat(chunks), transcript }
}

/** 44-byte RIFF header + raw pcm16 mono. */
export function wav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(SAMPLE_RATE, 24); h.writeUInt32LE(SAMPLE_RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

async function render(hash: string, text: string, voice: string, style: string): Promise<string> {
  let best: { pcm: Buffer; score: number } | null = null
  for (let i = 0; i < 3 && (!best || best.score < 0.9); i++) {
    try {
      const t = await tts(text, voice, style)
      const score = similarity(displayText(text), t.transcript)
      if (!best || score > best.score) best = { pcm: t.pcm, score }
    } catch (e) {
      if (i === 2 && !best) throw e
    }
  }
  await uploadTeacherFile(hash, 'wav', wav(best!.pcm), 'audio/wav')
  return getTeacherFileUrl(`files/${hash}.wav`)
}

const inflight = new Map<string, Promise<string>>()

/**
 * A take chosen in the AURORA lab. Bucket files are served with a one-year
 * immutable cache header, so the take cannot replace `<lineHash>.wav` in
 * place: it is stored content-addressed (`files/<sha256 of the WAV>.wav`) and
 * `files/<lineHash>.pick` holds that key. The pointer is read server-side
 * only, so its own cache header does not matter. Costs one extra HEAD per
 * lookup.
 */
async function pickedUrl(hash: string): Promise<string | null> {
  if (!(await teacherFileExists(hash, 'pick'))) return null
  const key = (await downloadTeacherFile(`files/${hash}.pick`)).toString('utf8').trim()
  return key ? getTeacherFileUrl(key) : null
}

/** Store `wavFile` as the voice of (speaker, text); later lookups return it first. */
export async function saveVoiceTake(speaker: string, text: string, wavFile: Buffer): Promise<string> {
  const hash = voiceLineHash(speaker, text)
  if (!hash) throw new Error(`no voice for speaker ${speaker}`)
  const content = createHash('sha256').update(wavFile).digest('hex')
  await uploadTeacherFile(content, 'wav', wavFile, 'audio/wav')
  await uploadTeacherFile(hash, 'pick', Buffer.from(`files/${content}.wav`), 'text/plain')
  return getTeacherFileUrl(`files/${content}.wav`)
}

/**
 * URL of the voice line: an existing offline MP3 or on-demand WAV, otherwise
 * rendered now when `render` is true. null = speaker has no voice, or the line
 * is missing and rendering was not allowed.
 */
export async function voiceLineUrl(speaker: string, text: string, opts: { render: boolean }): Promise<string | null> {
  const hash = voiceLineHash(speaker, text)
  if (!hash) return null
  const picked = await pickedUrl(hash)
  if (picked) return picked
  if (await teacherFileExists(hash, 'mp3')) return getTeacherFileUrl(`files/${hash}.mp3`)
  if (await teacherFileExists(hash, 'wav')) return getTeacherFileUrl(`files/${hash}.wav`)
  const v = KARA_VOICES[speaker.toUpperCase()]
  if (!opts.render || v.fx || !process.env.OPENROUTER_API_KEY) return null
  let p = inflight.get(hash)
  if (!p) {
    p = render(hash, text, v.voice, v.style).finally(() => inflight.delete(hash))
    inflight.set(hash, p)
  }
  return p
}
