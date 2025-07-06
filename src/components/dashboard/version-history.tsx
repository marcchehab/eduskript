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

export function VersionHistory({ pageId, versions, currentContent, onRestoreVersion }: VersionHistoryProps) {
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
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center space-x-2 mb-4">
          <History className="w-5 h-5 text-gray-500" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Version History</h3>
        </div>
        <div className="text-center py-8">
          <GitBranch className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">No versions yet. Save your page to create the first version.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <History className="w-5 h-5 text-gray-500" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Version History</h3>
            <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full dark:bg-blue-900 dark:text-blue-300">
              {versions.length} version{versions.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {versions.map((version, index) => (
          <div key={version.id} className="p-6 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-3 mb-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                    v{version.version}
                  </span>
                  {index === 0 && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                      Current
                    </span>
                  )}
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {formatDistanceToNow(new Date(version.createdAt), { addSuffix: true })}
                  </span>
                </div>

                <div className="mb-2">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    By {version.author.name || version.author.email}
                  </p>
                </div>

                {version.changeLog && (
                  <div className="mb-3">
                    <p className="text-sm text-gray-700 dark:text-gray-300 italic">
                      "{version.changeLog}"
                    </p>
                  </div>
                )}

                <div className="mb-3">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {getContentPreview(version.content)}
                  </p>
                </div>

                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => {
                      setSelectedVersion(selectedVersion === version.id ? null : version.id)
                      setShowPreview(!showPreview || selectedVersion !== version.id)
                    }}
                    className="inline-flex items-center px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <Eye className="w-4 h-4 mr-1.5" />
                    {selectedVersion === version.id && showPreview ? 'Hide' : 'Preview'}
                  </button>

                  {hasContentChanged(version.content) && (
                    <button
                      onClick={() => handleRestore(version)}
                      className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <RotateCcw className="w-4 h-4 mr-1.5" />
                      Restore
                    </button>
                  )}
                </div>

                {selectedVersion === version.id && showPreview && (
                  <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-600">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                      Version {version.version} Content:
                    </h4>
                    <div className="text-sm text-gray-700 dark:text-gray-300 max-h-60 overflow-y-auto">
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
