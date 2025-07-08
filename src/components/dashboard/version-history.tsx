'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { History, RotateCcw, Eye, GitBranch } from 'lucide-react'

interface PageVersion {
  id: string
  content: string
  version: number
  changeLog?: string
  createdAt: string
  author: {
    name?: string
    email: string
  }
}

interface VersionHistoryProps {
  pageId: string
  versions: PageVersion[]
  currentContent: string
  onRestoreVersion: (versionId: string, content: string) => void
}

export function VersionHistory({ versions, currentContent, onRestoreVersion }: VersionHistoryProps) {
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  const getContentPreview = (content: string) => {
    return content.length > 100 ? content.substring(0, 100) + '...' : content
  }

  const hasContentChanged = (versionContent: string) => {
    return versionContent !== currentContent
  }

  const handleRestore = async (version: PageVersion) => {
    if (window.confirm(`Are you sure you want to restore to version ${version.version}? This will create a new version with the restored content.`)) {
      onRestoreVersion(version.id, version.content)
    }
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
    <div className="bg-card rounded-lg border border-border">
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <History className="w-5 h-5 text-muted-foreground" />
            <h3 className="text-lg font-semibold text-card-foreground">Version History</h3>
            <span className="bg-primary/10 text-primary text-xs font-medium px-2.5 py-0.5 rounded-full">
              {versions.length} version{versions.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      <div className="divide-y divide-border">
        {versions.map((version, index) => (
          <div key={version.id} className="p-6 hover:bg-accent transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-3 mb-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                    v{version.version}
                  </span>
                  {index === 0 && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success">
                      Current
                    </span>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(version.createdAt), { addSuffix: true })}
                  </span>
                </div>

                <div className="mb-2">
                  <p className="text-sm text-muted-foreground">
                    By {version.author.name || version.author.email}
                  </p>
                </div>

                {version.changeLog && (
                  <div className="mb-3">
                    <p className="text-sm text-card-foreground italic">
                      &quot;{version.changeLog}&quot;
                    </p>
                  </div>
                )}

                <div className="mb-3">
                  <p className="text-sm text-muted-foreground">
                    {getContentPreview(version.content)}
                  </p>
                </div>

                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => {
                      setSelectedVersion(selectedVersion === version.id ? null : version.id)
                      setShowPreview(!showPreview || selectedVersion !== version.id)
                    }}
                    className="inline-flex items-center px-3 py-1.5 border border-border text-sm font-medium rounded-md text-card-foreground bg-card hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <Eye className="w-4 h-4 mr-1.5" />
                    {selectedVersion === version.id && showPreview ? 'Hide' : 'Preview'}
                  </button>

                  {hasContentChanged(version.content) && (
                    <button
                      onClick={() => handleRestore(version)}
                      className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-primary-foreground bg-primary hover:bg-primary/80 focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <RotateCcw className="w-4 h-4 mr-1.5" />
                      Restore
                    </button>
                  )}
                </div>

                {selectedVersion === version.id && showPreview && (
                  <div className="mt-4 p-4 bg-accent rounded-lg border border-border">
                    <h4 className="text-sm font-medium text-card-foreground mb-2">
                      Version {version.version} Content:
                    </h4>
                    <div className="text-sm text-card-foreground max-h-60 overflow-y-auto">
                      <pre className="whitespace-pre-wrap font-mono text-xs">
                        {version.content}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
