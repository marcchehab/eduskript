import { NextResponse } from 'next/server'
import { createChallenge } from '@/lib/script-import/pow'

/** Proof-of-work challenge for the anonymous upload (see src/lib/script-import/pow.ts). */
export async function GET() {
  return NextResponse.json(createChallenge(), { headers: { 'Cache-Control': 'no-store' } })
}
