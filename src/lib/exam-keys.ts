/**
 * Per-teacher RSA-OAEP keypair lifecycle for offline exam backups.
 *
 * Students encrypt their work with the teacher's public key (embedded in the
 * exam page render); the teacher decrypts uploaded .examfile blobs server-side
 * with the matching private key. Keys are rotatable, and old rows are kept
 * forever so historical backups remain decryptable.
 *
 * v1 stores the private key as a plain JWK column. Acceptable trade-off:
 * a DB compromise already exposes ExamSubmission contents directly, so the
 * keys don't widen the blast radius beyond what's already there. Future
 * hardening: wrap privateKeyJwk with a server master key from env at rest.
 */

import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'

/**
 * Short identifier embedded inside each .examfile so the recovery endpoint
 * can look up the right keypair without trusting any other field. 10 hex
 * chars = 40 bits of entropy — plenty for collision avoidance within a
 * single teacher's history, and short enough to be human-glanceable.
 */
function generateKeyId(): string {
  return randomBytes(5).toString('hex')
}

export interface ExamKeyRow {
  keyId: string
  publicKeyJwk: JsonWebKey
  privateKeyJwk: JsonWebKey
  isActive: boolean
  createdAt: Date
  rotatedAt: Date | null
}

async function generateRsaOaepKeypair(): Promise<{
  publicJwk: JsonWebKey
  privateJwk: JsonWebKey
}> {
  const keypair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    true, // extractable — we have to export both halves to store as JWK
    ['encrypt', 'decrypt'],
  )
  const [publicJwk, privateJwk] = await Promise.all([
    crypto.subtle.exportKey('jwk', keypair.publicKey),
    crypto.subtle.exportKey('jwk', keypair.privateKey),
  ])
  return { publicJwk, privateJwk }
}

/**
 * Returns the teacher's active exam key, lazy-generating one if none exists.
 * Safe to call on every exam page render — fast path is a single indexed read.
 */
export async function getOrCreateActiveExamKey(
  teacherId: string,
): Promise<ExamKeyRow> {
  const existing = await prisma.teacherExamKey.findFirst({
    where: { teacherId, isActive: true },
  })
  if (existing) {
    return {
      keyId: existing.keyId,
      publicKeyJwk: existing.publicKeyJwk as JsonWebKey,
      privateKeyJwk: existing.privateKeyJwk as JsonWebKey,
      isActive: existing.isActive,
      createdAt: existing.createdAt,
      rotatedAt: existing.rotatedAt,
    }
  }

  const { publicJwk, privateJwk } = await generateRsaOaepKeypair()
  const created = await prisma.teacherExamKey.create({
    data: {
      teacherId,
      keyId: generateKeyId(),
      publicKeyJwk: publicJwk as unknown as object,
      privateKeyJwk: privateJwk as unknown as object,
      isActive: true,
    },
  })
  return {
    keyId: created.keyId,
    publicKeyJwk: created.publicKeyJwk as JsonWebKey,
    privateKeyJwk: created.privateKeyJwk as JsonWebKey,
    isActive: created.isActive,
    createdAt: created.createdAt,
    rotatedAt: created.rotatedAt,
  }
}

/**
 * Look up a specific keypair by its embedded keyId, regardless of active state.
 * Used by the recovery endpoint — old keys must keep working after rotation.
 * Returns null if no such key exists or it doesn't belong to teacherId (when
 * provided), so callers can return a clean 404 without leaking key existence.
 */
export async function getExamKeyByKeyId(
  keyId: string,
  teacherId?: string,
): Promise<ExamKeyRow | null> {
  const row = await prisma.teacherExamKey.findUnique({ where: { keyId } })
  if (!row) return null
  if (teacherId && row.teacherId !== teacherId) return null
  return {
    keyId: row.keyId,
    publicKeyJwk: row.publicKeyJwk as JsonWebKey,
    privateKeyJwk: row.privateKeyJwk as JsonWebKey,
    isActive: row.isActive,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt,
  }
}

/**
 * Rotate the teacher's active key: mark the current active row inactive and
 * stamp rotatedAt, then create a new active row. Idempotent if called with no
 * pre-existing active key (just creates one).
 *
 * Returns the new active key.
 */
export async function rotateExamKey(teacherId: string): Promise<ExamKeyRow> {
  const { publicJwk, privateJwk } = await generateRsaOaepKeypair()
  const created = await prisma.$transaction(async (tx) => {
    await tx.teacherExamKey.updateMany({
      where: { teacherId, isActive: true },
      data: { isActive: false, rotatedAt: new Date() },
    })
    return tx.teacherExamKey.create({
      data: {
        teacherId,
        keyId: generateKeyId(),
        publicKeyJwk: publicJwk as unknown as object,
        privateKeyJwk: privateJwk as unknown as object,
        isActive: true,
      },
    })
  })
  return {
    keyId: created.keyId,
    publicKeyJwk: created.publicKeyJwk as JsonWebKey,
    privateKeyJwk: created.privateKeyJwk as JsonWebKey,
    isActive: created.isActive,
    createdAt: created.createdAt,
    rotatedAt: created.rotatedAt,
  }
}
