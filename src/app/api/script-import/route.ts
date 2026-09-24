/**
 * POST /api/script-import — anonymous .docx upload (no account).
 * multipart/form-data: file, challenge (JSON of PowChallenge), nonce,
 * website (honeypot, must be empty). Returns { token } immediately; the
 * conversion runs after the response (next/server after()) and the preview
 * page polls GET /api/script-import/<token>.
 */
import { after, NextRequest, NextResponse } from 'next/server'
import { getClientIdentifier } from '@/lib/rate-limit'
import { verifySolution, type PowChallenge } from '@/lib/script-import/pow'
import { checkLimits, hashIp, MAX_FILE_BYTES } from '@/lib/script-import/limits'
import { createImport, processImport } from '@/lib/script-import/service'

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
  if (form.get('website')) return bad('Invalid upload') // honeypot
  if (!(file instanceof File)) return bad('No file uploaded')
  if (!/\.docx$/i.test(file.name)) return bad('Only Word files (.docx) are supported for now.')
  if (file.size > MAX_FILE_BYTES) return bad(`The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`)

  let challenge: PowChallenge
  try {
    challenge = JSON.parse(String(form.get('challenge') ?? ''))
  } catch {
    return bad('Missing verification. Please reload the page.')
  }
  if (!verifySolution(challenge, String(form.get('nonce') ?? ''))) {
    return bad('Verification failed. Please reload the page.', 403)
  }

  const ipHash = hashIp(getClientIdentifier(request))
  const limited = await checkLimits(ipHash)
  if (limited) return bad(limited, 429)

  const buffer = Buffer.from(await file.arrayBuffer())
  // .docx is a zip: reject anything without the PK signature before pandoc sees it.
  if (buffer.subarray(0, 2).toString('latin1') !== 'PK') return bad('This is not a valid Word (.docx) file.')

  let job: { id: string; token: string }
  try {
    job = await createImport({ fileName: file.name, ipHash, powSalt: challenge.salt })
  } catch {
    // Unique violation on powSalt: challenge already used.
    return bad('Verification already used. Please reload the page.', 403)
  }

  after(() => processImport(job.id, buffer, file.name))
  return NextResponse.json({ token: job.token })
}
