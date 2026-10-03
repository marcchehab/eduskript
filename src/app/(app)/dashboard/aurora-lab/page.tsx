import { notFound } from 'next/navigation'
import { KARA_VOICES } from '@/lib/kara/voice-lines'
import { AuroraLab } from './lab'

/**
 * Dev-only lab for trying Kara voice lines with spoken directions
 * (syntax: src/lib/kara/voice-directions.ts). Renders via /api/dev/voice-try.
 */
export default function AuroraLabPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  const voices = Object.fromEntries(Object.entries(KARA_VOICES).map(([k, v]) => [k, v.style]))
  return <AuroraLab voices={voices} />
}
