"use client"

import { useState } from 'react'
import { Cloud, HardDrive } from 'lucide-react'
import type { VersionSummary } from '@/lib/userdata/types'

// Read-only visual twin of the interactive version card in the History
// tab (see `index.tsx` ~line 5105). Used by the Orphaned-versions panel,
// which lists past versions but defers any restore action to the row-level
// "Restore to this editor" button. The interactive History card stays
// inline because its handlers reach back into ~15 pieces of parent state;
// extracting all of that would dwarf the orphan feature.

interface VersionCardDisplayProps {
  version: VersionSummary
  defaultLabel: string
  // When provided, the card becomes clickable. Used by the Orphaned-versions
  // panel to load a single version's content into the live editor for preview.
  onClick?: () => void
}

function formatTimeAgo(createdAt: number, now: number): string {
  const date = new Date(createdAt)
  const diff = now - createdAt
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (seconds < 60) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function VersionCardDisplay({ version, defaultLabel, onClick }: VersionCardDisplayProps) {
  // Snapshot "now" once at mount — the lazy-init form satisfies
  // react-hooks/purity (Date.now isn't called during render). Slight drift
  // over the lifetime of an open orphan row is acceptable.
  const [mountedAt] = useState(() => Date.now())
  const timeAgo = formatTimeAgo(version.createdAt, mountedAt)

  const interactive = !!onClick
  const baseClasses = 'relative flex-shrink-0 w-24 min-h-28 max-h-40 border rounded-lg p-3 flex flex-col items-center justify-center gap-1 bg-muted/20'

  const inner = (
    <>
      {version.synced ? (
        <div
          className="absolute top-1 left-1 z-10 pointer-events-none text-primary"
          title="Synced to server"
        >
          <Cloud className="w-5 h-5" />
        </div>
      ) : (
        <div
          className="absolute top-1 left-1 z-10 pointer-events-none text-orange-500"
          title="Local-only autosave"
        >
          <HardDrive className="w-5 h-5" />
        </div>
      )}
      <div className="font-bold text-sm text-foreground w-full text-center px-1 line-clamp-2">
        {version.label || defaultLabel}
      </div>
      <div className="text-xs text-muted-foreground">{timeAgo}</div>
    </>
  )

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClasses} text-left transition-colors hover:bg-accent/50 hover:border-primary cursor-pointer`}
        title="Preview this version in the editor (current state will be autosaved first)"
      >
        {inner}
      </button>
    )
  }
  return <div className={baseClasses}>{inner}</div>
}
