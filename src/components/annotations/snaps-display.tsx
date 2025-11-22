'use client'

import { X } from 'lucide-react'
import type { Snap } from './snap-overlay'
import Image from 'next/image'

interface SnapsDisplayProps {
  snaps: Snap[]
  onRemoveSnap: (id: string) => void
}

export function SnapsDisplay({ snaps, onRemoveSnap }: SnapsDisplayProps) {
  if (snaps.length === 0) return null

  return (
    <>
      {snaps.map((snap) => (
        <div
          key={snap.id}
          className="fixed right-4 z-40 bg-background border-2 border-primary shadow-lg rounded-lg overflow-hidden group"
          style={{
            top: `${snap.top}px`,
            maxWidth: '300px',
            width: 'auto'
          }}
        >
          {/* Remove button */}
          <button
            onClick={() => onRemoveSnap(snap.id)}
            className="absolute top-2 right-2 p-1.5 bg-background/90 backdrop-blur border border-border rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive z-10"
            title="Remove snap"
            aria-label="Remove this snap"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Captured image */}
          <div className="relative">
            <Image
              src={snap.imageUrl}
              alt="Captured snap"
              width={snap.width}
              height={snap.height}
              className="w-full h-auto"
              unoptimized
            />
          </div>

          {/* Snap info (optional) */}
          <div className="px-2 py-1 bg-muted/50 text-xs text-muted-foreground text-center opacity-0 group-hover:opacity-100 transition-opacity">
            {snap.width} × {snap.height}
          </div>
        </div>
      ))}
    </>
  )
}
