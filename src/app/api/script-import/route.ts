/**
 * POST /api/script-import — anonymous import (no account).
 * multipart/form-data: either `file` (.docx, .pdf, or .doc/.odt/.rtf via
 * LibreOffice) or `text` (+ optional
 * `html`, the clipboard's HTML flavour), plus challenge (JSON of
 * PowChallenge), nonce, website (honeypot, must be empty). Returns { token } immediately; the
 * conversion runs after the response (next/server after()) and the preview
 * page polls GET /api/script-import/<token>.
 */
import { randomUUID } from 'crypto'
import { after, NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientIdentifier } from '@/lib/rate-limit'
import { verifySolution, type PowChallenge } from '@/lib/script-import/pow'
import { checkLimits, hashIp, MAX_FILE_BYTES, MAX_MARKDOWN_CHARS } from '@/lib/script-import/limits'
import { createImport, processImport, type ImportInput } from '@/lib/script-import/service'

// Conversion (pandoc + parallel Claude chunks) typically takes 10–60 s.
export const maxDuration = 300

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

export async function POST(request: NextRequest) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return bad('Invalid upload')
  }
  const file = form.get('file')
  const text = form.get('text')
  const html = form.get('html')
  if (form.get('website')) return bad('Invalid upload') // honeypot
  const isText = typeof text === 'string' && text.trim().length > 0
  if (!isText && !(file instanceof File)) return bad('No file uploaded')
  if (isText) {
    if (text.length > MAX_MARKDOWN_CHARS) return bad(`The text is longer than ${MAX_MARKDOWN_CHARS.toLocaleString('en')} characters.`)
    if (typeof html === 'string' && html.length > MAX_FILE_BYTES) return bad('The pasted content is too large.')
  } else if (file instanceof File) {
    if (!/\.(docx|pdf|doc|odt|rtf)$/i.test(file.name)) return bad('Supported: Word (.docx, .doc), OpenDocument (.odt), RTF and PDF files.')
    if (file.size > MAX_FILE_BYTES) return bad(`The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`)
  }

  // Signed-in teachers (dashboard import modal) skip the proof of work and the
  // per-IP cap; anonymous uploads (/import) need both.
  const session = await getServerSession(authOptions)
  const teacher = session?.user?.id
    ? (await prisma.user.findUnique({ where: { id: session.user.id }, select: { accountType: true } }))?.accountType === 'teacher'
    : false

  let powSalt: string
  if (teacher) {
    powSalt = `session:${randomUUID()}` // powSalt is unique; no challenge to consume
  } else {
    let challenge: PowChallenge
    try {
      challenge = JSON.parse(String(form.get('challenge') ?? ''))
    } catch {
      return bad('Missing verification. Please reload the page.')
    }
    if (!verifySolution(challenge, String(form.get('nonce') ?? ''))) {
      return bad('Verification failed. Please reload the page.', 403)
    }
    powSalt = challenge.salt
  }

  const ipHash = hashIp(getClientIdentifier(request))
  const limited = await checkLimits(ipHash, { skipPerIp: teacher })
  if (limited) return bad(limited, 429)

  let input: ImportInput
  let fileName: string
  if (isText) {
    input = { kind: 'text', text, html: typeof html === 'string' && html.trim() ? html : null }
    fileName = 'Eingefügter Text'
  } else {
    const upload = file as File
    const buffer = Buffer.from(await upload.arrayBuffer())
    fileName = upload.name
    const ext = upload.name.split('.').pop()!.toLowerCase()
    // Magic bytes per format, checked before any converter sees the file.
    const head = buffer.subarray(0, 8)
    if (ext === 'pdf') {
      if (head.subarray(0, 5).toString('latin1') !== '%PDF-') return bad('This is not a valid PDF file.')
      input = { kind: 'pdf', buf: buffer }
    } else if (ext === 'doc') {
      if (head.toString('hex') !== 'd0cf11e0a1b11ae1') return bad('This is not a valid Word (.doc) file.')
      input = { kind: 'office', buf: buffer, ext }
    } else if (ext === 'odt') {
      if (head.subarray(0, 2).toString('latin1') !== 'PK') return bad('This is not a valid OpenDocument (.odt) file.')
      input = { kind: 'office', buf: buffer, ext }
    } else if (ext === 'rtf') {
      if (head.subarray(0, 5).toString('latin1') !== '{\\rtf') return bad('This is not a valid RTF file.')
      input = { kind: 'office', buf: buffer, ext }
    } else {
      // .docx is a zip: reject anything without the PK signature before pandoc sees it.
      if (buffer.subarray(0, 2).toString('latin1') !== 'PK') return bad('This is not a valid Word (.docx) file.')
      input = { kind: 'docx', buf: buffer }
    }
  }

  let job: { id: string; token: string }
  try {
    job = await createImport({ fileName, ipHash, powSalt })
  } catch {
    // Unique violation on powSalt: challenge already used.
    return bad('Verification already used. Please reload the page.', 403)
  }

  after(() => processImport(job.id, input, fileName))
  return NextResponse.json({ token: job.token })
}
