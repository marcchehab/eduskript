import { notFound } from 'next/navigation'
import { VoiceFxTuner } from './tuner'

/**
 * Dev-only tuner for the Kara voice effects (src/lib/kara/voice-fx.ts). Raw
 * sample takes come from the local fx-tuner server
 * (~/Documents/2_Areas/eduskript/kara-kurs/fx-tuner.py, port 8770).
 */
export default function VoiceFxPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <VoiceFxTuner />
}
