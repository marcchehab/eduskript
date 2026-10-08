'use client'

/**
 * Shared pieces of the orange "page card" used by both editors: PageEditor
 * (skript pages + skript front page) and FrontPageEditor (site/org front
 * pages). Keeps the title row controls, the folder-tab fullscreen toggle and
 * the fullscreen layout identical in both.
 */

import type { ReactNode } from 'react'
import { Check, History, Maximize2, Minimize2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { VersionHistory, type PageVersion } from '@/components/dashboard/version-history'

/** Root wrapper classes: viewport-locked flex column in fullscreen (the editor
 *  card flex-1s into the rest; no overflow-auto, it would push the toolbar
 *  offscreen), no top padding so the folder tab hangs from the viewport edge. */
export const FULLSCREEN_ROOT_CLASS = 'fixed inset-0 z-50 bg-background px-3 pb-3 flex flex-col gap-2'

/** Content of the orange folder tab: icon + label + fullscreen toggle.
 *  FolderTab is pointer-events-none; the button opts back in. */
export function PageFolderLabel({ icon, label, isFullscreen, onToggleFullscreen }: {
  icon: ReactNode
  label: ReactNode
  isFullscreen: boolean
  onToggleFullscreen: () => void
}) {
  return (
    <>
      {icon}
      {label}
      <button
        type="button"
        onClick={onToggleFullscreen}
        title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen editor'}
        className="pointer-events-auto ml-1 rounded p-0.5 hover:bg-orange-500/15"
      >
        {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
      </button>
    </>
  )
}

/**
 * Split Save button: left part saves (primary + dot while dirty, quiet
 * "Saved" otherwise); the clock opens the version history popover, which is
 * anchored to the whole button.
 */
export function SaveWithHistory({
  onSave, isSaving, hasUnsavedChanges, justSaved,
  versions, currentContent, onRestoreVersion,
  historyOpen, onHistoryOpenChange,
}: {
  onSave: () => void
  isSaving: boolean
  hasUnsavedChanges: boolean
  justSaved: boolean
  versions: PageVersion[]
  currentContent: string
  onRestoreVersion: (versionId: string, content: string) => void
  historyOpen: boolean
  onHistoryOpenChange: (open: boolean) => void
}) {
  const dirty = hasUnsavedChanges || isSaving
  return (
    <Popover open={historyOpen} onOpenChange={onHistoryOpenChange}>
      <PopoverAnchor asChild>
        <div className="inline-flex items-stretch">
          <Button
            onClick={onSave}
            disabled={isSaving}
            size="sm"
            variant={dirty ? 'default' : 'outline'}
            className={`relative rounded-r-none ${!dirty ? (justSaved ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground') : ''}`}
            title={isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save changes (Ctrl+S)' : 'All changes saved (Ctrl+S)'}
          >
            {!dirty ? <Check className="w-4 h-4 mr-1.5" /> : <Save className="w-4 h-4 mr-1.5" />}
            {isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save' : 'Saved'}
            {hasUnsavedChanges && (
              <div className="absolute top-1 right-1 w-2 h-2 bg-warning rounded-full" />
            )}
          </Button>
          <Button
            onClick={() => onHistoryOpenChange(!historyOpen)}
            size="sm"
            variant={dirty ? 'default' : 'outline'}
            className={`rounded-l-none border-l-0 px-1.5 ${dirty ? 'border-l border-l-primary-foreground/30' : 'text-muted-foreground'} ${historyOpen ? 'bg-muted' : ''}`}
            title={`Version history${versions.length ? ` (${versions.length})` : ''}`}
            aria-expanded={historyOpen}
          >
            <History className="w-4 h-4" />
          </Button>
        </div>
      </PopoverAnchor>
      <PopoverContent align="end" onOpenAutoFocus={(e) => e.preventDefault()} className="w-[min(640px,90vw)] max-h-[70vh] overflow-y-auto border-blue-400/70 p-2 shadow-lg dark:border-blue-500/60">
        <VersionHistory
          versions={versions}
          currentContent={currentContent}
          onRestoreVersion={onRestoreVersion}
        />
      </PopoverContent>
    </Popover>
  )
}
