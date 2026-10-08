'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { History, RotateCcw, Eye, GitBranch } from 'lucide-react'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'

export interface PageVersion {
  id: string
  content: string
  version: number
  changeLog?: string
  createdAt: string
  editSource?: string | null
  editClient?: string | null
  author: {
    name?: string
    email: string
  }
}

function attribution(v: { editSource?: string | null; editClient?: string | null }) {
  if (v.editSource === 'mcp' && v.editClient) return ` (${v.editClient} via MCP)`
  if (v.editSource === 'ai-edit') return ' (via AI Edit)'
  return ''
}

/**
 * Lines added/removed between two versions, counted as a multiset difference
 * of lines (O(n)). Ignores order, so a moved line counts as unchanged — fine
 * for a "how big was this change" hint, not an exact diff.
 */
function lineChangeStats(before: string, after: string): { added: number; removed: number } {
  const counts = new Map<string, number>()
  for (const l of before.split('\n')) counts.set(l, (counts.get(l) ?? 0) + 1)
  let added = 0
  for (const l of after.split('\n')) {
    const n = counts.get(l) ?? 0
    if (n > 0) counts.set(l, n - 1)
    else added++
  }
  let removed = 0
  for (const n of counts.values()) removed += n
  return { added, removed }
}

interface VersionHistoryProps {
  versions: PageVersion[]
  currentContent: string
  onRestoreVersion: (versionId: string, content: string) => void
}

export function VersionHistory({ versions, currentContent, onRestoreVersion }: VersionHistoryProps) {
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const alert = useAlertDialog()

  const hasContentChanged = (versionContent: string) => {
    return versionContent !== currentContent
  }

  const handleRestore = async (version: PageVersion) => {
    alert.showConfirm(
      `Are you sure you want to restore to version ${version.version}? This will create a new version with the restored content.`,
      () => {
        onRestoreVersion(version.id, version.content)
      },
      { destructive: true, title: 'Restore version', confirmText: 'Restore' }
    )
  }

  if (versions.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center space-x-2 mb-4">
          <History className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold text-card-foreground">Version History</h3>
        </div>
        <div className="text-center py-8">
          <GitBranch className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No versions yet. Save your page to create the first version.</p>
        </div>
      </div>
    )
  }

  return (
    <>
    <div>
      <div className="flex items-center gap-2 px-2 pb-2 pt-1">
        <History className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-card-foreground">Version history</h3>
        <span className="bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded-full">
          {versions.length}
        </span>
      </div>

      <div className="divide-y divide-border">
        {versions.map((version, index) => {
          const stats = lineChangeStats(versions[index + 1]?.content ?? '', version.content)
          const isOpen = selectedVersion === version.id && showPreview
          return (
          <div key={version.id} className="px-2 py-2.5 hover:bg-accent/50 transition-colors">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                v{version.version}
              </span>
              {index === 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success">
                  Current
                </span>
              )}
              <span className="text-muted-foreground" title={new Date(version.createdAt).toLocaleString()}>
                {formatDistanceToNow(new Date(version.createdAt), { addSuffix: true })}
              </span>
              <span className="text-xs tabular-nums" title="Lines added / removed compared to the version before">
                <span className="text-green-600 dark:text-green-400">+{stats.added}</span>{' '}
                <span className="text-red-600 dark:text-red-400">−{stats.removed}</span>
              </span>
              <span className="text-xs text-muted-foreground truncate">
                {version.author.name || version.author.email}{attribution(version)}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={() => {
                    setSelectedVersion(selectedVersion === version.id ? null : version.id)
                    setShowPreview(!showPreview || selectedVersion !== version.id)
                  }}
                  className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Eye className="w-3.5 h-3.5 mr-1" />
                  {isOpen ? 'Hide' : 'View'}
                </button>
                {hasContentChanged(version.content) && (
                  <button
                    onClick={() => handleRestore(version)}
                    className="inline-flex items-center px-2 py-1 border border-border text-xs font-medium rounded-md text-card-foreground hover:bg-accent"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    Restore
                  </button>
                )}
              </div>
            </div>

            {version.changeLog && (
              <p className="mt-1 text-xs text-card-foreground italic">&quot;{version.changeLog}&quot;</p>
            )}

            {isOpen && (
              <div className="mt-2 max-h-60 overflow-y-auto rounded-md bg-accent/60 p-3">
                <pre className="whitespace-pre-wrap font-mono text-xs text-card-foreground">{version.content}</pre>
              </div>
            )}
          </div>
          )
        })}
      </div>
    </div>
    <AlertDialogModal
      open={alert.open}
      onOpenChange={alert.setOpen}
      type={alert.type}
      title={alert.title}
      message={alert.message}
      onConfirm={alert.onConfirm}
      showCancel={alert.showCancel}
      confirmText={alert.confirmText}
      cancelText={alert.cancelText}
      destructive={alert.destructive}
    />
    </>
  )
}
