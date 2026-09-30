'use client'

import { Volume2, VolumeX } from 'lucide-react'
import { setMuted, useHasSound, useMuted } from '@/lib/sound'

/** Mute button for the page toolbar; only shown on pages with sound (see src/lib/sound.ts). */
export function PublicSoundToggle() {
  const hasSound = useHasSound()
  const muted = useMuted()
  if (!hasSound) return null
  return (
    <button
      onClick={() => setMuted(!muted)}
      className="p-2 rounded-md border border-border bg-card hover:bg-muted transition-colors"
      title={muted ? 'Sound on' : 'Sound off'}
    >
      {muted ? <VolumeX className="w-4 h-4 text-foreground" /> : <Volume2 className="w-4 h-4 text-foreground" />}
    </button>
  )
}
