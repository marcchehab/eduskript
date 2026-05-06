"use client"

import { useState } from 'react'
import { ChevronRight, ChevronDown, Trash2, Import } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { userDataService } from '@/lib/userdata'
import type { VersionSummary } from '@/lib/userdata/types'
import { VersionCardDisplay } from './version-card-display'

interface OrphanRowProps {
  pageId: string
  orphanId: string
  onRestore: () => Promise<void>
  // Permanently delete every history row + main userData row for this
  // orphan. Confirmed by the parent — destructive, no undo.
  onDelete: () => Promise<void>
  // Click an individual version card → autosaves the current editor state
  // and loads the chosen version's content into the live editor for preview.
  onPreviewVersion?: (versionId: number) => Promise<void>
}

// Renders one orphan editor-id row. Header is click-to-expand; expanded
// view fetches that componentId's version history once and shows the last
// 10 cards (read-only). The "Restore to this editor" button moves ALL of
// that orphan's saves under the current editor's componentId (not just the
// 10 visible) — the bulk action is the whole point of the feature.
export function OrphanRow({ pageId, orphanId, onRestore, onDelete, onPreviewVersion }: OrphanRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [versions, setVersions] = useState<VersionSummary[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function toggle() {
    const next = !expanded
    setExpanded(next)
    if (next && versions === null) {
      setIsLoading(true)
      try {
        const all = await userDataService.getVersionHistory(pageId, orphanId)
        setVersions(all)
      } finally {
        setIsLoading(false)
      }
    }
  }

  // Default labels by kind — mirrors index.tsx's per-kind sequential
  // counters (auto1/manual2/check3) but computed locally for this orphan.
  const defaultLabels = (() => {
    const map = new Map<string, string>()
    if (!versions) return map
    const sortedAsc = [...versions].sort((a, b) => a.createdAt - b.createdAt)
    const counters: Record<string, number> = { auto: 0, manual: 0, check: 0 }
    for (const v of sortedAsc) {
      const k = v.kind ?? (v.isManualSave ? 'manual' : 'auto')
      counters[k] = (counters[k] ?? 0) + 1
      const key = v.id != null ? String(v.id) : `v-${v.versionNumber}`
      map.set(key, `${k}${counters[k]}`)
    }
    return map
  })()

  return (
    <div className="border rounded-lg mb-2 bg-card">
      <div className="flex items-center justify-between gap-2 p-2">
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-2 flex-1 text-left hover:text-primary transition-colors min-w-0"
          title={expanded ? 'Collapse' : 'Expand to view recent versions'}
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 flex-shrink-0" />
          )}
          <code className="text-xs font-mono truncate">{orphanId}</code>
        </button>
        <ConfirmationDialog
          title="Restore to this editor"
          description={`Move every save from "${orphanId}" onto the current editor. They will appear in this editor's History tab and the orphan will disappear.`}
          confirmText="Restore"
          variant="default"
          onConfirm={onRestore}
          trigger={
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 flex-shrink-0"
              title="Restore to this editor — move all saves from this orphaned editor onto the current one"
            >
              <Import className="w-3.5 h-3.5" />
            </Button>
          }
        />
        <ConfirmationDialog
          title="Delete orphaned saves"
          description={`Permanently delete every save under "${orphanId}". This cannot be undone.`}
          confirmText="Delete"
          variant="destructive"
          onConfirm={onDelete}
          trigger={
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 flex-shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
              title="Delete — permanently remove every save under this orphaned editor id"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          }
        />
      </div>
      {expanded && (
        <div className="px-2 pb-2 border-t">
          {isLoading ? (
            <div className="text-xs text-muted-foreground italic py-2">Loading…</div>
          ) : versions && versions.length === 0 ? (
            <div className="text-xs text-muted-foreground italic py-2">No versions found.</div>
          ) : versions ? (
            <div className="flex gap-2 py-2 overflow-x-auto">
              {versions.slice(0, 10).map((v) => {
                const labelKey = v.id != null ? String(v.id) : `v-${v.versionNumber}`
                const defaultLabel =
                  defaultLabels.get(labelKey) ?? `v${v.versionNumber}`
                const canPreview = onPreviewVersion && v.id != null
                return (
                  <VersionCardDisplay
                    key={v.id ?? `v-${v.versionNumber}`}
                    version={v}
                    defaultLabel={defaultLabel}
                    onClick={canPreview ? () => onPreviewVersion!(v.id!) : undefined}
                  />
                )
              })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
