/**
 * Client-side encryption for offline exam backups (.examfile).
 *
 * Used when a student needs to save their work locally because the hand-in
 * request failed (e.g. network down) or as a pre-emptive measure. The file is
 * encrypted with the teacher's RSA-OAEP public key (embedded in the exam page
 * render); only the teacher's recovery endpoint can decrypt it.
 *
 * Format = hybrid envelope encryption (same shape as PGP / age):
 *   1. Generate a fresh AES-256-GCM content key.
 *   2. AES-GCM-encrypt the JSON payload.
 *   3. RSA-OAEP-wrap the AES key with the teacher's public key.
 *
 * The wrapped key + iv + ciphertext + meta are written to a JSON file that
 * the student downloads via the browser. The `meta` block is duplicated
 * outside the ciphertext for routing (teacher upload UI shows which student /
 * page) and re-validated against the plaintext copy on the server.
 */

export interface BackupMeta {
  pageId: string
  studentId: string
  skriptId: string
  createdAt: string
}

export interface BackupSnapshot {
  componentId: string
  payload: unknown
}

export interface ExamBackupFile {
  v: 1
  alg: 'RSA-OAEP-256+AES-256-GCM'
  keyId: string
  wrappedKey: string
  iv: string
  ciphertext: string
  meta: BackupMeta
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  // Explicitly typed return: TS 5.7+ widens `new Uint8Array(n)` to
  // `Uint8Array<ArrayBufferLike>` which is no longer assignable to BufferSource
  // (which now demands `ArrayBuffer`). We construct the buffer ourselves so
  // the type narrows correctly without per-call-site casts.
  const binary = atob(b64)
  const buffer = new ArrayBuffer(binary.length)
  const out = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * Encrypts the given snapshots with the teacher's RSA-OAEP public key.
 * Returns the serialized .examfile JSON blob ready to download.
 */
export async function encryptSnapshotsForBackup(
  snapshots: BackupSnapshot[],
  publicKeyJwk: JsonWebKey,
  keyId: string,
  meta: BackupMeta,
): Promise<ExamBackupFile> {
  // Import the teacher's RSA-OAEP public key.
  const rsaPublic = await crypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  )

  // Fresh per-file AES-256-GCM content key.
  const aesKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt'],
  )

  // 12-byte IV per NIST SP-800-38D recommendation for AES-GCM.
  const iv = crypto.getRandomValues(new Uint8Array(12))

  // Plaintext payload: snapshots + meta copy for tamper detection.
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ snapshots, meta }),
  )

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext),
  )

  // Wrap (encrypt) the raw AES key with the teacher's RSA-OAEP public key.
  const rawAesKey = new Uint8Array(await crypto.subtle.exportKey('raw', aesKey))
  const wrappedKey = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsaPublic, rawAesKey),
  )

  return {
    v: 1,
    alg: 'RSA-OAEP-256+AES-256-GCM',
    keyId,
    wrappedKey: bytesToBase64(wrappedKey),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    meta,
  }
}

/**
 * Server-side companion: decrypt an ExamBackupFile with the teacher's private
 * key. Returns the parsed plaintext `{ snapshots, meta }`. Throws on bad
 * inputs, mismatched meta, or auth-tag failure (tamper / wrong key).
 *
 * Lives in this client/server-shared module so the file format definition
 * stays in one place. The Node Web Crypto API is API-compatible with the
 * browser one for the primitives we use.
 */
export async function decryptBackupWithPrivateKey(
  file: ExamBackupFile,
  privateKeyJwk: JsonWebKey,
): Promise<{ snapshots: BackupSnapshot[]; meta: BackupMeta }> {
  if (file.v !== 1 || file.alg !== 'RSA-OAEP-256+AES-256-GCM') {
    throw new Error(`Unsupported backup file version/alg: ${file.v}/${file.alg}`)
  }

  const rsaPrivate = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  )

  const rawAesKey = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    rsaPrivate,
    base64ToBytes(file.wrappedKey),
  )
  const aesKey = await crypto.subtle.importKey(
    'raw',
    rawAesKey,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )

  const plaintextBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(file.iv) },
    aesKey,
    base64ToBytes(file.ciphertext),
  )

  const parsed = JSON.parse(new TextDecoder().decode(plaintextBytes)) as {
    snapshots: BackupSnapshot[]
    meta: BackupMeta
  }

  // Defence-in-depth: outer and inner meta must agree. Stops a swap attack
  // where someone re-labels the outer routing fields on a stolen ciphertext.
  if (
    parsed.meta.pageId !== file.meta.pageId ||
    parsed.meta.studentId !== file.meta.studentId
  ) {
    throw new Error('Backup file meta mismatch (outer vs inner)')
  }

  return parsed
}

/**
 * Triggers a browser download of the backup file. Caller is responsible for
 * filename — typically `eduskript-exam-backup-{pageId}-{ISO date}.examfile`.
 */
export function triggerBackupDownload(file: ExamBackupFile, filename: string): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Defer revoke so the click has time to dispatch on slower browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Suggested filename for downloaded backups. Stable enough to match per
 * page/student, distinct per save (timestamp) so multiple saves don't
 * silently overwrite each other in the student's Downloads folder.
 */
export function suggestBackupFilename(meta: BackupMeta): string {
  const stamp = meta.createdAt.replace(/[:.]/g, '-')
  return `eduskript-exam-backup-${meta.pageId}-${stamp}.examfile`
}
